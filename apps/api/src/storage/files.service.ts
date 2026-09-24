import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import type { PrismaClient, StoredFile } from '@prisma/client';
import type { StoredFileDTO } from '@oudhealth/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { assertCan, can } from '../common/permissions';
import { StorageService } from './storage.service';
import { ScanService } from './scan.service';
import { sniffMime } from './file-type';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from './upload.util';

interface Actor {
  tenantId: string;
  userId: string;
  role: string;
}

export type FileCategory = 'PHOTO' | 'DOCUMENT' | 'LOGO' | 'RESULT' | 'OTHER';

const slug = (s: string) =>
  s.normalize('NFKD').replace(/[^\w.\- ]/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'file';

@Injectable()
export class FilesService {
  private readonly maxBytes = MAX_UPLOAD_BYTES;

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private scanner: ScanService,
    private audit: AuditService,
  ) {}

  private async toDto(row: {
    id: string;
    key: string;
    originalName: string;
    mimeType: string;
    size: number;
    category: string;
    createdAt: Date;
  }): Promise<StoredFileDTO> {
    return {
      id: row.id,
      url: `/api/files/${row.id}`,
      originalName: row.originalName,
      mimeType: row.mimeType,
      size: row.size,
      category: row.category,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async upload(
    actor: Actor,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    category: FileCategory,
  ): Promise<StoredFileDTO> {
    if (!file?.buffer?.length) throw new BadRequestException('No file received');
    if (file.size > this.maxBytes) {
      throw new PayloadTooLargeException(`File exceeds the ${MAX_UPLOAD_MB} MB limit`);
    }
    // The declared multipart content-type is untrusted client input - some
    // browsers/OSes report it blank or as a generic application/octet-stream
    // even for a genuinely valid file. The real bytes decide what this is; an
    // HTML file cannot pass this by declaring itself image/png, and a real PNG
    // is never rejected just because the browser mislabelled it.
    const mimeType = sniffMime(file.buffer);
    if (!mimeType) {
      throw new BadRequestException('Unsupported file type. Allowed: PNG, JPEG, WebP, PDF.');
    }

    // Malware scan (no-op unless CLAMAV_HOST is set). INFECTED is rejected here;
    // the download paths also refuse to serve anything recorded INFECTED.
    const scanStatus = await this.scanner.scan(file.buffer);
    if (scanStatus === 'INFECTED') {
      throw new UnprocessableEntityException({
        message: 'This file was rejected by the malware scanner.',
        code: 'FILE_INFECTED',
      });
    }
    const scannedAt = this.scanner.enabled ? new Date() : null;

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const key = `t/${actor.tenantId}/${category.toLowerCase()}/${randomUUID()}-${slug(file.originalname)}`;
    await this.storage.put(key, file.buffer, mimeType);

    let row: StoredFile;
    try {
      row = await this.prisma.forTenant(actor.tenantId, (tx) =>
        tx.storedFile.create({
          data: {
            tenantId: actor.tenantId,
            key,
            bucket: this.storage.bucket,
            mimeType,
            size: file.size,
            sha256,
            originalName: file.originalname,
            category,
            uploadedById: actor.userId,
            scanStatus,
            scannedAt,
          },
        }),
      );
    } catch (err) {
      // Compensating delete: the object is written but the row failed - don't leak it.
      await this.storage.delete(key).catch(() => undefined);
      throw err;
    }
    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: 'UPLOAD',
      entityType: 'StoredFile',
      entityId: row.id,
      metadata: { category, name: file.originalname, size: file.size },
    });
    return this.toDto(row);
  }

  /**
   * Authorisation gate for the generic /files/:id routes. Tenant scoping (RLS)
   * is not sufficient on its own - a raw file handle may only be used by the
   * person who uploaded it or a hospital admin. Resource-owning services
   * (PatientsService, SettingsService) call the primitives below directly and
   * enforce their own `assertCan` beforehand, so they do NOT go through this.
   */
  async assertActorCanUseHandle(actor: Actor, id: string): Promise<StoredFile> {
    const row = await this.prisma.forTenant(actor.tenantId, (tx) =>
      tx.storedFile.findFirst({ where: { id } }),
    );
    if (!row) throw new NotFoundException('File not found');
    const owns = !!row.uploadedById && row.uploadedById === actor.userId;
    if (!owns && !can(actor.role, 'admin:settings')) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'FORBIDDEN_FILE_ACCESS',
        message: 'You cannot access this file directly',
      });
    }
    return row;
  }

  private assertServable(row: { scanStatus: string }) {
    if (row.scanStatus === 'INFECTED') {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'FILE_INFECTED',
        message: 'This file was flagged by the malware scanner and cannot be downloaded.',
      });
    }
  }

  /** The stable /api/files/:id endpoint redirects here. Short TTL - the browser follows it at once. */
  async presignedUrl(actor: Actor, id: string): Promise<string> {
    const row = await this.prisma.forTenant(actor.tenantId, (tx) =>
      tx.storedFile.findFirst({ where: { id } }),
    );
    if (!row) throw new NotFoundException('File not found');
    this.assertServable(row);
    return this.storage.presignGet(row.key, {
      downloadName: row.originalName,
      mimeType: row.mimeType,
      ttlSeconds: 120,
    });
  }

  /**
   * Resolve a stored `/api/files/<id>` reference (what we persist in columns like
   * `tenant.logoUrl` / `patient.photoUrl` / `PatientDocument.fileUrl`) to a fresh
   * presigned URL. Default TTL is short (300s) so a URL that leaks out of a DTO
   * response dies quickly; logo callers pass a longer value. Returns null on any
   * miss so callers can just spread it into a DTO.
   */
  async presignRef(
    tenantId: string,
    ref: string | null | undefined,
    ttlOrTx?: number | PrismaClient,
    maybeTtl?: number,
  ): Promise<string | null> {
    const tx = typeof ttlOrTx === 'object' ? ttlOrTx : undefined;
    const ttl = typeof ttlOrTx === 'number' ? ttlOrTx : maybeTtl ?? 300;
    const id = ref?.match(/\/files\/([0-9a-f-]{36})/i)?.[1];
    if (!id) return null;
    const row = await (tx
      ? (tx as any).storedFile.findFirst({ where: { id } })
      : this.prisma.forTenant(tenantId, (t) => t.storedFile.findFirst({ where: { id } })).catch(() => null));
    if (!row) return null;
    if (row.scanStatus === 'INFECTED') return null;
    return this.storage.presignGet(row.key, {
      downloadName: row.originalName,
      mimeType: row.mimeType,
      ttlSeconds: ttl,
    });
  }

  async get(actor: Actor, id: string): Promise<StoredFileDTO> {
    const row = await this.prisma.forTenant(actor.tenantId, (tx) =>
      tx.storedFile.findFirst({ where: { id } }),
    );
    if (!row) throw new NotFoundException('File not found');
    return this.toDto(row);
  }

  async remove(actor: Actor, id: string): Promise<{ ok: true }> {
    const row = await this.prisma.forTenant(actor.tenantId, (tx) =>
      tx.storedFile.findFirst({ where: { id } }),
    );
    if (!row) throw new NotFoundException('File not found');
    await this.storage.delete(row.key).catch(() => undefined);
    await this.prisma.forTenant(actor.tenantId, (tx) => tx.storedFile.delete({ where: { id } }));
    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: 'DELETE',
      entityType: 'StoredFile',
      entityId: id,
    });
    return { ok: true };
  }

  /**
   * Reconcile the tenant's objects against its StoredFile rows:
   *  - delete objects with no row, older than 24h (failed uploads, best-effort
   *    cleanup misses);
   *  - delete rows whose object is gone, older than 24h (broken references).
   * Manual admin action for now; a scheduled job later.
   */
  async sweepOrphans(actor: Actor) {
    assertCan(actor.role, 'admin:settings');
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;

    const [objects, rows] = await Promise.all([
      this.storage.list(`t/${actor.tenantId}/`),
      this.prisma.forTenant(actor.tenantId, (tx) =>
        tx.storedFile.findMany({ select: { id: true, key: true, createdAt: true } }),
      ),
    ]);
    const knownKeys = new Set(rows.map((r) => r.key));

    let objectsDeleted = 0;
    for (const o of objects) {
      if (!knownKeys.has(o.key) && o.lastModified.getTime() < cutoff) {
        await this.storage.delete(o.key).catch(() => undefined);
        objectsDeleted++;
      }
    }

    const liveKeys = new Set(objects.map((o) => o.key));
    let rowsDeleted = 0;
    for (const r of rows) {
      if (!liveKeys.has(r.key) && r.createdAt.getTime() < cutoff) {
        await this.prisma
          .forTenant(actor.tenantId, (tx) => tx.storedFile.delete({ where: { id: r.id } }))
          .catch(() => undefined);
        rowsDeleted++;
      }
    }

    if (objectsDeleted || rowsDeleted) {
      await this.audit.record({
        tenantId: actor.tenantId, userId: actor.userId, action: 'SWEEP_ORPHANS',
        entityType: 'StoredFile', metadata: { objectsDeleted, rowsDeleted, objects: objects.length, rows: rows.length },
      });
    }
    return { objects: objects.length, rows: rows.length, objectsDeleted, rowsDeleted };
  }
}
