import { Injectable, NotFoundException } from '@nestjs/common';
import type { HospitalSettingsDTO } from '@oudhealth/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { FilesService } from '../storage/files.service';
import { assertCan } from '../common/permissions';
import { UpdateSettingsDto } from './dto/settings.dto';

interface Actor {
  tenantId: string;
  userId: string;
  role: string;
}

const PROFILE_FIELDS = [
  'name', 'address', 'phone', 'contactEmail', 'website', 'rcNumber', 'taxId',
  'primaryColor', 'invoicePrefix', 'receiptPrefix', 'documentFooter',
] as const;

@Injectable()
export class SettingsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private files: FilesService,
  ) {}

  private async shape(tenantId: string): Promise<HospitalSettingsDTO> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!t) throw new NotFoundException('Hospital not found');
    return {
      id: t.id,
      name: t.name,
      slug: t.slug,
      facilityType: t.facilityType,
      address: t.address,
      phone: t.phone,
      contactEmail: t.contactEmail,
      website: t.website,
      rcNumber: t.rcNumber,
      taxId: t.taxId,
      logoUrl: await this.files.presignRef(tenantId, t.logoUrl, 600),
      primaryColor: t.primaryColor,
      invoicePrefix: t.invoicePrefix,
      receiptPrefix: t.receiptPrefix,
      documentFooter: t.documentFooter,
    };
  }

  get(tenantId: string) {
    return this.shape(tenantId);
  }

  async update(actor: Actor, dto: UpdateSettingsDto) {
    assertCan(actor.role, 'admin:settings');
    const data: Record<string, unknown> = {};
    for (const f of PROFILE_FIELDS) {
      if (dto[f] !== undefined) data[f] = dto[f] === '' ? null : dto[f];
    }
    // prefix / name must not be nulled
    if (data.invoicePrefix === null) delete data.invoicePrefix;
    if (data.receiptPrefix === null) delete data.receiptPrefix;
    if (data.name === null) delete data.name;

    if (Object.keys(data).length === 0) return this.shape(actor.tenantId);

    const before = await this.prisma.tenant.findUnique({
      where: { id: actor.tenantId },
      select: Object.fromEntries(Object.keys(data).map((k) => [k, true])) as Record<string, true>,
    });
    await this.prisma.tenant.update({ where: { id: actor.tenantId }, data });

    // record only the fields that actually changed, with their old and new values
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    for (const [k, after] of Object.entries(data)) {
      const prev = (before as Record<string, unknown> | null)?.[k] ?? null;
      if (prev !== after) changes[k] = { before: prev, after };
    }
    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: 'UPDATE',
      entityType: 'Tenant',
      entityId: actor.tenantId,
      metadata: { changes },
    });
    return this.shape(actor.tenantId);
  }

  async setLogo(actor: Actor, file: Express.Multer.File) {
    assertCan(actor.role, 'admin:settings');
    const existing = await this.prisma.tenant.findUnique({
      where: { id: actor.tenantId },
      select: { logoUrl: true },
    });
    const stored = await this.files.upload(actor, file, 'LOGO');
    await this.prisma.tenant.update({
      where: { id: actor.tenantId },
      data: { logoUrl: `/api/files/${stored.id}` },
    });
    // best-effort clean up the previous logo object
    const prevId = existing?.logoUrl?.match(/\/files\/([0-9a-f-]{36})/i)?.[1];
    if (prevId && prevId !== stored.id) {
      await this.files.remove(actor, prevId).catch(() => undefined);
    }
    await this.audit.record({
      tenantId: actor.tenantId, userId: actor.userId, action: 'UPDATE',
      entityType: 'Tenant', entityId: actor.tenantId, metadata: { logo: stored.id },
    });
    return this.shape(actor.tenantId);
  }

  async removeLogo(actor: Actor) {
    assertCan(actor.role, 'admin:settings');
    const t = await this.prisma.tenant.findUnique({
      where: { id: actor.tenantId },
      select: { logoUrl: true },
    });
    const id = t?.logoUrl?.match(/\/files\/([0-9a-f-]{36})/i)?.[1];
    await this.prisma.tenant.update({ where: { id: actor.tenantId }, data: { logoUrl: null } });
    if (id) await this.files.remove(actor, id).catch(() => undefined);
    return this.shape(actor.tenantId);
  }
}
