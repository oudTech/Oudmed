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
 * F1a: admission episode (running bill), deposits ledger, and the ward-rate
 * hard stop. Daily bed charges, transfers' billing impact, discharge
 * settlement and claims are F1b/c/d - not exercised here.
 */
describe('AdmissionsService (integration - F1a)', () => {
  let prisma: PrismaService;
  let admissions: AdmissionsService;
  let billing: BillingService;
  let tenantId: string;
  let nurseActor: { tenantId: string; userId: string; role: string };
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
    nurseActor = actorFor(tenantId, (await makeUser(tenantId, 'NURSE')).id, 'NURSE');
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

  it('cannot admit into a ward with no dailyRate set', async () => {
    const { bed } = await makeWard(null);
    const patient = await makePatient(tenantId);
    await expect(
      admissions.admit(nurseActor, {
        patientId: patient.id, wardId: bed.wardId, bedId: bed.id, admissionType: 'ELECTIVE',
      } as any),
    ).rejects.toThrow(/no daily rate/);
  });

  it('admit creates the admission, occupies the bed, and opens the first ward-stay row', async () => {
    const { ward, bed } = await makeWard(15000);
    const patient = await makePatient(tenantId);

    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);

    const updatedBed = await ownerPrisma.bed.findUnique({ where: { id: bed.id } });
    expect(updatedBed!.status).toBe('OCCUPIED');

    const stays = await ownerPrisma.admissionWardStay.findMany({ where: { admissionId: admission.id } });
    expect(stays).toHaveLength(1);
    expect(stays[0].wardId).toBe(ward.id);
    expect(stays[0].endedAt).toBeNull();
  });

  it('transfer closes the old ward-stay row and opens a new one, blocked into a no-rate ward', async () => {
    const { ward: wardA, bed: bedA } = await makeWard(15000);
    const { bed: bedB } = await makeWard(20000);
    const { bed: noRateBed } = await makeWard(null);
    const patient = await makePatient(tenantId);
    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: wardA.id, bedId: bedA.id, admissionType: 'ELECTIVE',
    } as any);

    await expect(
      admissions.transfer(nurseActor, admission.id, { bedId: noRateBed.id } as any),
    ).rejects.toThrow(/no daily rate/);

    await admissions.transfer(nurseActor, admission.id, { bedId: bedB.id } as any);
    const stays = await ownerPrisma.admissionWardStay.findMany({
      where: { admissionId: admission.id },
      orderBy: { startedAt: 'asc' },
    });
    expect(stays).toHaveLength(2);
    expect(stays[0].endedAt).not.toBeNull();
    expect(stays[1].endedAt).toBeNull();
    expect(stays[1].bedId).toBe(bedB.id);
  });

  it('a charge during the stay posts to the admission running bill, not a standalone invoice', async () => {
    const { ward, bed } = await makeWard(15000);
    const patient = await makePatient(tenantId);
    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);

    await prisma.forTenant(tenantId, (tx) =>
      billing.postCharge(tx, {
        tenantId, userId: nurseActor.userId, admissionId: admission.id, patientId: patient.id,
        description: 'Dressing', quantity: 1, unitPrice: 2000, category: 'Procedure',
      }),
    );

    const invoices = await ownerPrisma.invoice.findMany({ where: { admissionId: admission.id } });
    expect(invoices).toHaveLength(1);
    expect(Number(invoices[0].totalAmount)).toBe(2000);
  });

  it('resolveBillingTarget finds the patient\'s open admission for a charge with no explicit context', async () => {
    const { ward, bed } = await makeWard(15000);
    const patient = await makePatient(tenantId);
    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);

    const found = await prisma.forTenant(tenantId, (tx) => billing.resolveBillingTarget(tx, patient.id));
    expect(found).toBe(admission.id);

    await admissions.discharge(nurseActor, admission.id, {} as any);
    const afterDischarge = await prisma.forTenant(tenantId, (tx) => billing.resolveBillingTarget(tx, patient.id));
    expect(afterDischarge).toBeNull();
  });

  it('deposits: taken, listed in the workspace total, refund capped at what remains, permission split enforced', async () => {
    const { ward, bed } = await makeWard(15000);
    const patient = await makePatient(tenantId);
    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);

    const d1 = await admissions.addDeposit(receptionActor, admission.id, { amount: 50000, method: 'CASH' } as any);
    expect(d1.receiptNumber).toBeTruthy();
    await admissions.addDeposit(receptionActor, admission.id, { amount: 10000, method: 'TRANSFER' } as any);

    const ws = await admissions.workspace(tenantId, admission.id);
    expect(ws.totalDeposited).toBe('60000');

    // a receptionist can take a deposit but not refund one
    await expect(
      admissions.refundDeposit(receptionActor, admission.id, d1.id, { amount: 1000, reason: 'test' } as any),
    ).rejects.toThrow();

    // refund cannot exceed the deposit's own remaining balance
    await expect(
      admissions.refundDeposit(accountantActor, admission.id, d1.id, { amount: 60000, reason: 'too much' } as any),
    ).rejects.toThrow(/exceeds/);

    await admissions.refundDeposit(accountantActor, admission.id, d1.id, { amount: 20000, reason: 'partial refund' } as any);
    const wsAfter = await admissions.workspace(tenantId, admission.id);
    expect(wsAfter.totalDeposited).toBe('40000'); // 60000 - 20000 refunded

    const receipt = await admissions.depositReceipt(tenantId, admission.id, d1.id);
    expect(receipt.isRefund).toBe(true);
    expect(receipt.amount).toBe('20000');
  });

  it('bill(): balance reflects charges minus payments minus unapplied deposit credit', async () => {
    const { ward, bed } = await makeWard(15000);
    const patient = await makePatient(tenantId);
    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);

    await prisma.forTenant(tenantId, (tx) =>
      billing.postCharge(tx, {
        tenantId, userId: nurseActor.userId, admissionId: admission.id, patientId: patient.id,
        description: 'Lab panel', quantity: 1, unitPrice: 30000, category: 'Laboratory',
      }),
    );
    await admissions.addDeposit(receptionActor, admission.id, { amount: 10000, method: 'CASH' } as any);

    const bill = await admissions.bill(tenantId, admission.id);
    expect(bill.totalCharged).toBe('30000');
    expect(bill.totalPaid).toBe('0');
    expect(bill.totalDeposited).toBe('10000');
    expect(bill.balance).toBe('20000'); // 30000 - 0 - 10000
  });
});
