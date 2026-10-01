import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../common/audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { BillingModule } from '../billing/billing.module';
import { BillingService } from '../billing/billing.service';
import { AdmissionsModule } from '../admissions/admissions.module';
import { AdmissionsService } from '../admissions/admissions.service';
import { ReportsModule } from './reports.module';
import { ReportsService } from './reports.service';
import { actorFor, destroyTenant, makePatient, makeTenant, makeUser, ownerPrisma } from '../../test/int-helpers';

/**
 * F1 condition 1: deposits and their refunds are cash received/returned and
 * must appear in the same payment ledger as invoice payments, clearly
 * labelled, without counting as revenue.
 */
describe('ReportsService.payments (integration - deposits as cash)', () => {
  let admissions: AdmissionsService;
  let reports: ReportsService;
  let tenantId: string;
  let nurseActor: { tenantId: string; userId: string; role: string };
  let accountantActor: { tenantId: string; userId: string; role: string };
  let receptionActor: { tenantId: string; userId: string; role: string };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, StorageModule, BillingModule, AdmissionsModule, ReportsModule],
    }).compile();
    admissions = mod.get(AdmissionsService);
    reports = mod.get(ReportsService);

    const tenant = await makeTenant();
    tenantId = tenant.id;
    // Same-day admit+discharge in these tests would otherwise also trigger
    // F1b's short-stay charge under the default MINIMUM_FULL_DAY, muddying
    // the deposit-math assertions below with an extra, unrelated amount.
    await ownerPrisma.tenant.update({ where: { id: tenant.id }, data: { shortStayChargeMode: 'NONE' } });
    nurseActor = actorFor(tenantId, (await makeUser(tenantId, 'NURSE')).id, 'NURSE');
    accountantActor = actorFor(tenantId, (await makeUser(tenantId, 'ACCOUNTANT')).id, 'ACCOUNTANT');
    receptionActor = actorFor(tenantId, (await makeUser(tenantId, 'RECEPTIONIST')).id, 'RECEPTIONIST');
  });

  afterAll(async () => {
    await destroyTenant(tenantId);
    await ownerPrisma.$disconnect();
  });

  it('lists a deposit and its refund as separate, clearly-labelled cash entries', async () => {
    const ward = await ownerPrisma.ward.create({
      data: { tenantId, name: `Ward ${Math.random().toString(36).slice(2, 8)}`, wardType: 'GENERAL', dailyRate: 15000 },
    });
    const bed = await ownerPrisma.bed.create({ data: { tenantId, wardId: ward.id, label: 'A1' } });
    const patient = await makePatient(tenantId);
    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);

    const deposit = await admissions.addDeposit(receptionActor, admission.id, { amount: 50000, method: 'CASH' } as any);
    await admissions.refundDeposit(accountantActor, admission.id, deposit.id, { amount: 20000, reason: 'overpaid' } as any);

    const from = new Date(Date.now() - 60_000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const res = await reports.payments(accountantActor, { from, to });

    const depositRow = res.rows.find((r) => r.entryType === 'DEPOSIT');
    const refundRow = res.rows.find((r) => r.entryType === 'DEPOSIT_REFUND');
    expect(depositRow).toBeDefined();
    expect(depositRow!.amount).toBe('50000');
    expect(depositRow!.admissionId).toBe(admission.id);
    expect(refundRow).toBeDefined();
    expect(refundRow!.amount).toBe('20000');
    expect(refundRow!.comment).toBe('overpaid');

    // net cash: deposit in, minus refund out, no invoice payments in this window
    expect(res.totalAmount).toBe('30000');
  });

  it('F1 condition 3: a deposit never moves revenue/collection KPIs, and appears separately as a held liability', async () => {
    const ward = await ownerPrisma.ward.create({
      data: { tenantId, name: `Ward ${Math.random().toString(36).slice(2, 8)}`, wardType: 'GENERAL', dailyRate: 15000 },
    });
    const bed = await ownerPrisma.bed.create({ data: { tenantId, wardId: ward.id, label: 'A1' } });
    const patient = await makePatient(tenantId);
    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);

    const from = new Date(Date.now() - 60_000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const before = await reports.overview(accountantActor, { from, to });
    const revenueBefore = before.finance.find((k) => k.key === 'total_collection')!.value;
    const depositsHeldBefore = Number(before.finance.find((k) => k.key === 'deposits_held')!.value);

    await admissions.addDeposit(receptionActor, admission.id, { amount: 75000, method: 'CASH' } as any);

    const after = await reports.overview(accountantActor, { from, to });
    const revenueAfter = after.finance.find((k) => k.key === 'total_collection')!.value;
    const depositsHeldAfter = Number(after.finance.find((k) => k.key === 'deposits_held')!.value);

    // taking a deposit must not move the collections/revenue KPI at all...
    expect(revenueAfter).toBe(revenueBefore);
    // ...but must show up, separately, as held liability.
    expect(depositsHeldAfter - depositsHeldBefore).toBe(75000);
  });

  it('F1c: deposits_held excludes applied and pending-refund amounts; refunds_owed reports the pending remainder', async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, StorageModule, BillingModule, AdmissionsModule, ReportsModule],
    }).compile();
    const prisma = mod.get(PrismaService);
    const billing = mod.get(BillingService);

    const ward = await ownerPrisma.ward.create({
      data: { tenantId, name: `Ward ${Math.random().toString(36).slice(2, 8)}`, wardType: 'GENERAL', dailyRate: 15000 },
    });
    const bed = await ownerPrisma.bed.create({ data: { tenantId, wardId: ward.id, label: 'A1' } });
    const patient = await makePatient(tenantId);
    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);
    await prisma.forTenant(tenantId, (tx) =>
      billing.postCharge(tx, {
        tenantId, userId: nurseActor.userId, admissionId: admission.id, patientId: patient.id,
        description: 'Ward charge', quantity: 1, unitPrice: 20000, category: 'Inpatient',
      }),
    );

    const from = new Date(Date.now() - 60_000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const before = await reports.overview(accountantActor, { from, to });
    const heldBefore = Number(before.finance.find((k) => k.key === 'deposits_held')!.value);
    const owedBefore = Number(before.finance.find((k) => k.key === 'refunds_owed')!.value);

    // 20000 charged, 50000 deposited - discharge applies 20000 and leaves
    // 30000 as a pending refund (no refundMethod given).
    await admissions.addDeposit(receptionActor, admission.id, { amount: 50000, method: 'CASH' } as any);
    await admissions.discharge(nurseActor, admission.id, { status: 'DISCHARGED' } as any);

    const after = await reports.overview(accountantActor, { from, to });
    const heldAfter = Number(after.finance.find((k) => k.key === 'deposits_held')!.value);
    const owedAfter = Number(after.finance.find((k) => k.key === 'refunds_owed')!.value);
    // the whole 50000 left "deposits held" - none of it is still spendable
    expect(heldAfter - heldBefore).toBe(0);
    // and the unapplied 30000 shows up as owed to the patient
    expect(owedAfter - owedBefore).toBe(30000);
  });
});
