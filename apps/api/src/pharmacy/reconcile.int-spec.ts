import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../common/audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { PharmacyModule } from './pharmacy.module';
import { PharmacyInventoryService } from './inventory.service';
import { actorFor, destroyTenant, makeTenant, makeUser, ownerPrisma } from '../../test/int-helpers';

/**
 * D1 / finding #4: Drug.quantityOnHand is a denormalised cache of the batch
 * totals. reconcileStock() recomputes it and flags drugs whose signed
 * StockMovement ledger disagrees with the batch totals.
 */
describe('PharmacyInventoryService.reconcileStock (integration)', () => {
  let prisma: PrismaService;
  let inventory: PharmacyInventoryService;
  let tenantId: string;
  let actor: { tenantId: string; userId: string; role: string };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, StorageModule, PharmacyModule],
    }).compile();
    prisma = mod.get(PrismaService);
    inventory = mod.get(PharmacyInventoryService);
    tenantId = (await makeTenant()).id;
    actor = actorFor(tenantId, (await makeUser(tenantId, 'PHARMACIST')).id, 'PHARMACIST');
  });

  afterAll(async () => {
    await destroyTenant(tenantId);
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  it('corrects a desynced quantityOnHand and reports the change', async () => {
    const drug = await ownerPrisma.drug.create({
      data: { tenantId, sku: `MED-${Math.random().toString(36).slice(2, 8)}`, name: 'Amoxicillin', sellPrice: 50, quantityOnHand: 999 },
    });
    // batches sum to 30, movements sum to 30, cache says 999
    await ownerPrisma.drugBatch.createMany({
      data: [
        { tenantId, drugId: drug.id, batchNumber: 'A', expiryDate: new Date(Date.now() + 9e9), quantity: 20 },
        { tenantId, drugId: drug.id, batchNumber: 'B', expiryDate: new Date(Date.now() + 9e9), quantity: 10 },
      ],
    });
    await ownerPrisma.stockMovement.create({
      data: { tenantId, drugId: drug.id, type: 'OPENING', quantity: 30 },
    });

    const report = await inventory.reconcileStock(actor);

    const corrected = report.corrected.find((c) => c.drugId === drug.id);
    expect(corrected).toEqual({ drugId: drug.id, name: 'Amoxicillin', was: 999, now: 30 });
    expect(report.ledgerMismatch.find((m) => m.drugId === drug.id)).toBeUndefined();

    const after = await ownerPrisma.drug.findUnique({ where: { id: drug.id } });
    expect(after!.quantityOnHand).toBe(30);
  });

  it('flags a drug whose movement ledger disagrees with its batches', async () => {
    const drug = await ownerPrisma.drug.create({
      data: { tenantId, sku: `MED-${Math.random().toString(36).slice(2, 8)}`, name: 'Metronidazole', sellPrice: 40, quantityOnHand: 15 },
    });
    await ownerPrisma.drugBatch.create({
      data: { tenantId, drugId: drug.id, batchNumber: 'C', expiryDate: new Date(Date.now() + 9e9), quantity: 15 },
    });
    // ledger only accounts for 10 - a discrepancy the reconcile should surface
    await ownerPrisma.stockMovement.create({
      data: { tenantId, drugId: drug.id, type: 'RECEIVE', quantity: 10 },
    });

    const report = await inventory.reconcileStock(actor);
    const mismatch = report.ledgerMismatch.find((m) => m.drugId === drug.id);
    expect(mismatch).toEqual({ drugId: drug.id, name: 'Metronidazole', batches: 15, movements: 10 });
  });
});
