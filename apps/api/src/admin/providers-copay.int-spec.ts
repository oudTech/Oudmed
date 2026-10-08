import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../common/audit/audit.module';
import { AdminModule } from './admin.module';
import { AdminService } from './admin.service';
import { actorFor, destroyTenant, makeTenant, makeUser, ownerPrisma } from '../../test/int-helpers';

/**
 * Fix 3 of the "HMO claims not reflecting" investigation (2026-10-08,
 * docs/audit/phase1-status.md): there was no way anywhere in the product
 * (API DTO or web form) to set InsuranceProvider.defaultCoPayPct for a
 * real provider - only prisma/seed.ts ever wrote it. Every provider a
 * hospital admin actually added defaulted to null, which claims/pharmacy
 * resolution treats as 0% co-pay (100% billed to the insurer).
 */
describe('AdminService.createProvider/updateProvider - co-pay field (integration)', () => {
  let prisma: PrismaService;
  let admin: AdminService;
  let tenantId: string;
  let actor: { tenantId: string; userId: string; role: string };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, AdminModule],
    }).compile();
    prisma = mod.get(PrismaService);
    admin = mod.get(AdminService);

    const tenant = await makeTenant();
    tenantId = tenant.id;
    const userId = (await makeUser(tenantId)).id;
    actor = actorFor(tenantId, userId);
  });

  afterAll(async () => {
    await destroyTenant(tenantId);
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  it('stores defaultCoPayPct set via the admin create form, instead of leaving it null', async () => {
    const created = await admin.createProvider(actor, {
      name: 'Co-pay Create HMO', kind: 'HMO' as any, defaultCoPayPct: 17.5,
    } as any);
    expect(created.defaultCoPayPct).toBe('17.5');

    const row = await ownerPrisma.insuranceProvider.findUniqueOrThrow({ where: { id: created.id } });
    expect(Number(row.defaultCoPayPct)).toBe(17.5);
  });

  it('updating the co-pay audits who changed it and the before/after values', async () => {
    const created = await admin.createProvider(actor, {
      name: 'Co-pay Update HMO', kind: 'HMO' as any, defaultCoPayPct: 10,
    } as any);

    await admin.updateProvider(actor, created.id, { defaultCoPayPct: 22 } as any);

    const row = await ownerPrisma.insuranceProvider.findUniqueOrThrow({ where: { id: created.id } });
    expect(Number(row.defaultCoPayPct)).toBe(22);

    const logs = await ownerPrisma.auditLog.findMany({
      where: { tenantId, entityType: 'InsuranceProvider', entityId: created.id, action: 'UPDATE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(logs.length).toBeGreaterThan(0);
    const latest = logs[0];
    expect(latest.userId).toBe(actor.userId);
    expect((latest.metadata as any).defaultCoPayPct).toEqual({ before: '10', after: '22' });
  });

  it('touching an unrelated field does not log a spurious co-pay audit entry', async () => {
    const created = await admin.createProvider(actor, {
      name: 'Co-pay Untouched HMO', kind: 'HMO' as any, defaultCoPayPct: 5,
    } as any);

    await admin.updateProvider(actor, created.id, { phone: '08011112222' } as any);

    const logs = await ownerPrisma.auditLog.findMany({
      where: { tenantId, entityType: 'InsuranceProvider', entityId: created.id, action: 'UPDATE' },
    });
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) {
      expect((l.metadata as any)?.defaultCoPayPct).toBeUndefined();
    }
  });

  it('accepts a real, saved co-pay unchanged on a no-op update', async () => {
    const created = await admin.createProvider(actor, {
      name: 'Co-pay Noop HMO', kind: 'HMO' as any, defaultCoPayPct: 9.5,
    } as any);
    await admin.updateProvider(actor, created.id, { defaultCoPayPct: 9.5 } as any);
    const row = await ownerPrisma.insuranceProvider.findUniqueOrThrow({ where: { id: created.id } });
    expect(Number(row.defaultCoPayPct)).toBe(9.5);
  });
});
