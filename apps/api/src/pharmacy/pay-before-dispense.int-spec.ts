import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../common/audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { BillingModule } from '../billing/billing.module';
import { BillingService } from '../billing/billing.service';
import { AdmissionsModule } from '../admissions/admissions.module';
import { AdmissionsService } from '../admissions/admissions.service';
import { PharmacyModule } from './pharmacy.module';
import { PharmacyService } from './pharmacy.service';
import {
  actorFor,
  destroyTenant,
  makePatient,
  makeTenant,
  makeUser,
  makeVisit,
  ownerPrisma,
} from '../../test/int-helpers';

const day = (n: number) => new Date(Date.now() + n * 86_400_000);

/**
 * F2: pay-before-dispense. The gate (`Tenant.requirePaymentBeforeDispense`)
 * is per-hospital and off by default - every test here turns it on directly
 * on this suite's own tenant, so the existing pharmacy.int-spec.ts suite
 * (gate off, untouched) stays a true control group.
 */
describe('PharmacyService.prepare/release/cancelPreparation (integration - F2)', () => {
  let prisma: PrismaService;
  let billing: BillingService;
  let pharmacy: PharmacyService;
  let admissions: AdmissionsService;
  let tenantId: string;
  let pharmacistActor: { tenantId: string; userId: string; role: string };
  let nurseActor: { tenantId: string; userId: string; role: string };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, StorageModule, BillingModule, AdmissionsModule, PharmacyModule],
    }).compile();
    prisma = mod.get(PrismaService);
    billing = mod.get(BillingService);
    pharmacy = mod.get(PharmacyService);
    admissions = mod.get(AdmissionsService);

    const tenant = await makeTenant();
    tenantId = tenant.id;
    await ownerPrisma.tenant.update({ where: { id: tenantId }, data: { requirePaymentBeforeDispense: true, shortStayChargeMode: 'NONE' } });
    pharmacistActor = actorFor(tenantId, (await makeUser(tenantId, 'PHARMACIST')).id, 'PHARMACIST');
    nurseActor = actorFor(tenantId, (await makeUser(tenantId, 'NURSE')).id, 'NURSE');
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
    const batch = await ownerPrisma.drugBatch.create({
      data: { tenantId, drugId: drug.id, batchNumber: 'B1', expiryDate: day(180), quantity: qty },
    });
    return { drug, batch };
  }

  async function makeRx(drugId: string, extra: Record<string, unknown> = {}) {
    const patient = await makePatient(tenantId);
    const rx = await ownerPrisma.prescription.create({
      data: {
        tenantId, patientId: patient.id, status: 'ACTIVE', dispenseStatus: 'PENDING',
        items: { create: [{ tenantId, drugId, drugName: 'Test Drug' }] },
        ...extra,
      },
      include: { items: true },
    });
    return { patient, rx, item: rx.items[0] };
  }

  it('prepare posts a charge with no stock movement; release draws stock only once the invoice is paid; release while unpaid changes nothing', async () => {
    const { drug, batch } = await makeDrug(100, 10);
    const patient = await makePatient(tenantId);
    const visit = await makeVisit(tenantId, patient.id);
    const { rx, item } = await makeRx(drug.id, { visitId: visit.id });

    const prepared = await pharmacy.prepare(pharmacistActor, rx.id, { items: [{ itemId: item.id, quantity: 5 }] });
    expect(prepared.dispenseStatus).toBe('AWAITING_PAYMENT');
    const itemAfterPrepare = prepared.items.find((i) => i.id === item.id)!;
    expect(itemAfterPrepare.preparedQty).toBe(5);
    expect(itemAfterPrepare.dispensedQty ?? 0).toBe(0);
    expect(itemAfterPrepare.preparedInvoiceLineId).not.toBeNull();

    const batchAfterPrepare = await ownerPrisma.drugBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(batchAfterPrepare.quantity).toBe(10); // no stock movement at all
    const drugAfterPrepare = await ownerPrisma.drug.findUniqueOrThrow({ where: { id: drug.id } });
    expect(drugAfterPrepare.quantityOnHand).toBe(10);

    // release while the invoice is still unpaid: nothing changes
    const blocked = await pharmacy.release(pharmacistActor, rx.id);
    expect(blocked.released).toHaveLength(0);
    expect(blocked.stillAwaiting).toHaveLength(1);
    const batchStillUntouched = await ownerPrisma.drugBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(batchStillUntouched.quantity).toBe(10);

    // pay the invoice in full, then release actually draws stock
    const invoiceId = (await ownerPrisma.invoiceLine.findFirst({ where: { id: itemAfterPrepare.preparedInvoiceLineId! } }))!.invoiceId;
    await prisma.forTenant(tenantId, (tx) =>
      billing.postPaymentTx(tx, { tenantId, invoiceId, amount: 500, method: 'CASH', payerType: 'CASH', receivedById: pharmacistActor.userId }),
    );

    const result = await pharmacy.release(pharmacistActor, rx.id);
    expect(result.released).toEqual([item.id]);
    expect(result.stillAwaiting).toHaveLength(0);

    const itemAfterRelease = await ownerPrisma.prescriptionItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(itemAfterRelease.dispensedQty).toBe(5);
    expect(itemAfterRelease.preparedQty).toBe(0);
    expect(itemAfterRelease.preparedInvoiceLineId).toBeNull();

    const batchAfterRelease = await ownerPrisma.drugBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(batchAfterRelease.quantity).toBe(5); // drawn only now, at release
    const drugAfterRelease = await ownerPrisma.drug.findUniqueOrThrow({ where: { id: drug.id } });
    expect(drugAfterRelease.quantityOnHand).toBe(5);

    const rxAfter = await ownerPrisma.prescription.findUniqueOrThrow({ where: { id: rx.id } });
    expect(rxAfter.dispenseStatus).toBe('DISPENSED');
  });

  it('cancel-preparation voids the prepared charge, requires a reason, is audited, and moves no stock', async () => {
    const { drug, batch } = await makeDrug(50, 10);
    const patient = await makePatient(tenantId);
    const visit = await makeVisit(tenantId, patient.id);
    const { rx, item } = await makeRx(drug.id, { visitId: visit.id });

    const prepared = await pharmacy.prepare(pharmacistActor, rx.id, { items: [{ itemId: item.id, quantity: 3 }] });
    const preparedLineId = prepared.items.find((i) => i.id === item.id)!.preparedInvoiceLineId!;
    const invoiceId = (await ownerPrisma.invoiceLine.findFirst({ where: { id: preparedLineId } }))!.invoiceId;

    await expect(
      pharmacy.cancelPreparation(pharmacistActor, rx.id, item.id, { reason: '' } as any),
    ).rejects.toThrow(/reason/i);

    await pharmacy.cancelPreparation(pharmacistActor, rx.id, item.id, { reason: 'patient never came back to pay' });

    const itemAfter = await ownerPrisma.prescriptionItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(itemAfter.preparedQty).toBe(0);
    expect(itemAfter.preparedInvoiceLineId).toBeNull();

    const rxAfter = await ownerPrisma.prescription.findUniqueOrThrow({ where: { id: rx.id } });
    expect(rxAfter.dispenseStatus).toBe('PENDING');

    // the only line on that invoice - cancelled outright rather than left at zero lines
    const invoiceAfter = await ownerPrisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(invoiceAfter.status).toBe('CANCELLED');

    const batchAfter = await ownerPrisma.drugBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(batchAfter.quantity).toBe(10); // never touched

    const log = await ownerPrisma.auditLog.findFirst({
      where: { tenantId, entityId: item.id, action: 'CANCEL_PREPARATION' },
    });
    expect(log).not.toBeNull();
  });

  it('HMO co-pay split: 30% co-pay dispenses the covered share immediately and gates only the co-pay share; 0% co-pay gates nothing', async () => {
    const provider30 = await ownerPrisma.insuranceProvider.create({
      data: { tenantId, name: 'Split HMO', kind: 'HMO', defaultCoPayPct: 30 },
    });
    const { drug: drugA, batch: batchA } = await makeDrug(100, 20);
    const patientA = await makePatient(tenantId, { insuranceProviderId: provider30.id });
    const visitA = await makeVisit(tenantId, patientA.id, { insuranceProviderId: provider30.id, payerType: 'HMO', hmoName: 'Split HMO' });
    const { rx: rxA, item: itemA } = await makeRx(drugA.id, { visitId: visitA.id });

    const preparedA = await pharmacy.prepare(pharmacistActor, rxA.id, { items: [{ itemId: itemA.id, quantity: 10 }] });
    const itemAAfter = preparedA.items.find((i) => i.id === itemA.id)!;
    // 30% co-pay -> 70% covered: round(10*0.7) = 7 covered immediately, 3 gated
    expect(itemAAfter.dispensedQty).toBe(7);
    expect(itemAAfter.preparedQty).toBe(3);
    const batchAAfter = await ownerPrisma.drugBatch.findUniqueOrThrow({ where: { id: batchA.id } });
    expect(batchAAfter.quantity).toBe(13); // only the covered 7 drawn now

    const provider0 = await ownerPrisma.insuranceProvider.create({
      data: { tenantId, name: 'Full Cover HMO', kind: 'HMO', defaultCoPayPct: 0 },
    });
    const { drug: drugB, batch: batchB } = await makeDrug(100, 20);
    const patientB = await makePatient(tenantId, { insuranceProviderId: provider0.id });
    const visitB = await makeVisit(tenantId, patientB.id, { insuranceProviderId: provider0.id, payerType: 'HMO', hmoName: 'Full Cover HMO' });
    const { rx: rxB, item: itemB } = await makeRx(drugB.id, { visitId: visitB.id });

    const preparedB = await pharmacy.prepare(pharmacistActor, rxB.id, { items: [{ itemId: itemB.id, quantity: 10 }] });
    const itemBAfter = preparedB.items.find((i) => i.id === itemB.id)!;
    expect(itemBAfter.dispensedQty).toBe(10);
    expect(itemBAfter.preparedQty).toBe(0);
    expect(preparedB.dispenseStatus).toBe('DISPENSED'); // fully exempt, no gate at all
    const batchBAfter = await ownerPrisma.drugBatch.findUniqueOrThrow({ where: { id: batchB.id } });
    expect(batchBAfter.quantity).toBe(10); // all 10 drawn immediately
  });

  it('an admitted patient bypasses the gate entirely, regardless of the tenant setting', async () => {
    const ward = await ownerPrisma.ward.create({
      data: { tenantId, name: `Ward ${Math.random().toString(36).slice(2, 8)}`, wardType: 'GENERAL', dailyRate: 15000 },
    });
    const bed = await ownerPrisma.bed.create({ data: { tenantId, wardId: ward.id, label: 'A1' } });
    const patient = await makePatient(tenantId);
    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);

    const { drug, batch } = await makeDrug(100, 10);
    const { rx, item } = await makeRx(drug.id, { admissionId: admission.id, patientId: patient.id });

    const prepared = await pharmacy.prepare(pharmacistActor, rx.id, { items: [{ itemId: item.id, quantity: 4 }] });
    const itemAfter = prepared.items.find((i) => i.id === item.id)!;
    expect(itemAfter.dispensedQty).toBe(4);
    expect(itemAfter.preparedQty).toBe(0);
    expect(prepared.dispenseStatus).toBe('DISPENSED');
    const batchAfter = await ownerPrisma.drugBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(batchAfter.quantity).toBe(6); // drawn immediately, gate never applied
  });

  it('emergency override: rejected without a reason, succeeds and is audited with one, blocked for an unauthorized role', async () => {
    const { drug, batch } = await makeDrug(100, 10);
    const patient = await makePatient(tenantId);
    const visit = await makeVisit(tenantId, patient.id);
    const { rx, item } = await makeRx(drug.id, { visitId: visit.id });

    // plain dispense() while the gate is on, no override at all
    await expect(
      pharmacy.dispense(pharmacistActor, rx.id, { items: [{ itemId: item.id, quantity: 2 }] } as any),
    ).rejects.toThrow(/requires payment before dispensing/);

    // override flagged but no reason
    await expect(
      pharmacy.dispense(pharmacistActor, rx.id, { items: [{ itemId: item.id, quantity: 2 }], emergencyOverride: true } as any),
    ).rejects.toThrow(/reason/i);

    // NURSE never had prescription:dispense at all - blocked before the override logic is even reached
    await expect(
      pharmacy.dispense(nurseActor, rx.id, { items: [{ itemId: item.id, quantity: 2 }], emergencyOverride: true, emergencyReason: 'trauma case' } as any),
    ).rejects.toThrow();

    const dispensed = await pharmacy.dispense(pharmacistActor, rx.id, {
      items: [{ itemId: item.id, quantity: 2 }], emergencyOverride: true, emergencyReason: 'trauma case, no time to collect payment first',
    } as any);
    expect(dispensed.dispenseStatus).toBe('DISPENSED');
    const itemAfter = await ownerPrisma.prescriptionItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(itemAfter.dispensedQty).toBe(2);
    expect(itemAfter.preparedQty).toBe(0); // the old one-step path, nothing gated
    const batchAfter = await ownerPrisma.drugBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(batchAfter.quantity).toBe(8);

    const log = await ownerPrisma.auditLog.findFirst({
      where: { tenantId, entityId: rx.id, action: 'EMERGENCY_DISPENSE_OVERRIDE' },
    });
    expect(log).not.toBeNull();
    expect((log?.metadata as any)?.reason).toBe('trauma case, no time to collect payment first');
  });

  it('two preparations for the same visit land on primary vs supplementary invoices and release independently', async () => {
    const { drug: drugA, batch: batchA } = await makeDrug(1000, 5);
    const { drug: drugB, batch: batchB } = await makeDrug(2000, 5);
    const patient = await makePatient(tenantId);
    const visit = await makeVisit(tenantId, patient.id);
    const { rx: rxA, item: itemA } = await makeRx(drugA.id, { visitId: visit.id });

    const preparedA = await pharmacy.prepare(pharmacistActor, rxA.id, { items: [{ itemId: itemA.id, quantity: 1 }] });
    const lineA = preparedA.items.find((i) => i.id === itemA.id)!.preparedInvoiceLineId!;
    const invoiceAId = (await ownerPrisma.invoiceLine.findFirst({ where: { id: lineA } }))!.invoiceId;

    // lock the primary invoice with a real payment so the next preparation
    // opens a supplementary invoice instead (FUNC-2 mechanism).
    await prisma.forTenant(tenantId, (tx) =>
      billing.postPaymentTx(tx, { tenantId, invoiceId: invoiceAId, amount: 1000, method: 'CASH', payerType: 'CASH', receivedById: pharmacistActor.userId }),
    );

    const { rx: rxB, item: itemB } = await makeRx(drugB.id, { visitId: visit.id });
    const preparedB = await pharmacy.prepare(pharmacistActor, rxB.id, { items: [{ itemId: itemB.id, quantity: 1 }] });
    const lineB = preparedB.items.find((i) => i.id === itemB.id)!.preparedInvoiceLineId!;
    const invoiceBId = (await ownerPrisma.invoiceLine.findFirst({ where: { id: lineB } }))!.invoiceId;
    expect(invoiceBId).not.toBe(invoiceAId);

    // A's invoice is already paid (from the lock above) - releasing A works immediately
    const releaseA = await pharmacy.release(pharmacistActor, rxA.id);
    expect(releaseA.released).toEqual([itemA.id]);

    // B's own invoice is still unpaid - independently gated
    const releaseBBefore = await pharmacy.release(pharmacistActor, rxB.id);
    expect(releaseBBefore.released).toHaveLength(0);

    await prisma.forTenant(tenantId, (tx) =>
      billing.postPaymentTx(tx, { tenantId, invoiceId: invoiceBId, amount: 2000, method: 'CASH', payerType: 'CASH', receivedById: pharmacistActor.userId }),
    );
    const releaseBAfter = await pharmacy.release(pharmacistActor, rxB.id);
    expect(releaseBAfter.released).toEqual([itemB.id]);

    const batchAAfter = await ownerPrisma.drugBatch.findUniqueOrThrow({ where: { id: batchA.id } });
    const batchBAfter = await ownerPrisma.drugBatch.findUniqueOrThrow({ where: { id: batchB.id } });
    expect(batchAAfter.quantity).toBe(4);
    expect(batchBAfter.quantity).toBe(4);
  });
});
