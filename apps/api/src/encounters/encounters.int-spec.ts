import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../common/audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { EncountersModule } from './encounters.module';
import { EncountersService } from './encounters.service';
import {
  actorFor,
  destroyTenant,
  makePatient,
  makeTenant,
  makeUser,
  makeVisit,
  ownerPrisma,
} from '../../test/int-helpers';

describe('EncountersService.createOrder (integration - FUNC-1 sweep: catalogue pricing)', () => {
  let prisma: PrismaService;
  let encounters: EncountersService;
  let tenantId: string;
  let doctorActor: { tenantId: string; userId: string; role: string };
  let adminActor: { tenantId: string; userId: string; role: string };
  let visitId: string;
  let patientId: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, StorageModule, EncountersModule],
    }).compile();
    prisma = mod.get(PrismaService);
    encounters = mod.get(EncountersService);

    const tenant = await makeTenant();
    tenantId = tenant.id;
    const doc = await makeUser(tenantId, 'DOCTOR');
    doctorActor = actorFor(tenantId, doc.id, 'DOCTOR');
    const admin = await makeUser(tenantId, 'HOSPITAL_ADMIN');
    adminActor = actorFor(tenantId, admin.id, 'HOSPITAL_ADMIN');
  });

  beforeEach(async () => {
    const patient = await makePatient(tenantId);
    patientId = patient.id;
    const visit = await makeVisit(tenantId, patientId);
    visitId = visit.id;
  });

  afterAll(async () => {
    await destroyTenant(tenantId);
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  async function serviceItem(unitPrice: number) {
    return ownerPrisma.serviceItem.create({
      data: { tenantId, name: `Test Lab ${Math.random().toString(36).slice(2, 8)}`, category: 'Laboratory', unitPrice, isActive: true },
    });
  }

  it('a doctor sending a mismatched unitPrice is charged the catalogue price, not the sent price', async () => {
    const svc = await serviceItem(500);
    await encounters.createOrder(doctorActor, visitId, {
      orderType: 'LABORATORY', serviceItemId: svc.id, unitPrice: 10,
    } as any);

    const lines = await ownerPrisma.invoiceLine.findMany({ where: { invoice: { patientId } } });
    expect(lines).toHaveLength(1);
    expect(Number(lines[0].unitPrice)).toBe(500);
  });

  it('a billing:manage actor can override the price with a reason, and it is audited', async () => {
    const svc = await serviceItem(500);
    const order = await encounters.createOrder(adminActor, visitId, {
      orderType: 'LABORATORY', serviceItemId: svc.id, unitPrice: 350, overrideReason: 'Negotiated rate',
    } as any);

    const lines = await ownerPrisma.invoiceLine.findMany({ where: { invoice: { patientId } } });
    expect(Number(lines[0].unitPrice)).toBe(350);

    const auditRows = await ownerPrisma.auditLog.findMany({
      where: { tenantId, action: 'ORDER_PRICE_OVERRIDE', entityId: order.id },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].metadata).toMatchObject({ cataloguePrice: 500, overridePrice: 350, reason: 'Negotiated rate' });
  });

  it('an override without a reason is rejected even for a billing:manage actor', async () => {
    const svc = await serviceItem(500);
    await expect(
      encounters.createOrder(adminActor, visitId, { orderType: 'LABORATORY', serviceItemId: svc.id, unitPrice: 350 } as any),
    ).rejects.toThrow();
  });

  it('a non-privileged mismatch is ignored (catalogue price charged) and logged', async () => {
    const svc = await serviceItem(500);
    const order = await encounters.createOrder(doctorActor, visitId, {
      orderType: 'LABORATORY', serviceItemId: svc.id, unitPrice: 1,
    } as any);

    const lines = await ownerPrisma.invoiceLine.findMany({ where: { invoice: { patientId } } });
    expect(Number(lines[0].unitPrice)).toBe(500);

    const auditRows = await ownerPrisma.auditLog.findMany({
      where: { tenantId, action: 'ORDER_PRICE_MISMATCH', entityId: order.id },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].metadata).toMatchObject({ cataloguePrice: 500, requestedPrice: 1 });
  });

  it('a service item with no catalogue price blocks the order instead of charging zero', async () => {
    const svc = await serviceItem(0);
    await expect(
      encounters.createOrder(doctorActor, visitId, { orderType: 'LABORATORY', serviceItemId: svc.id } as any),
    ).rejects.toThrow(/No price set/);

    const orders = await ownerPrisma.clinicalOrder.count({ where: { tenantId, serviceItemId: svc.id } });
    expect(orders).toBe(0); // the whole transaction rolled back, no orphaned order row
  });

  it('a billing:manage actor can override a zero catalogue price with a reason', async () => {
    const svc = await serviceItem(0);
    await encounters.createOrder(adminActor, visitId, {
      orderType: 'LABORATORY', serviceItemId: svc.id, unitPrice: 200, overrideReason: 'Catalogue price not set yet',
    } as any);

    const lines = await ownerPrisma.invoiceLine.findMany({ where: { invoice: { patientId } } });
    expect(Number(lines[0].unitPrice)).toBe(200);
  });

  // ─────────────────────────── off-catalogue (free-text) orders ───────────────────────────

  it('off-catalogue: an order with no serviceItemId and no reason is rejected', async () => {
    await expect(
      encounters.createOrder(doctorActor, visitId, { orderType: 'PROCEDURE', name: 'Custom procedure', unitPrice: 100 } as any),
    ).rejects.toThrow(/reason is required/);
  });

  it('off-catalogue: an order with a reason succeeds and is audited (name, price, reason, who, visit)', async () => {
    const order = await encounters.createOrder(doctorActor, visitId, {
      orderType: 'PROCEDURE', name: 'Custom procedure', unitPrice: 100, overrideReason: 'Not yet in the service catalogue',
    } as any);

    const lines = await ownerPrisma.invoiceLine.findMany({ where: { invoice: { patientId } } });
    expect(Number(lines[0].unitPrice)).toBe(100);

    const auditRows = await ownerPrisma.auditLog.findMany({
      where: { tenantId, action: 'OFF_CATALOGUE_ORDER', entityId: order.id },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].userId).toBe(doctorActor.userId);
    expect(auditRows[0].metadata).toMatchObject({
      name: 'Custom procedure', price: 100, reason: 'Not yet in the service catalogue', visitId,
    });
  });
});
