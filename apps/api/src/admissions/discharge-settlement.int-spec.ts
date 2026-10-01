import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../common/audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { BillingModule } from '../billing/billing.module';
import { BillingService } from '../billing/billing.service';
import { AdmissionsModule } from './admissions.module';
import { AdmissionsService } from './admissions.service';
import { actorFor, destroyTenant, makePatient, makeTenant, makeUser, ownerPrisma } from '../../test/int-helpers';

/**
 * F1c: discharge's settlement gate/override, automatic deposit application,
 * the mandatory refund of any remainder, and the explicit apply-deposit
 * endpoint's multi-invoice/multi-deposit allocation.
 */
describe('AdmissionsService discharge settlement (integration - F1c)', () => {
  let prisma: PrismaService;
  let admissions: AdmissionsService;
  let billing: BillingService;
  let tenantId: string;
  let nurseActor: { tenantId: string; userId: string; role: string };
  let adminActor: { tenantId: string; userId: string; role: string };
  let accountantActor: { tenantId: string; userId: string; role: string };
  let receptionActor: { tenantId: string; userId: string; role: string };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, StorageModule, BillingModule, AdmissionsModule],
    }).compile();
    prisma = mod.get(PrismaService);
    admissions = mod.get(AdmissionsService);
    billing = mod.get(BillingService);

    const tenant = await makeTenant();
    tenantId = tenant.id;
    // admitWithCharge() admits and discharges the same instant for most of
    // these tests - a same-day stay, which would otherwise also trigger the
    // short-stay charge (F1b) under the default MINIMUM_FULL_DAY and muddy
    // the settlement-math assertions below with an extra, unrelated amount.
    await ownerPrisma.tenant.update({ where: { id: tenant.id }, data: { shortStayChargeMode: 'NONE' } });
    nurseActor = actorFor(tenantId, (await makeUser(tenantId, 'NURSE')).id, 'NURSE');
    const admin = await makeUser(tenantId, 'HOSPITAL_ADMIN');
    adminActor = actorFor(tenantId, admin.id, 'HOSPITAL_ADMIN');
    accountantActor = actorFor(tenantId, (await makeUser(tenantId, 'ACCOUNTANT')).id, 'ACCOUNTANT');
    receptionActor = actorFor(tenantId, (await makeUser(tenantId, 'RECEPTIONIST')).id, 'RECEPTIONIST');
  });

  afterAll(async () => {
    await destroyTenant(tenantId);
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  async function makeWard(dailyRate: number | null = 15000) {
    const ward = await ownerPrisma.ward.create({
      data: { tenantId, name: `Ward ${Math.random().toString(36).slice(2, 8)}`, wardType: 'GENERAL', dailyRate },
    });
    const bed = await ownerPrisma.bed.create({ data: { tenantId, wardId: ward.id, label: 'A1' } });
    return { ward, bed };
  }

  async function admitWithCharge(amount: number) {
    const { ward, bed } = await makeWard(15000);
    const patient = await makePatient(tenantId);
    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);
    await prisma.forTenant(tenantId, (tx) =>
      billing.postCharge(tx, {
        tenantId, userId: nurseActor.userId, admissionId: admission.id, patientId: patient.id,
        description: 'Ward charge', quantity: 1, unitPrice: amount, category: 'Inpatient',
      }),
    );
    return { admission, patient };
  }

  it('discharge with an outstanding balance succeeds by default (gate is off)', async () => {
    const { admission } = await admitWithCharge(30000);
    const discharged = await admissions.discharge(nurseActor, admission.id, { status: 'DISCHARGED' } as any);
    expect(discharged.status).toBe('DISCHARGED');
    const bill = await admissions.bill(tenantId, admission.id);
    expect(bill.balance).toBe('30000');
  });

  it('gate on: discharge blocked without a reason, blocked for a non-admin even with one, allowed for admin', async () => {
    await ownerPrisma.tenant.update({ where: { id: tenantId }, data: { requireSettledBillAtDischarge: true } });
    const { admission } = await admitWithCharge(30000);

    await expect(
      admissions.discharge(nurseActor, admission.id, { status: 'DISCHARGED' } as any),
    ).rejects.toThrow(/outstanding balance/);

    await expect(
      admissions.discharge(nurseActor, admission.id, { status: 'DISCHARGED', overrideReason: 'patient left' } as any),
    ).rejects.toThrow(); // NURSE has admission:discharge but not admission:discharge-unsettled

    const discharged = await admissions.discharge(adminActor, admission.id, {
      status: 'DISCHARGED', overrideReason: 'family emergency, will pay later',
    } as any);
    expect(discharged.status).toBe('DISCHARGED');

    const log = await ownerPrisma.auditLog.findFirst({
      where: { tenantId, entityId: admission.id, action: 'DISCHARGE_UNSETTLED_OVERRIDE' },
    });
    expect(log).not.toBeNull();
    await ownerPrisma.tenant.update({ where: { id: tenantId }, data: { requireSettledBillAtDischarge: false } });
  });

  it('auto-applies a deposit smaller than the balance; the rest is still owed, no refund needed', async () => {
    const { admission } = await admitWithCharge(30000);
    await admissions.addDeposit(receptionActor, admission.id, { amount: 10000, method: 'CASH' } as any);

    const discharged = await admissions.discharge(nurseActor, admission.id, { status: 'DISCHARGED' } as any);
    expect(discharged.status).toBe('DISCHARGED');

    const bill = await admissions.bill(tenantId, admission.id);
    expect(bill.totalPaid).toBe('10000'); // the deposit, now a real Payment
    expect(bill.totalDeposited).toBe('0'); // fully consumed
    expect(bill.balance).toBe('20000'); // 30000 - 10000
  });

  it('deposit larger than the balance requires a refund method before discharge completes', async () => {
    const { admission } = await admitWithCharge(20000);
    await admissions.addDeposit(receptionActor, admission.id, { amount: 50000, method: 'CASH' } as any);

    await expect(
      admissions.discharge(nurseActor, admission.id, { status: 'DISCHARGED' } as any),
    ).rejects.toThrow(/deposit credit of 30000 remains/);

    const discharged = await admissions.discharge(adminActor, admission.id, {
      status: 'DISCHARGED', refundMethod: 'CASH', refundReference: 'overpaid',
    } as any);
    expect(discharged.status).toBe('DISCHARGED');

    const bill = await admissions.bill(tenantId, admission.id);
    expect(bill.totalPaid).toBe('20000'); // exactly the amount owed, applied
    expect(bill.totalDeposited).toBe('0'); // the rest refunded
    expect(bill.balance).toBe('0');

    const deposit = await ownerPrisma.admissionDeposit.findFirst({ where: { admissionId: admission.id } });
    expect(Number(deposit!.appliedAmount)).toBe(20000);
    expect(Number(deposit!.refundedAmount)).toBe(30000);
    expect(deposit!.refundReceiptNumber).toBeTruthy();
  });

  it('applyDeposit(): splits one request across multiple deposits, oldest first', async () => {
    const { admission, patient } = await admitWithCharge(10000);
    await prisma.forTenant(tenantId, (tx) =>
      billing.postChargeToAdmission(tx, {
        tenantId, userId: nurseActor.userId, admissionId: admission.id, patientId: patient.id,
        description: 'More charges', quantity: 1, unitPrice: 15000, category: 'Inpatient',
      }),
    );

    const dep1 = await admissions.addDeposit(receptionActor, admission.id, { amount: 8000, method: 'CASH' } as any);
    await admissions.addDeposit(receptionActor, admission.id, { amount: 20000, method: 'TRANSFER' } as any);

    const result = await admissions.applyDeposit(accountantActor, admission.id, { amount: 25000 } as any);
    expect(result.applied).toBe('25000');

    const bill = await admissions.bill(tenantId, admission.id);
    expect(bill.totalPaid).toBe('25000');
    expect(bill.totalDeposited).toBe('3000'); // 28000 available - 25000 applied

    const dep1After = await ownerPrisma.admissionDeposit.findFirst({ where: { id: dep1.id } });
    expect(Number(dep1After!.appliedAmount)).toBe(8000); // the older deposit fully consumed first
  });

  it('applyDeposit(): rejects an amount exceeding either available credit or amount owed', async () => {
    const { admission } = await admitWithCharge(10000);
    await admissions.addDeposit(receptionActor, admission.id, { amount: 5000, method: 'CASH' } as any);

    await expect(
      admissions.applyDeposit(accountantActor, admission.id, { amount: 6000 } as any),
    ).rejects.toThrow(/available deposit credit/);

    await admissions.addDeposit(receptionActor, admission.id, { amount: 20000, method: 'CASH' } as any);
    await expect(
      admissions.applyDeposit(accountantActor, admission.id, { amount: 15000 } as any),
    ).rejects.toThrow(/amount owed/);
  });

  it('a refund receipt is distinct from the deposit-taken receipt and retrievable afterward', async () => {
    const { admission } = await admitWithCharge(5000);
    const deposit = await admissions.addDeposit(receptionActor, admission.id, { amount: 10000, method: 'CASH' } as any);
    const before = await admissions.depositReceipt(tenantId, admission.id, deposit.id);
    expect(before.isRefund).toBe(false);
    expect(before.receiptNumber).toBe(deposit.receiptNumber);

    const { refundReceiptNumber } = await admissions.refundDeposit(accountantActor, admission.id, deposit.id, {
      amount: 5000, reason: 'patient declined extra tests',
    } as any);
    expect(refundReceiptNumber).not.toBe(deposit.receiptNumber);

    const after = await admissions.depositReceipt(tenantId, admission.id, deposit.id);
    expect(after.isRefund).toBe(true);
    expect(after.receiptNumber).toBe(refundReceiptNumber);
    expect(after.amount).toBe('5000');
  });
});
