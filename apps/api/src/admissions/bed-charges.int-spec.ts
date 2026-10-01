import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../common/audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { BillingModule } from '../billing/billing.module';
import { AdmissionsModule } from './admissions.module';
import { AdmissionsService } from './admissions.service';
import { BedChargesService } from './bed-charges.service';
import { actorFor, destroyTenant, makePatient, makeTenant, makeUser, ownerPrisma } from '../../test/int-helpers';

const days = (n: number) => new Date(Date.now() + n * 86_400_000);

/**
 * F1b: the DB-aware bed-charge wrapper, exercised end to end - idempotency,
 * the held-rate catch-up, transfers, and discharge's final reconciliation
 * (short-stay charging in particular, since that can only run at discharge).
 */
describe('BedChargesService (integration - F1b bed-day charges)', () => {
  let prisma: PrismaService;
  let admissions: AdmissionsService;
  let bedCharges: BedChargesService;
  let tenantId: string;
  let nurseActor: { tenantId: string; userId: string; role: string };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, StorageModule, BillingModule, AdmissionsModule],
    }).compile();
    prisma = mod.get(PrismaService);
    admissions = mod.get(AdmissionsService);
    bedCharges = mod.get(BedChargesService);

    const tenant = await makeTenant();
    tenantId = tenant.id;
    nurseActor = actorFor(tenantId, (await makeUser(tenantId, 'NURSE')).id, 'NURSE');
  });

  afterAll(async () => {
    await destroyTenant(tenantId);
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  async function makeWard(dailyRate: number | null, dayCaseRate: number | null = null) {
    const ward = await ownerPrisma.ward.create({
      data: { tenantId, name: `Ward ${Math.random().toString(36).slice(2, 8)}`, wardType: 'GENERAL', dailyRate, dayCaseRate },
    });
    const bed = await ownerPrisma.bed.create({ data: { tenantId, wardId: ward.id, label: 'A1' } });
    return { ward, bed };
  }

  async function tenantSettings() {
    const t = await ownerPrisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { id: true, inpatientChargeRule: true, shortStayChargeMode: true },
    });
    return t;
  }

  async function backdateAdmission(admissionId: string, admittedAt: Date) {
    await ownerPrisma.admission.update({ where: { id: admissionId }, data: { admittedAt } });
    await ownerPrisma.admissionWardStay.updateMany({ where: { admissionId, endedAt: null }, data: { startedAt: admittedAt } });
  }

  it('MIDNIGHT_CENSUS: posts one charge per Lagos midnight crossed, and is idempotent on a second run', async () => {
    const { ward, bed } = await makeWard(15000);
    const patient = await makePatient(tenantId);
    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);
    await backdateAdmission(admission.id, days(-3));

    const tenant = await tenantSettings();
    const now = new Date();
    await prisma.forTenant(tenantId, (tx) =>
      bedCharges.postBedCharges(tx, { id: admission.id, tenantId, patientId: patient.id, admittedAt: days(-3) }, tenant, now, false),
    );
    const invoices1 = await ownerPrisma.invoice.findMany({ where: { admissionId: admission.id }, include: { lines: true } });
    expect(invoices1).toHaveLength(1);
    expect(invoices1[0].lines).toHaveLength(3); // 3 midnights crossed in 3 days

    // running again must not double-post
    await prisma.forTenant(tenantId, (tx) =>
      bedCharges.postBedCharges(tx, { id: admission.id, tenantId, patientId: patient.id, admittedAt: days(-3) }, tenant, now, false),
    );
    const invoices2 = await ownerPrisma.invoice.findMany({ where: { admissionId: admission.id }, include: { lines: true } });
    expect(invoices2[0].lines).toHaveLength(3);
  });

  it('holds a night with no ward rate, then catches up once the rate is set, at the current rate', async () => {
    const { ward, bed } = await makeWard(null);
    const patient = await makePatient(tenantId);
    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);
    await backdateAdmission(admission.id, days(-2));

    const tenant = await tenantSettings();
    await prisma.forTenant(tenantId, (tx) =>
      bedCharges.postBedCharges(tx, { id: admission.id, tenantId, patientId: patient.id, admittedAt: days(-2) }, tenant, new Date(), false),
    );
    expect(await ownerPrisma.invoice.findMany({ where: { admissionId: admission.id } })).toHaveLength(0);
    expect(await ownerPrisma.bedDayCharge.findMany({ where: { admissionId: admission.id } })).toHaveLength(0);

    await ownerPrisma.ward.update({ where: { id: ward.id }, data: { dailyRate: 20000 } });
    await prisma.forTenant(tenantId, (tx) =>
      bedCharges.postBedCharges(tx, { id: admission.id, tenantId, patientId: patient.id, admittedAt: days(-2) }, tenant, new Date(), false),
    );
    const invoices = await ownerPrisma.invoice.findMany({ where: { admissionId: admission.id }, include: { lines: true } });
    expect(invoices).toHaveLength(1);
    expect(invoices[0].lines).toHaveLength(2);
    expect(Number(invoices[0].lines[0].unitPrice)).toBe(20000); // the rate now in effect, not any historical rate
  });

  it('a transfer before a midnight charges the destination ward for that night, never the origin', async () => {
    // Mirrors the design doc's own worked example exactly, using fixed
    // calendar instants (not "now"-relative) so the test is not sensitive to
    // what time of day it happens to run: admitted Day1 10:00 (Ward A),
    // transferred Day1 15:00 (Ward B), reconciled through Day2 10:00 -
    // 1 midnight crossed, 1 night, Ward B's rate (never Ward A's).
    const { ward: wardA, bed: bedA } = await makeWard(15000);
    const { ward: wardB, bed: bedB } = await makeWard(25000);
    const patient = await makePatient(tenantId);
    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: wardA.id, bedId: bedA.id, admissionType: 'ELECTIVE',
    } as any);
    const admittedAt = new Date('2026-03-01T09:00:00Z'); // Day1 10:00 Lagos
    const transferredAt = new Date('2026-03-01T14:00:00Z'); // Day1 15:00 Lagos
    const through = new Date('2026-03-02T09:00:00Z'); // Day2 10:00 Lagos
    await backdateAdmission(admission.id, admittedAt);
    await admissions.transfer(nurseActor, admission.id, { bedId: bedB.id } as any);
    await ownerPrisma.admissionWardStay.updateMany({ where: { admissionId: admission.id, endedAt: null }, data: { startedAt: transferredAt } });
    await ownerPrisma.admissionWardStay.updateMany({
      where: { admissionId: admission.id, wardId: wardA.id }, data: { endedAt: transferredAt },
    });

    const tenant = await tenantSettings();
    await prisma.forTenant(tenantId, (tx) =>
      bedCharges.postBedCharges(tx, { id: admission.id, tenantId, patientId: patient.id, admittedAt }, tenant, through, false),
    );
    const invoices = await ownerPrisma.invoice.findMany({ where: { admissionId: admission.id }, include: { lines: true } });
    expect(invoices).toHaveLength(1);
    expect(invoices[0].lines).toHaveLength(1);
    expect(Number(invoices[0].lines[0].unitPrice)).toBe(25000); // Ward B's rate, never Ward A's
    void wardB;
  });

  it('discharge(): a same-day stay charges nothing under NONE, writes a marker so it is never re-evaluated', async () => {
    await ownerPrisma.tenant.update({ where: { id: tenantId }, data: { shortStayChargeMode: 'NONE' } });
    const { ward, bed } = await makeWard(15000);
    const patient = await makePatient(tenantId);
    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);

    await admissions.discharge(nurseActor, admission.id, { status: 'DISCHARGED' } as any);

    expect(await ownerPrisma.invoice.findMany({ where: { admissionId: admission.id } })).toHaveLength(0);
    const marker = await ownerPrisma.bedDayCharge.findFirst({ where: { admissionId: admission.id } });
    expect(marker).not.toBeNull();
    expect(marker!.invoiceLineId).toBeNull();
  });

  it('discharge(): a same-day stay under MINIMUM_FULL_DAY charges one full night at the ward rate', async () => {
    await ownerPrisma.tenant.update({ where: { id: tenantId }, data: { shortStayChargeMode: 'MINIMUM_FULL_DAY' } });
    const { ward, bed } = await makeWard(18000);
    const patient = await makePatient(tenantId);
    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);

    await admissions.discharge(nurseActor, admission.id, { status: 'DISCHARGED' } as any);

    const invoices = await ownerPrisma.invoice.findMany({ where: { admissionId: admission.id }, include: { lines: true } });
    expect(invoices).toHaveLength(1);
    expect(invoices[0].lines).toHaveLength(1);
    expect(Number(invoices[0].lines[0].unitPrice)).toBe(18000);
  });

  it('discharge(): a same-day stay under DAY_CASE_RATE with no dayCaseRate set holds, not blocks, discharge', async () => {
    await ownerPrisma.tenant.update({ where: { id: tenantId }, data: { shortStayChargeMode: 'DAY_CASE_RATE' } });
    const { ward, bed } = await makeWard(18000, null);
    const patient = await makePatient(tenantId);
    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);

    const discharged = await admissions.discharge(nurseActor, admission.id, { status: 'DISCHARGED' } as any);
    expect(discharged.status).toBe('DISCHARGED');
    expect(await ownerPrisma.invoice.findMany({ where: { admissionId: admission.id } })).toHaveLength(0);
    expect(await ownerPrisma.bedDayCharge.findMany({ where: { admissionId: admission.id } })).toHaveLength(0);
  });

  it('discharge(): a same-day stay under DAY_CASE_RATE with a rate set charges the day-case rate, not the daily rate', async () => {
    await ownerPrisma.tenant.update({ where: { id: tenantId }, data: { shortStayChargeMode: 'DAY_CASE_RATE' } });
    const { ward, bed } = await makeWard(18000, 9000);
    const patient = await makePatient(tenantId);
    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);

    await admissions.discharge(nurseActor, admission.id, { status: 'DISCHARGED' } as any);
    const invoices = await ownerPrisma.invoice.findMany({ where: { admissionId: admission.id }, include: { lines: true } });
    expect(invoices).toHaveLength(1);
    expect(Number(invoices[0].lines[0].unitPrice)).toBe(9000);
  });

  it('discharge(): a multi-night stay runs the final reconciliation before closing the ward-stay row', async () => {
    await ownerPrisma.tenant.update({ where: { id: tenantId }, data: { shortStayChargeMode: 'MINIMUM_FULL_DAY' } });
    const { ward, bed } = await makeWard(15000);
    const patient = await makePatient(tenantId);
    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);
    await backdateAdmission(admission.id, days(-2));

    await admissions.discharge(nurseActor, admission.id, { status: 'DISCHARGED' } as any);

    const invoices = await ownerPrisma.invoice.findMany({ where: { admissionId: admission.id }, include: { lines: true } });
    expect(invoices).toHaveLength(1);
    expect(invoices[0].lines).toHaveLength(2); // 2 midnights crossed over the backdated 2-day stay
    const stay = await ownerPrisma.admissionWardStay.findFirst({ where: { admissionId: admission.id } });
    expect(stay!.endedAt).not.toBeNull();
  });
});
