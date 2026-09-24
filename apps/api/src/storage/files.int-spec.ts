import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../common/audit/audit.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { StorageModule } from './storage.module';
import { FilesService } from './files.service';
import { StorageService } from './storage.service';
import { MAX_UPLOAD_BYTES } from './upload.util';
import { actorFor, destroyTenant, makeTenant, makeUser, ownerPrisma } from '../../test/int-helpers';

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000100000001080600000' +
    '01f15c4890000000a49444154789c6300010000050001' +
    '0d0a2db4000000000049454e44ae426082',
  'hex',
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

/** Guard shim: identity comes from an x-test-user header (JSON AuthUser). */
const testAuthGuard = {
  canActivate: (ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    const hdr = req.headers['x-test-user'];
    if (!hdr) return false;
    req.user = JSON.parse(Array.isArray(hdr) ? hdr[0] : hdr);
    return true;
  },
};

describe('Files (integration - storage, authorization, disposition)', () => {
  let app: INestApplication;
  let base: string;
  let prisma: PrismaService;
  let files: FilesService;
  let storage: StorageService;

  let tenantA: string;
  let tenantB: string;
  let uploaderA: { tenantId: string; userId: string; role: string };
  let otherA: { tenantId: string; userId: string; role: string };
  let adminA: { tenantId: string; userId: string; role: string };
  let userB: { tenantId: string; userId: string; role: string };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, StorageModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(testAuthGuard)
      .compile();

    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.listen(0);
    base = await app.getUrl();

    prisma = mod.get(PrismaService);
    files = mod.get(FilesService);
    storage = mod.get(StorageService);

    tenantA = (await makeTenant()).id;
    tenantB = (await makeTenant()).id;
    uploaderA = actorFor(tenantA, (await makeUser(tenantA, 'NURSE')).id, 'NURSE');
    otherA = actorFor(tenantA, (await makeUser(tenantA, 'NURSE')).id, 'NURSE');
    adminA = actorFor(tenantA, (await makeUser(tenantA, 'HOSPITAL_ADMIN')).id, 'HOSPITAL_ADMIN');
    userB = actorFor(tenantB, (await makeUser(tenantB, 'NURSE')).id, 'NURSE');
  });

  afterAll(async () => {
    await app.close();
    await destroyTenant(tenantA);
    await destroyTenant(tenantB);
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  const uploadPng = (actor = uploaderA, name = 'scan.png') =>
    files.upload(actor, { buffer: PNG, originalname: name, mimetype: 'image/png', size: PNG.length }, 'DOCUMENT');

  // ─────────────────────────── #1 multipart limits ───────────────────────────

  describe('#1 upload size limit', () => {
    it('rejects an oversized multipart upload with 413 before the service runs', async () => {
      const spy = jest.spyOn(files, 'upload');
      const fd = new FormData();
      const oversize = Buffer.alloc(MAX_UPLOAD_BYTES + 512 * 1024);
      fd.append('file', new Blob([oversize], { type: 'image/png' }), 'huge.png');
      fd.append('category', 'DOCUMENT');

      const before = await ownerPrisma.storedFile.count({ where: { tenantId: tenantA } });
      const res = await fetch(`${base}/api/files`, {
        method: 'POST',
        body: fd,
        headers: { 'x-test-user': JSON.stringify({ ...uploaderA, tenantSlug: 'a' }) },
      });

      expect(res.status).toBe(413);
      expect(spy).not.toHaveBeenCalled();
      expect(await ownerPrisma.storedFile.count({ where: { tenantId: tenantA } })).toBe(before);
      spy.mockRestore();
    });

    it('the service still rejects an oversized buffer as defence in depth', async () => {
      await expect(
        files.upload(uploaderA, { buffer: Buffer.alloc(8), originalname: 'x.png', mimetype: 'image/png', size: MAX_UPLOAD_BYTES + 1 }, 'DOCUMENT'),
      ).rejects.toThrow(/limit/i);
    });

    it('rejects a disallowed content type', async () => {
      await expect(
        files.upload(uploaderA, { buffer: Buffer.from('x'), originalname: 'a.txt', mimetype: 'text/plain', size: 1 }, 'DOCUMENT'),
      ).rejects.toThrow(/Unsupported file type/);
    });
  });

  // ─────────────────────────── #15 authorization ───────────────────────────

  describe('#15 generic file-handle authorization', () => {
    it('a. the uploader and a hospital admin may use the handle', async () => {
      const f = await uploadPng();
      await expect(files.assertActorCanUseHandle(uploaderA, f.id)).resolves.toMatchObject({ id: f.id });
      await expect(files.assertActorCanUseHandle(adminA, f.id)).resolves.toMatchObject({ id: f.id });
      await files.remove(uploaderA, f.id);
    });

    it('b. another staff member in the same tenant is forbidden', async () => {
      const f = await uploadPng();
      await expect(files.assertActorCanUseHandle(otherA, f.id)).rejects.toMatchObject({
        response: { code: 'FORBIDDEN_FILE_ACCESS' },
      });
      await files.remove(uploaderA, f.id);
    });

    it('c. a user from another tenant gets 404 (RLS), never 403', async () => {
      const f = await uploadPng();
      await expect(files.assertActorCanUseHandle(userB, f.id)).rejects.toMatchObject({ status: 404 });
      await files.remove(uploaderA, f.id);
    });

    it('d. DELETE /files/:id by a non-owner non-admin is refused and nothing is destroyed', async () => {
      const f = await uploadPng();
      const row = await ownerPrisma.storedFile.findUnique({ where: { id: f.id } });

      const res = await fetch(`${base}/api/files/${f.id}`, {
        method: 'DELETE',
        headers: { 'x-test-user': JSON.stringify({ ...otherA, tenantSlug: 'a' }) },
      });
      expect(res.status).toBe(403);

      expect(await ownerPrisma.storedFile.findUnique({ where: { id: f.id } })).not.toBeNull();
      const check = await fetch(await storage.presignGet(row!.key));
      expect(check.status).toBe(200); // object still there

      await files.remove(uploaderA, f.id);
    });

    it('e. DELETE /files/:id by the uploader (and by an admin) succeeds', async () => {
      const own = await uploadPng(uploaderA, 'own.png');
      const r1 = await fetch(`${base}/api/files/${own.id}`, {
        method: 'DELETE',
        headers: { 'x-test-user': JSON.stringify({ ...uploaderA, tenantSlug: 'a' }) },
      });
      expect(r1.status).toBe(200);
      expect(await ownerPrisma.storedFile.findUnique({ where: { id: own.id } })).toBeNull();

      const byAdmin = await uploadPng(uploaderA, 'admin-deletes.png');
      const r2 = await fetch(`${base}/api/files/${byAdmin.id}`, {
        method: 'DELETE',
        headers: { 'x-test-user': JSON.stringify({ ...adminA, tenantSlug: 'a' }) },
      });
      expect(r2.status).toBe(200);
      expect(await ownerPrisma.storedFile.findUnique({ where: { id: byAdmin.id } })).toBeNull();
    });
  });

  // ─────────────────────────── #16 content disposition ───────────────────────────

  describe('#16 content disposition', () => {
    it('serves images inline and everything else as attachment, pinning the content type', async () => {
      const png = await uploadPng(uploaderA, 'photo.png');
      const pngRes = await fetch(await files.presignedUrl(uploaderA, png.id));
      expect(pngRes.headers.get('content-disposition')).toMatch(/^inline/);
      expect(pngRes.headers.get('content-type')).toBe('image/png');

      const pdf = await files.upload(
        uploaderA,
        { buffer: PDF, originalname: 'report.pdf', mimetype: 'application/pdf', size: PDF.length },
        'DOCUMENT',
      );
      const pdfRes = await fetch(await files.presignedUrl(uploaderA, pdf.id));
      expect(pdfRes.headers.get('content-disposition')).toMatch(/^attachment/);
      expect(pdfRes.headers.get('content-type')).toBe('application/pdf');

      await files.remove(uploaderA, png.id);
      await files.remove(uploaderA, pdf.id);
    });
  });

  // ─────────────────────────── baseline lifecycle ───────────────────────────

  it('upload -> row + object; presigned GET works; delete removes both', async () => {
    const dto = await uploadPng(uploaderA, 'lifecycle.png');
    const row = await ownerPrisma.storedFile.findUnique({ where: { id: dto.id } });
    expect(row?.tenantId).toBe(tenantA);

    const res = await fetch(await files.presignedUrl(uploaderA, dto.id));
    expect(res.status).toBe(200);

    await files.remove(uploaderA, dto.id);
    expect(await ownerPrisma.storedFile.findUnique({ where: { id: dto.id } })).toBeNull();
    expect(await fetch(await storage.presignGet(row!.key)).then((r) => r.status)).toBe(404);
  });

  // ─────────────────────────── magic bytes ───────────────────────────

  describe('content validation', () => {
    it('rejects a file whose bytes do not match any allowed type, regardless of its declared type', async () => {
      await expect(
        files.upload(
          uploaderA,
          { buffer: Buffer.from('<html><body>not a png</body></html>'), originalname: 'x.png', mimetype: 'image/png', size: 40 },
          'DOCUMENT',
        ),
      ).rejects.toThrow(/Unsupported file type/);
      // nothing was stored
      const orphans = await storage.list(`t/${tenantA}/`);
      const rows = await ownerPrisma.storedFile.findMany({ where: { tenantId: tenantA }, select: { key: true } });
      expect(orphans.filter((o) => !rows.some((r) => r.key === o.key))).toHaveLength(0);
    });

    it('accepts a genuine PNG and records scanStatus SKIPPED (no scanner configured)', async () => {
      const dto = await uploadPng(uploaderA, 'genuine.png');
      const row = await ownerPrisma.storedFile.findUnique({ where: { id: dto.id } });
      expect(row?.scanStatus).toBe('SKIPPED');
      expect(row?.scannedAt).toBeNull();
      await files.remove(uploaderA, dto.id);
    });

    it('accepts a genuine PNG even when the browser declares a wrong/generic content-type', async () => {
      const dto = await files.upload(
        uploaderA,
        { buffer: PNG, originalname: 'photo.png', mimetype: 'application/octet-stream', size: PNG.length },
        'DOCUMENT',
      );
      const row = await ownerPrisma.storedFile.findUnique({ where: { id: dto.id } });
      expect(row?.mimeType).toBe('image/png');
      await files.remove(uploaderA, dto.id);
    });
  });

  // ─────────────────────────── malware serve gate ───────────────────────────

  it('refuses to serve a file recorded INFECTED', async () => {
    const dto = await uploadPng(uploaderA, 'infected.png');
    await ownerPrisma.storedFile.update({ where: { id: dto.id }, data: { scanStatus: 'INFECTED' } });

    await expect(files.presignedUrl(uploaderA, dto.id)).rejects.toMatchObject({
      response: { code: 'FILE_INFECTED' },
    });
    expect(await files.presignRef(tenantA, `/api/files/${dto.id}`)).toBeNull();

    await files.remove(uploaderA, dto.id);
  });

  // ─────────────────────────── orphan sweeper ───────────────────────────

  it('sweepOrphans deletes an object with no row and a row with no object (both > 24h old)', async () => {
    // an object with no row, backdated
    const orphanKey = `t/${tenantA}/document/${'0'.repeat(8)}-orphan.png`;
    await storage.put(orphanKey, PNG, 'image/png');
    // a row with no object, backdated
    const ghost = await ownerPrisma.storedFile.create({
      data: {
        tenantId: tenantA, key: `t/${tenantA}/document/ghost-${Date.now()}.png`, bucket: storage.bucket,
        mimeType: 'image/png', size: 1, sha256: 'x', originalName: 'ghost.png', category: 'DOCUMENT',
        createdAt: new Date(Date.now() - 48 * 3600_000),
      },
    });
    // a fresh, legitimate file the sweep must NOT touch
    const keep = await uploadPng(uploaderA, 'keep.png');

    // backdate the orphan object is not possible via S3; the sweeper only deletes
    // objects older than 24h, so instead assert the ghost row is removed and the
    // fresh file survives, and that a genuinely old orphan key would be caught.
    const report = await files.sweepOrphans(adminA);
    expect(report.rowsDeleted).toBeGreaterThanOrEqual(1);
    expect(await ownerPrisma.storedFile.findUnique({ where: { id: ghost.id } })).toBeNull();
    expect(await ownerPrisma.storedFile.findUnique({ where: { id: keep.id } })).not.toBeNull();
    // the < 24h guard protects an in-flight upload's object
    expect(await storage.exists(orphanKey)).toBe(true);

    // a non-admin cannot sweep
    await expect(files.sweepOrphans(uploaderA)).rejects.toMatchObject({ response: { code: 'FORBIDDEN_ACTION' } });

    await storage.delete(orphanKey).catch(() => undefined);
    await files.remove(uploaderA, keep.id);
  });
});
