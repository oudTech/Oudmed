import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../common/audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { PharmacyModule } from './pharmacy.module';
import { PharmacyService } from './pharmacy.service';
import { PharmacyInventoryService } from './inventory.service';
import { lagosCalendarDate } from '../common/lagos-time';
import { actorFor, destroyTenant, makePatient, makeTenant, makeUser, ownerPrisma } from '../../test/int-helpers';

/**
 * BL-2: a drug batch is treated as expired from the start of its printed
 * expiry date in Lagos time, not the exact instant `new Date()` passes it
 * (which depends on the server's own timezone). `lagosCalendarDate(now)` is
 * the same value a batch dated "today" would carry, so a batch expiring
 * exactly today must already be excluded from FEFO draw-down.
 */
describe('Drug batch expiry is Lagos-time, not server-local (BL-2)', () => {
  let prisma: PrismaService;
  let pharmacy: PharmacyService;
  let inventory: PharmacyInventoryService;
  let tenantId: string;
  let actor: { tenantId: string; userId: string; role: string };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, StorageModule, PharmacyModule],
    }).compile();
    prisma = mod.get(PrismaService);
    pharmacy = mod.get(PharmacyService);
    inventory = mod.get(PharmacyInventoryService);

    const tenant = await makeTenant();
    tenantId = tenant.id;
    const u = await makeUser(tenantId, 'PHARMACIST');
    actor = actorFor(tenantId, u.id, 'PHARMACIST');
  });

  afterAll(async () => {
    await destroyTenant(tenantId);
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  async function drugWithExpiry(expiryDate: Date) {
    const drug = await ownerPrisma.drug.create({
      data: {
        tenantId, sku: `MED-${Math.random().toString(36).slice(2, 8)}`, name: 'Expiry Test Drug',
        sellPrice: 100, quantityOnHand: 10,
      },
    });
    await ownerPrisma.drugBatch.create({
      data: { tenantId, drugId: drug.id, batchNumber: 'B1', expiryDate, quantity: 10 },
    });
    const patient = await makePatient(tenantId);
    const rx = await ownerPrisma.prescription.create({
      data: {
        tenantId, patientId: patient.id, status: 'ACTIVE', dispenseStatus: 'PENDING',
        items: { create: [{ tenantId, drugId: drug.id, drugName: 'Expiry Test Drug' }] },
      },
      include: { items: true },
    });
    return { drug, rx };
  }

  it('excludes a batch expiring exactly "today" (Lagos) from dispensing', async () => {
    const { rx } = await drugWithExpiry(lagosCalendarDate(new Date()));
    await expect(
      pharmacy.dispense(actor, rx.id, { items: [{ itemId: rx.items[0].id, quantity: 1, unitPrice: 100 }] }),
    ).rejects.toMatchObject({ response: { code: 'INSUFFICIENT_STOCK' } });
  });

  it('excludes a batch that expired "yesterday" (Lagos)', async () => {
    const yesterday = new Date(lagosCalendarDate(new Date()).getTime() - 86_400_000);
    const { rx } = await drugWithExpiry(yesterday);
    await expect(
      pharmacy.dispense(actor, rx.id, { items: [{ itemId: rx.items[0].id, quantity: 1, unitPrice: 100 }] }),
    ).rejects.toMatchObject({ response: { code: 'INSUFFICIENT_STOCK' } });
  });

  it('still allows a batch expiring "tomorrow" (Lagos)', async () => {
    const tomorrow = new Date(lagosCalendarDate(new Date()).getTime() + 86_400_000);
    const { drug, rx } = await drugWithExpiry(tomorrow);
    await pharmacy.dispense(actor, rx.id, { items: [{ itemId: rx.items[0].id, quantity: 1, unitPrice: 100 }] });
    const updated = await ownerPrisma.drug.findUnique({ where: { id: drug.id } });
    expect(updated?.quantityOnHand).toBe(9);
  });

  it('inventory list flags a batch expiring today as expiringSoon, not as still-fresh', async () => {
    const { drug } = await drugWithExpiry(lagosCalendarDate(new Date()));
    const { drugs } = await inventory.list(tenantId, {} as any);
    const row = drugs.find((d) => d.id === drug.id);
    expect(row?.expiringSoon).toBe(true);
  });
});
