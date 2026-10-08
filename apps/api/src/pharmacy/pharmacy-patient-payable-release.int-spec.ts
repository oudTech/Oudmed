import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../common/audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { BillingModule } from '../billing/billing.module';
import { BillingService } from '../billing/billing.service';
import { AdmissionsModule } from '../admissions/admissions.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { ScheduleService } from '../schedule/schedule.service';
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

/**
 * F2 release-gate concern raised 2026-10-09 (docs/audit/phase1-status.md):
 * releasing used to require the WHOLE invoice `PAID`. For an HMO patient
 * with a co-pay, that invoice includes the HMO's share, settled only
 * weeks later at remittance - waiting on it would mean a patient who has
 * already paid their own co-pay in full could never collect their drugs.
 * Fixed: release now waits only on the PATIENT's own payable share
 * (co-pay plus any uncovered charges on the same invoice) -
 * patientPayableAmount(), reusing the same resolver as the gate and
 * ClaimsService.generate(). A cash patient still needs the whole invoice
 * paid (coPayPct resolves to 100%), unchanged.
 */
describe('PharmacyService.release - patient-payable gate for HMO co-pay (integration)', () => {
  let prisma: PrismaService;
  let schedule: ScheduleService;
  let pharmacy: PharmacyService;
  let billing: BillingService;
  let tenantId: string;
  let pharmacistActor: { tenantId: string; userId: string; role: string };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, StorageModule, BillingModule, AdmissionsModule, ScheduleModule, PharmacyModule],
    }).compile();
    prisma = mod.get(PrismaService);
    schedule = mod.get(ScheduleService);
    pharmacy = mod.get(PharmacyService);
    billing = mod.get(BillingService);

    const tenant = await makeTenant();
    tenantId = tenant.id;
    await ownerPrisma.tenant.update({ where: { id: tenantId }, data: { requirePaymentBeforeDispense: true } });
    pharmacistActor = actorFor(tenantId, (await makeUser(tenantId, 'PHARMACIST')).id, 'PHARMACIST');
  });

  afterAll(async () => {
    await destroyTenant(tenantId);
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  async function makeDrug(sellPrice: number, qty: number) {
    const drug = await ownerPrisma.drug.create({
      data: { tenantId, sku: `MED-${Math.random().toString(36).slice(2, 8)}`, name: 'Test Drug', sellPrice, quantityOnHand: qty },
    });
    await ownerPrisma.drugBatch.create({
      data: { tenantId, drugId: drug.id, batchNumber: 'B1', expiryDate: day(180), quantity: qty },
    });
    return drug;
  }

  async function hmoVisit(coPayPct: number) {
    const provider = await ownerPrisma.insuranceProvider.create({
      data: { tenantId, name: `Payable HMO ${Math.random().toString(36).slice(2, 6)}`, kind: 'HMO', defaultCoPayPct: coPayPct },
    });
    const patient = await makePatient(tenantId, { insuranceProviderId: provider.id, hmoName: provider.name });
    const visit = await schedule.create(
      { tenantId, userId: pharmacistActor.userId, role: 'HOSPITAL_ADMIN' },
      { patientId: patient.id, startsAt: new Date().toISOString(), payerType: 'HMO' as any } as any,
    );
    return { provider, patient, visit };
  }

  it('an HMO patient who pays exactly their 10% co-pay can release - release never waits on the HMO share', async () => {
    const { patient, visit } = await hmoVisit(10);
    const drug = await makeDrug(100, 10); // 10 units @ 100 = 1000 gross
    const rx = await ownerPrisma.prescription.create({
      data: {
        tenantId, patientId: patient.id, visitId: visit.id, status: 'ACTIVE', dispenseStatus: 'PENDING',
        items: { create: [{ tenantId, drugId: drug.id, drugName: 'Test Drug' }] },
      },
      include: { items: true },
    });
    const item = rx.items[0];

    const prepared = await pharmacy.prepare(pharmacistActor, rx.id, { items: [{ itemId: item.id, quantity: 10 }] });
    const preparedItem = prepared.items.find((it: any) => it.id === item.id)!;
    expect(preparedItem.preparedQty).toBe(10);
    const line = await ownerPrisma.invoiceLine.findFirstOrThrow({ where: { id: preparedItem.preparedInvoiceLineId! } });
    expect(Number(line.lineTotal)).toBe(1000); // the full gross, not pre-reduced

    // Patient pays exactly their 10% share - 100, not the full 1000.
    await prisma.forTenant(tenantId, (tx) =>
      billing.postPaymentTx(tx, { tenantId, invoiceId: line.invoiceId, amount: 100, method: 'CASH', payerType: 'CASH', receivedById: pharmacistActor.userId }),
    );

    const result = await pharmacy.release(pharmacistActor, rx.id);
    expect(result.released).toContain(item.id);
    expect(result.stillAwaiting).toHaveLength(0);
    const itemAfter = await ownerPrisma.prescriptionItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(itemAfter.dispensedQty).toBe(10);
  });

  it('an unrelated uncovered charge on the same invoice still blocks release until the patient covers that share too', async () => {
    const { patient, visit } = await hmoVisit(10);
    const drug = await makeDrug(100, 10); // 10 units @ 100 = 1000 gross, patient share 100
    const rx = await ownerPrisma.prescription.create({
      data: {
        tenantId, patientId: patient.id, visitId: visit.id, status: 'ACTIVE', dispenseStatus: 'PENDING',
        items: { create: [{ tenantId, drugId: drug.id, drugName: 'Test Drug' }] },
      },
      include: { items: true },
    });
    const item = rx.items[0];

    const prepared = await pharmacy.prepare(pharmacistActor, rx.id, { items: [{ itemId: item.id, quantity: 10 }] });
    const preparedItem = prepared.items.find((it: any) => it.id === item.id)!;
    const line = await ownerPrisma.invoiceLine.findFirstOrThrow({ where: { id: preparedItem.preparedInvoiceLineId! } });

    // An unrelated consultation charge lands on the SAME invoice (same
    // visit) - adds 500 gross, patient share +50, for a total patient
    // share of 150 on this invoice.
    await prisma.forTenant(tenantId, (tx) =>
      billing.postChargeToVisit(tx, {
        tenantId, userId: pharmacistActor.userId, visitId: visit.id, patientId: patient.id,
        description: 'Consultation', quantity: 1, unitPrice: 500, category: 'Consultation',
      }),
    );

    // Paying only the drug's own 10% share (100) is not enough - the
    // invoice's total patient-payable is now 150.
    await prisma.forTenant(tenantId, (tx) =>
      billing.postPaymentTx(tx, { tenantId, invoiceId: line.invoiceId, amount: 100, method: 'CASH', payerType: 'CASH', receivedById: pharmacistActor.userId }),
    );
    const blocked = await pharmacy.release(pharmacistActor, rx.id);
    expect(blocked.released).toHaveLength(0);
    expect(blocked.stillAwaiting[0]?.itemId).toBe(item.id);
    expect(blocked.stillAwaiting[0]?.reason).toMatch(/50/);

    // Paying the remaining 50 (total 150, the full patient-payable share
    // of this invoice) releases the full quantity.
    await prisma.forTenant(tenantId, (tx) =>
      billing.postPaymentTx(tx, { tenantId, invoiceId: line.invoiceId, amount: 50, method: 'CASH', payerType: 'CASH', receivedById: pharmacistActor.userId }),
    );
    const released = await pharmacy.release(pharmacistActor, rx.id);
    expect(released.released).toContain(item.id);
    const itemAfter = await ownerPrisma.prescriptionItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(itemAfter.dispensedQty).toBe(10);
  });

  it('a cash patient (no provider) still needs the whole invoice paid, unchanged', async () => {
    const patient = await makePatient(tenantId);
    const visit = await schedule.create(
      { tenantId, userId: pharmacistActor.userId, role: 'HOSPITAL_ADMIN' },
      { patientId: patient.id, startsAt: new Date().toISOString() } as any,
    );
    const drug = await makeDrug(100, 10);
    const rx = await ownerPrisma.prescription.create({
      data: {
        tenantId, patientId: patient.id, visitId: visit.id, status: 'ACTIVE', dispenseStatus: 'PENDING',
        items: { create: [{ tenantId, drugId: drug.id, drugName: 'Test Drug' }] },
      },
      include: { items: true },
    });
    const item = rx.items[0];
    const prepared = await pharmacy.prepare(pharmacistActor, rx.id, { items: [{ itemId: item.id, quantity: 10 }] });
    const preparedItem = prepared.items.find((it: any) => it.id === item.id)!;
    const line = await ownerPrisma.invoiceLine.findFirstOrThrow({ where: { id: preparedItem.preparedInvoiceLineId! } });

    await prisma.forTenant(tenantId, (tx) =>
      billing.postPaymentTx(tx, { tenantId, invoiceId: line.invoiceId, amount: 500, method: 'CASH', payerType: 'CASH', receivedById: pharmacistActor.userId }),
    );
    const partial = await pharmacy.release(pharmacistActor, rx.id);
    expect(partial.released).toHaveLength(0); // 500 of 1000 - still short

    await prisma.forTenant(tenantId, (tx) =>
      billing.postPaymentTx(tx, { tenantId, invoiceId: line.invoiceId, amount: 500, method: 'CASH', payerType: 'CASH', receivedById: pharmacistActor.userId }),
    );
    const full = await pharmacy.release(pharmacistActor, rx.id);
    expect(full.released).toContain(item.id);
  });
});
