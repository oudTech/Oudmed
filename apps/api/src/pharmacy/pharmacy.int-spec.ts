import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../common/audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { PharmacyModule } from './pharmacy.module';
import { PharmacyService } from './pharmacy.service';
import {
  actorFor,
  destroyTenant,
  makePatient,
  makeTenant,
  makeUser,
  ownerPrisma,
} from '../../test/int-helpers';

const day = (n: number) => new Date(Date.now() + n * 86_400_000);

describe('PharmacyService (integration - FEFO stock draw-down)', () => {
  let prisma: PrismaService;
  let pharmacy: PharmacyService;
  let tenantId: string;
  let actor: { tenantId: string; userId: string; role: string };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, StorageModule, PharmacyModule],
    }).compile();
    prisma = mod.get(PrismaService);
    pharmacy = mod.get(PharmacyService);

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

  async function drugWithBatches(earlierQty: number, laterQty: number) {
    const drug = await ownerPrisma.drug.create({
      data: {
        tenantId, sku: `MED-${Math.random().toString(36).slice(2, 8)}`, name: 'Test Drug',
        sellPrice: 100, quantityOnHand: earlierQty + laterQty,
      },
    });
    const earlier = await ownerPrisma.drugBatch.create({
      data: { tenantId, drugId: drug.id, batchNumber: 'EARLY', expiryDate: day(30), quantity: earlierQty },
    });
    const later = await ownerPrisma.drugBatch.create({
      data: { tenantId, drugId: drug.id, batchNumber: 'LATE', expiryDate: day(180), quantity: laterQty },
    });
    return { drug, earlier, later };
  }

  async function prescriptionFor(drugId: string) {
    const patient = await makePatient(tenantId);
    return ownerPrisma.prescription.create({
      data: {
        tenantId, patientId: patient.id, status: 'ACTIVE', dispenseStatus: 'PENDING',
        items: { create: [{ tenantId, drugId, drugName: 'Test Drug' }] },
      },
      include: { items: true },
    });
  }

  it('draws from the earliest-expiry batch first, records the movement, decrements the cache', async () => {
    const { drug, earlier, later } = await drugWithBatches(10, 10);
    const rx = await prescriptionFor(drug.id);

    await pharmacy.dispense(actor, rx.id, { items: [{ itemId: rx.items[0].id, quantity: 6, unitPrice: 100 }] });

    const e = await ownerPrisma.drugBatch.findUnique({ where: { id: earlier.id } });
    const l = await ownerPrisma.drugBatch.findUnique({ where: { id: later.id } });
    expect(e!.quantity).toBe(4); // 10 - 6
    expect(l!.quantity).toBe(10); // untouched

    const d = await ownerPrisma.drug.findUnique({ where: { id: drug.id } });
    expect(d!.quantityOnHand).toBe(14); // 20 - 6

    const moves = await ownerPrisma.stockMovement.findMany({ where: { drugId: drug.id, type: 'DISPENSE' } });
    expect(moves).toHaveLength(1);
    expect(moves[0].quantity).toBe(-6);
    expect(moves[0].batchId).toBe(earlier.id);
  });

  it('spans batches earliest-first when one batch is not enough', async () => {
    const { drug, earlier, later } = await drugWithBatches(5, 10);
    const rx = await prescriptionFor(drug.id);

    await pharmacy.dispense(actor, rx.id, { items: [{ itemId: rx.items[0].id, quantity: 8, unitPrice: 100 }] });

    const e = await ownerPrisma.drugBatch.findUnique({ where: { id: earlier.id } });
    const l = await ownerPrisma.drugBatch.findUnique({ where: { id: later.id } });
    expect(e!.quantity).toBe(0); // fully drawn
    expect(l!.quantity).toBe(7); // 10 - 3
  });

  it('rejects with 409 INSUFFICIENT_STOCK and mutates nothing when short', async () => {
    const { drug, earlier, later } = await drugWithBatches(3, 3);
    const rx = await prescriptionFor(drug.id);

    await expect(
      pharmacy.dispense(actor, rx.id, { items: [{ itemId: rx.items[0].id, quantity: 20, unitPrice: 100 }] }),
    ).rejects.toMatchObject({ response: { code: 'INSUFFICIENT_STOCK' } });

    const e = await ownerPrisma.drugBatch.findUnique({ where: { id: earlier.id } });
    const l = await ownerPrisma.drugBatch.findUnique({ where: { id: later.id } });
    const d = await ownerPrisma.drug.findUnique({ where: { id: drug.id } });
    expect(e!.quantity).toBe(3);
    expect(l!.quantity).toBe(3);
    expect(d!.quantityOnHand).toBe(6);
    const moves = await ownerPrisma.stockMovement.count({ where: { drugId: drug.id } });
    expect(moves).toBe(0);
  });

  // ─────────────────────────── B3: replay + concurrency ───────────────────────────

  async function twoItemRx(drugAId: string, drugBId: string) {
    const patient = await makePatient(tenantId);
    return ownerPrisma.prescription.create({
      data: {
        tenantId, patientId: patient.id, status: 'ACTIVE', dispenseStatus: 'PENDING',
        items: {
          create: [
            { tenantId, drugId: drugAId, drugName: 'Drug A' },
            { tenantId, drugId: drugBId, drugName: 'Drug B' },
          ],
        },
      },
      include: { items: true },
    });
  }

  it('B3: replaying a PARTIAL dispense does not re-draw stock or re-charge', async () => {
    const a = await drugWithBatches(20, 0);
    const b = await drugWithBatches(20, 0);
    const rx = await twoItemRx(a.drug.id, b.drug.id);
    const itemA = rx.items.find((i) => i.drugId === a.drug.id)!;
    const itemB = rx.items.find((i) => i.drugId === b.drug.id)!;
    const payload = {
      items: [
        { itemId: itemA.id, quantity: 5, unitPrice: 100 }, // dispense A
        { itemId: itemB.id, quantity: 0, unitPrice: 100 }, // leave B pending
      ],
    };

    const first = await pharmacy.dispense(actor, rx.id, payload);
    expect(first.dispenseStatus).toBe('PARTIAL');

    // exact replay while still PARTIAL
    const replay = await pharmacy.dispense(actor, rx.id, payload);
    expect(replay.dispenseStatus).toBe('PARTIAL');

    const batchesA = await ownerPrisma.drugBatch.findMany({ where: { drugId: a.drug.id } });
    expect(batchesA.reduce((s, b) => s + b.quantity, 0)).toBe(15); // 20 - 5, ONCE (not 20 - 10)
    const drugA = await ownerPrisma.drug.findUnique({ where: { id: a.drug.id } });
    expect(drugA!.quantityOnHand).toBe(15);
    const moves = await ownerPrisma.stockMovement.count({ where: { drugId: a.drug.id, type: 'DISPENSE' } });
    expect(moves).toBe(1);
    // drug B never dispensed
    const drugB = await ownerPrisma.drug.findUnique({ where: { id: b.drug.id } });
    expect(drugB!.quantityOnHand).toBe(20);

    // one charge line for "Drug A x5", not two
    const rxRow = await ownerPrisma.prescription.findUnique({ where: { id: rx.id }, select: { patientId: true } });
    const lines = await ownerPrisma.invoiceLine.findMany({
      where: { invoice: { patientId: rxRow!.patientId } },
    });
    expect(lines).toHaveLength(1);
    expect(Number(lines[0].lineTotal)).toBe(500);
  });

  it('B3: raising a partly-dispensed item on a still-PARTIAL prescription moves only the delta', async () => {
    const a = await drugWithBatches(20, 0);
    const b = await drugWithBatches(20, 0);
    const rx = await twoItemRx(a.drug.id, b.drug.id);
    const itemA = rx.items.find((i) => i.drugId === a.drug.id)!;
    const itemB = rx.items.find((i) => i.drugId === b.drug.id)!;

    // dispense A x5, leave B pending -> PARTIAL
    const first = await pharmacy.dispense(actor, rx.id, {
      items: [{ itemId: itemA.id, quantity: 5, unitPrice: 100 }, { itemId: itemB.id, quantity: 0, unitPrice: 100 }],
    });
    expect(first.dispenseStatus).toBe('PARTIAL');

    // pharmacist re-opens the still-partial rx and raises A's cumulative to 8 (B still pending)
    const second = await pharmacy.dispense(actor, rx.id, {
      items: [{ itemId: itemA.id, quantity: 8, unitPrice: 100 }, { itemId: itemB.id, quantity: 0, unitPrice: 100 }],
    });
    expect(second.dispenseStatus).toBe('PARTIAL');

    const drugA = await ownerPrisma.drug.findUnique({ where: { id: a.drug.id } });
    expect(drugA!.quantityOnHand).toBe(12); // 20 - 8 total, NOT 20 - 13
    const moves = await ownerPrisma.stockMovement.findMany({ where: { drugId: a.drug.id, type: 'DISPENSE' } });
    // first draw 5, then only the delta of 3 - never a second draw of 8
    expect(moves.map((m) => m.quantity).sort((x, y) => y - x)).toEqual([-3, -5]);

    const patientId = (await ownerPrisma.prescription.findUnique({ where: { id: rx.id }, select: { patientId: true } }))!.patientId;
    const lines = await ownerPrisma.invoiceLine.findMany({ where: { invoice: { patientId } } });
    // one charge for the first 5, one for the delta of 3 - never a second full charge of 8
    expect(lines.map((l) => Number(l.lineTotal)).sort((x, y) => x - y)).toEqual([300, 500]);
  });

  it('B3: concurrent dispense of the same drug never drives a batch negative', async () => {
    const { drug, earlier } = await drugWithBatches(10, 0); // exactly 10 in stock
    const rx1 = await prescriptionFor(drug.id);
    const rx2 = await prescriptionFor(drug.id);

    // two prescriptions, same drug, each asks for 8 -> only one can succeed
    const results = await Promise.allSettled([
      pharmacy.dispense(actor, rx1.id, { items: [{ itemId: rx1.items[0].id, quantity: 8, unitPrice: 100 }] }),
      pharmacy.dispense(actor, rx2.id, { items: [{ itemId: rx2.items[0].id, quantity: 8, unitPrice: 100 }] }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const bad = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    expect(bad[0].reason).toMatchObject({ response: { code: 'INSUFFICIENT_STOCK' } });

    const b = await ownerPrisma.drugBatch.findUnique({ where: { id: earlier.id } });
    expect(b!.quantity).toBe(2); // 10 - 8, never negative
    expect(b!.quantity).toBeGreaterThanOrEqual(0);
    const d = await ownerPrisma.drug.findUnique({ where: { id: drug.id } });
    expect(d!.quantityOnHand).toBe(2);
    const moves = await ownerPrisma.stockMovement.count({ where: { drugId: drug.id, type: 'DISPENSE' } });
    expect(moves).toBe(1);
  });
});
