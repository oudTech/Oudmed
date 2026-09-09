import { INestApplication, ValidationPipe, ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../common/audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import { FilesService } from '../storage/files.service';
import { BillingModule } from '../billing/billing.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PatientsModule } from './patients.module';
import { EncountersModule } from '../encounters/encounters.module';
import {
  destroyTenant,
  makePatient,
  makeTenant,
  makeUser,
  makeVisit,
  ownerPrisma,
} from '../../test/int-helpers';

/**
 * HTTP-level authorization tests for the patient-record surface.
 *
 * Establishes: reading a patient, their clinical sub-resources, their documents
 * and the encounter view requires `patient:read`
 * ([RECEPTIONIST, NURSE, DOCTOR, HOSPITAL_ADMIN], + SUPER_ADMIN bypass).
 * PHARMACIST / LAB_STAFF / ACCOUNTANT are excluded. Document deletion additionally
 * requires the caller to be the uploader or a hospital admin. Tenant isolation
 * (RLS) still yields 404, never 403, for cross-tenant identifiers.
 */

const testAuthGuard = {
  canActivate: (ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    const hdr = req.headers['x-test-user'];
    if (!hdr) return false;
    req.user = JSON.parse(Array.isArray(hdr) ? hdr[0] : hdr);
    return true;
  },
};

type Who = { tenantId: string; userId: string; role: string };
const auth = (w: Who) => ({
  ...w,
  tenantSlug: 't',
  email: `${w.role.toLowerCase()}@int.test`,
  fullName: w.role,
});

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000100000001080600000' +
    '01f15c4890000000a49444154789c6300010000050001' +
    '0d0a2db4000000000049454e44ae426082',
  'hex',
);

describe('Patient record authorization (integration - HTTP)', () => {
  let app: INestApplication;
  let base: string;
  let prisma: PrismaService;
  let files: FilesService;
  let storage: StorageService;

  // tenant A cast
  let tenantA: string;
  const who: Record<string, Who> = {};
  let patientA: string;
  let visitA: string;

  // tenant B
  let tenantB: string;
  let adminB: Who;
  let patientB: string;

  const req = (method: string, path: string, w: Who, body?: unknown) =>
    fetch(`${base}/api${path}`, {
      method,
      headers: { 'x-test-user': JSON.stringify(auth(w)), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  /** Create a patient document owned by `uploader`, backed by a real storage object. */
  async function makeDocument(tenantId: string, patientId: string, uploader: Who) {
    const stored = await files.upload(
      uploader,
      { buffer: PNG, originalname: 'scan.png', mimetype: 'image/png', size: PNG.length },
      'DOCUMENT',
    );
    const doc = await ownerPrisma.patientDocument.create({
      data: {
        tenantId,
        patientId,
        category: 'OTHER',
        title: 'Scan',
        fileName: 'scan.png',
        mimeType: 'image/png',
        fileUrl: `/api/files/${stored.id}`,
        uploadedById: uploader.userId,
      },
    });
    return { docId: doc.id, fileId: stored.id };
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [
        PrismaModule,
        AuditModule,
        StorageModule,
        BillingModule,
        PatientsModule,
        EncountersModule,
      ],
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
    for (const role of [
      'DOCTOR',
      'NURSE',
      'NURSE2',
      'RECEPTIONIST',
      'HOSPITAL_ADMIN',
      'SUPER_ADMIN',
      'PHARMACIST',
      'LAB_STAFF',
      'ACCOUNTANT',
    ]) {
      const dbRole = role === 'NURSE2' ? 'NURSE' : role;
      who[role] = {
        tenantId: tenantA,
        userId: (await makeUser(tenantA, dbRole)).id,
        role: dbRole,
      };
    }
    const p = await makePatient(tenantA);
    patientA = p.id;
    visitA = (await makeVisit(tenantA, patientA)).id;

    tenantB = (await makeTenant()).id;
    adminB = { tenantId: tenantB, userId: (await makeUser(tenantB, 'HOSPITAL_ADMIN')).id, role: 'HOSPITAL_ADMIN' };
    patientB = (await makePatient(tenantB)).id;
  });

  afterAll(async () => {
    await app.close();
    await destroyTenant(tenantA);
    await destroyTenant(tenantB);
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  // ─────────────────────────── patient read ───────────────────────────

  describe('GET /patients/:id', () => {
    it.each(['DOCTOR', 'NURSE', 'RECEPTIONIST', 'HOSPITAL_ADMIN', 'SUPER_ADMIN'])(
      '%s is allowed (200)',
      async (role) => {
        const res = await req('GET', `/patients/${patientA}`, who[role]);
        expect(res.status).toBe(200);
      },
    );

    it.each(['PHARMACIST', 'LAB_STAFF', 'ACCOUNTANT'])('%s is forbidden (403)', async (role) => {
      const res = await req('GET', `/patients/${patientA}`, who[role]);
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('FORBIDDEN_ACTION');
    });

    it('patient listing is gated the same way', async () => {
      expect((await req('GET', '/patients', who.RECEPTIONIST)).status).toBe(200);
      expect((await req('GET', '/patients', who.PHARMACIST)).status).toBe(403);
      expect((await req('GET', '/patients/stats', who.PHARMACIST)).status).toBe(403);
    });
  });

  // ─────────────────────────── clinical sub-resources ───────────────────────────

  describe('clinical sub-resources', () => {
    const paths = (pid: string) => [
      `/patients/${pid}/diagnoses`,
      `/patients/${pid}/vitals`,
      `/patients/${pid}/notes`,
      `/patients/${pid}/prescriptions`,
      `/patients/${pid}/orders`,
      `/patients/${pid}/complaints`,
      `/patients/${pid}/appointments`,
      `/patients/${pid}/invoices`,
    ];

    it('a doctor may read every clinical sub-resource (200)', async () => {
      for (const path of paths(patientA)) {
        expect((await req('GET', path, who.DOCTOR)).status).toBe(200);
      }
    });

    it.each(['PHARMACIST', 'LAB_STAFF', 'ACCOUNTANT'])(
      '%s is forbidden on every clinical sub-resource (403)',
      async (role) => {
        for (const path of paths(patientA)) {
          expect((await req('GET', path, who[role])).status).toBe(403);
        }
      },
    );

    it('encounter read: doctor 200, pharmacist 403', async () => {
      expect((await req('GET', `/encounters/${visitA}`, who.DOCTOR)).status).toBe(200);
      expect((await req('GET', `/encounters/${visitA}`, who.PHARMACIST)).status).toBe(403);
    });
  });

  // ─────────────────────────── documents ───────────────────────────

  describe('GET /patients/:id/documents', () => {
    it('an authorized clinical user gets the list - metadata only, NO presigned URL', async () => {
      const { docId, fileId } = await makeDocument(tenantA, patientA, who.NURSE);
      const res = await req('GET', `/patients/${patientA}/documents`, who.NURSE);
      expect(res.status).toBe(200);
      const raw = await res.text();
      expect(raw).toContain(docId);
      expect(raw).not.toMatch(/X-Amz-Signature|downloadUrl|http:\/\/|https:\/\//i); // no URL in the list
      await files.remove(who.NURSE, fileId).catch(() => undefined);
      await ownerPrisma.patientDocument.deleteMany({ where: { id: docId } });
    });

    it('an excluded role is forbidden', async () => {
      const { docId, fileId } = await makeDocument(tenantA, patientA, who.NURSE);
      const res = await req('GET', `/patients/${patientA}/documents`, who.PHARMACIST);
      expect(res.status).toBe(403);
      await files.remove(who.NURSE, fileId).catch(() => undefined);
      await ownerPrisma.patientDocument.deleteMany({ where: { id: docId } });
    });

    it('mint-on-click: documents/:docId/url returns a working short-lived URL for patient:read, 403 otherwise', async () => {
      const { docId, fileId } = await makeDocument(tenantA, patientA, who.NURSE);

      const ok = await req('GET', `/patients/${patientA}/documents/${docId}/url`, who.DOCTOR);
      expect(ok.status).toBe(200);
      const { url } = await ok.json();
      expect(typeof url).toBe('string');
      expect((await fetch(url)).status).toBe(200); // the presigned URL actually works

      expect((await req('GET', `/patients/${patientA}/documents/${docId}/url`, who.PHARMACIST)).status).toBe(403);
      // a docId that isn't this patient's
      const other = await makeDocument(tenantA, (await makePatient(tenantA)).id, who.NURSE);
      expect((await req('GET', `/patients/${patientA}/documents/${other.docId}/url`, who.DOCTOR)).status).toBe(404);

      await files.remove(who.NURSE, fileId).catch(() => undefined);
      await files.remove(who.NURSE, other.fileId).catch(() => undefined);
      await ownerPrisma.patientDocument.deleteMany({ where: { id: { in: [docId, other.docId] } } });
    });
  });

  // ─────────────────────────── document deletion ───────────────────────────

  describe('DELETE /patients/:id/documents/:docId', () => {
    async function storageObjectExists(fileId: string) {
      const row = await ownerPrisma.storedFile.findUnique({ where: { id: fileId } });
      if (!row) return false;
      return (await fetch(await storage.presignGet(row.key))).status === 200;
    }

    it('the uploader can delete their own document (200, row + object gone)', async () => {
      const { docId, fileId } = await makeDocument(tenantA, patientA, who.NURSE);
      const res = await req('DELETE', `/patients/${patientA}/documents/${docId}`, who.NURSE);
      expect(res.status).toBe(200);
      expect(await ownerPrisma.patientDocument.findUnique({ where: { id: docId } })).toBeNull();
      expect(await ownerPrisma.storedFile.findUnique({ where: { id: fileId } })).toBeNull();
    });

    it('a hospital admin can delete a document uploaded by someone else (200)', async () => {
      const { docId, fileId } = await makeDocument(tenantA, patientA, who.NURSE);
      const res = await req('DELETE', `/patients/${patientA}/documents/${docId}`, who.HOSPITAL_ADMIN);
      expect(res.status).toBe(200);
      expect(await ownerPrisma.patientDocument.findUnique({ where: { id: docId } })).toBeNull();
      await ownerPrisma.storedFile.deleteMany({ where: { id: fileId } });
    });

    it('a different nurse (not the uploader, not admin) is refused; row + object intact', async () => {
      const { docId, fileId } = await makeDocument(tenantA, patientA, who.NURSE);
      const res = await req('DELETE', `/patients/${patientA}/documents/${docId}`, who.NURSE2);
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('FORBIDDEN_DOCUMENT_DELETE');
      expect(await ownerPrisma.patientDocument.findUnique({ where: { id: docId } })).not.toBeNull();
      expect(await storageObjectExists(fileId)).toBe(true);
      await files.remove(who.NURSE, fileId).catch(() => undefined);
      await ownerPrisma.patientDocument.deleteMany({ where: { id: docId } });
    });

    it('a role without patient:document is refused before any ownership check (403); nothing destroyed', async () => {
      const { docId, fileId } = await makeDocument(tenantA, patientA, who.NURSE);
      const res = await req('DELETE', `/patients/${patientA}/documents/${docId}`, who.ACCOUNTANT);
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('FORBIDDEN_ACTION');
      expect(await ownerPrisma.patientDocument.findUnique({ where: { id: docId } })).not.toBeNull();
      expect(await storageObjectExists(fileId)).toBe(true);
      await files.remove(who.NURSE, fileId).catch(() => undefined);
      await ownerPrisma.patientDocument.deleteMany({ where: { id: docId } });
    });

    it('a docId that does not belong to the patient in the URL is a 404 (compound check)', async () => {
      const { docId, fileId } = await makeDocument(tenantA, patientA, who.NURSE);
      const otherPatient = (await makePatient(tenantA)).id;
      const res = await req('DELETE', `/patients/${otherPatient}/documents/${docId}`, who.HOSPITAL_ADMIN);
      expect(res.status).toBe(404);
      expect(await ownerPrisma.patientDocument.findUnique({ where: { id: docId } })).not.toBeNull();
      await files.remove(who.NURSE, fileId).catch(() => undefined);
      await ownerPrisma.patientDocument.deleteMany({ where: { id: docId } });
      await ownerPrisma.patient.deleteMany({ where: { id: otherPatient } });
    });

    it('a cross-tenant caller gets 404 (RLS), never 403', async () => {
      const { docId, fileId } = await makeDocument(tenantA, patientA, who.NURSE);
      const res = await req('DELETE', `/patients/${patientA}/documents/${docId}`, adminB);
      expect(res.status).toBe(404);
      expect(await ownerPrisma.patientDocument.findUnique({ where: { id: docId } })).not.toBeNull();
      await files.remove(who.NURSE, fileId).catch(() => undefined);
      await ownerPrisma.patientDocument.deleteMany({ where: { id: docId } });
    });
  });

  // ─────────────────────────── IDOR / cross-tenant reads ───────────────────────────

  describe('IDOR and cross-tenant reads', () => {
    it('patient-id swap to another tenant returns 404, not another tenant\'s data', async () => {
      const res = await req('GET', `/patients/${patientB}`, who.DOCTOR);
      expect(res.status).toBe(404);
    });

    it('listing another tenant\'s patient documents returns an empty list under RLS (200, no leak)', async () => {
      const { docId, fileId } = await makeDocument(tenantB, patientB, adminB);
      const res = await req('GET', `/patients/${patientB}/documents`, who.DOCTOR);
      // tenant A doctor holds patient:read, so passes the action gate; RLS then
      // scopes the query to tenant A and returns nothing for a tenant B patient.
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
      await ownerPrisma.patientDocument.deleteMany({ where: { id: docId } });
      await ownerPrisma.storedFile.deleteMany({ where: { id: fileId } });
    });

    it('cross-tenant encounter read returns 404', async () => {
      const visitB = (await makeVisit(tenantB, patientB)).id;
      const res = await req('GET', `/encounters/${visitB}`, who.DOCTOR);
      expect(res.status).toBe(404);
      await ownerPrisma.visit.deleteMany({ where: { id: visitB } });
    });
  });

  // ─────────────────────────── registration endpoints ───────────────────────────

  describe('registration endpoints keep their own gate', () => {
    it('check-duplicates requires patient:register, not patient:read', async () => {
      const dup = { firstName: 'Test', lastName: 'Patient', phone: '0800' };
      expect((await req('POST', '/patients/check-duplicates', who.RECEPTIONIST, dup)).status).toBe(201);
      // PHARMACIST holds neither patient:read nor patient:register
      expect((await req('POST', '/patients/check-duplicates', who.PHARMACIST, dup)).status).toBe(403);
    });

    it('creating a patient still works for a registrar and is refused for pharmacy', async () => {
      const body = { firstName: 'New', lastName: 'Intake' };
      const ok = await req('POST', '/patients', who.RECEPTIONIST, body);
      expect(ok.status).toBe(201);
      const created = await ok.json();
      await ownerPrisma.patient.deleteMany({ where: { id: created.id } });
      expect((await req('POST', '/patients', who.PHARMACIST, body)).status).toBe(403);
    });
  });
});
