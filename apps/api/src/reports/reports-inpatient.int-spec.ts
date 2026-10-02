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
import {
  actorFor,
  destroyTenant,
  makePatient,
  makeTenant,
  makeUser,
  makeVisit,
  ownerPrisma,
} from '../../test/int-helpers';

/**
 * F1d: census/bed-occupancy and inpatient-revenue reporting (design doc
 * section 10) - occupancy reflects live Bed.status (not windowed by the
 * report's date range), inpatient revenue is a visible subset of total
 * revenue rather than hidden inside it, and admissions-per-day shows up on
 * its own trend using the same bucketing as the existing patient trend.
 */
describe('ReportsService.overview (integration - F1d inpatient panels)', () => {
  let prisma: PrismaService;
  let billing: BillingService;
  let admissions: AdmissionsService;
  let reports: ReportsService;
  let tenantId: string;
  let nurseActor: { tenantId: string; userId: string; role: string };
  let accountantActor: { tenantId: string; userId: string; role: string };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, StorageModule, BillingModule, AdmissionsModule, ReportsModule],
    }).compile();
    prisma = mod.get(PrismaService);
    billing = mod.get(BillingService);
    admissions = mod.get(AdmissionsService);
    reports = mod.get(ReportsService);

    const tenant = await makeTenant();
    tenantId = tenant.id;
    await ownerPrisma.tenant.update({ where: { id: tenant.id }, data: { shortStayChargeMode: 'NONE' } });
    nurseActor = actorFor(tenantId, (await makeUser(tenantId, 'NURSE')).id, 'NURSE');
    accountantActor = actorFor(tenantId, (await makeUser(tenantId, 'ACCOUNTANT')).id, 'ACCOUNTANT');
  });

  afterAll(async () => {
    await destroyTenant(tenantId);
    await ownerPrisma.$disconnect();
  });

  function windowAroundNow() {
    return {
      from: new Date(Date.now() - 60_000).toISOString().slice(0, 10),
      to: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
    };
  }

  it('occupancy follows live bed status: admitting fills a bed, discharging frees it', async () => {
    const ward = await ownerPrisma.ward.create({
      data: { tenantId, name: `Ward ${Math.random().toString(36).slice(2, 8)}`, wardType: 'GENERAL', dailyRate: 15000 },
    });
    const bedA = await ownerPrisma.bed.create({ data: { tenantId, wardId: ward.id, label: 'A1' } });
    await ownerPrisma.bed.create({ data: { tenantId, wardId: ward.id, label: 'A2' } });
    const patient = await makePatient(tenantId);

    const { from, to } = windowAroundNow();
    const before = await reports.overview(accountantActor, { from, to });
    const wardBefore = before.occupancyByWard.find((w) => w.wardId === ward.id)!;
    expect(wardBefore.totalBeds).toBe(2);
    expect(wardBefore.occupiedBeds).toBe(0);

    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bedA.id, admissionType: 'ELECTIVE',
    } as any);

    const during = await reports.overview(accountantActor, { from, to });
    const wardDuring = during.occupancyByWard.find((w) => w.wardId === ward.id)!;
    expect(wardDuring.totalBeds).toBe(2);
    expect(wardDuring.occupiedBeds).toBe(1);

    await admissions.discharge(nurseActor, admission.id, { status: 'DISCHARGED' } as any);

    const after = await reports.overview(accountantActor, { from, to });
    const wardAfter = after.occupancyByWard.find((w) => w.wardId === ward.id)!;
    expect(wardAfter.occupiedBeds).toBe(0);
  });

  it('inpatient revenue is a visible subset of total revenue, not an addition to it', async () => {
    const ward = await ownerPrisma.ward.create({
      data: { tenantId, name: `Ward ${Math.random().toString(36).slice(2, 8)}`, wardType: 'GENERAL', dailyRate: 15000 },
    });
    const bed = await ownerPrisma.bed.create({ data: { tenantId, wardId: ward.id, label: 'B1' } });
    const patient = await makePatient(tenantId);

    const { from, to } = windowAroundNow();
    const before = await reports.overview(accountantActor, { from, to });
    const totalRevenueBefore = Number(before.operations.find((k) => k.key === 'total_revenue')!.value);
    const inpatientRevenueBefore = Number(before.finance.find((k) => k.key === 'inpatient_revenue')!.value);

    // an outpatient visit charge must NOT move inpatient_revenue
    const outpatientPatient = await makePatient(tenantId);
    const outpatientVisit = await makeVisit(tenantId, outpatientPatient.id);
    await prisma.forTenant(tenantId, (tx) =>
      billing.postChargeToVisit(tx, {
        tenantId, userId: nurseActor.userId, visitId: outpatientVisit.id, patientId: outpatientPatient.id,
        description: 'Outpatient consult', quantity: 1, unitPrice: 7000, category: 'Consultation',
      }),
    );

    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);
    await prisma.forTenant(tenantId, (tx) =>
      billing.postCharge(tx, {
        tenantId, userId: nurseActor.userId, admissionId: admission.id, patientId: patient.id,
        description: 'Ward charge', quantity: 1, unitPrice: 12000, category: 'Inpatient',
      }),
    );

    const after = await reports.overview(accountantActor, { from, to });
    const totalRevenueAfter = Number(after.operations.find((k) => k.key === 'total_revenue')!.value);
    const inpatientRevenueAfter = Number(after.finance.find((k) => k.key === 'inpatient_revenue')!.value);

    // total revenue picked up both the outpatient and inpatient charge...
    expect(totalRevenueAfter - totalRevenueBefore).toBe(7000 + 12000);
    // ...but inpatient_revenue only ever counts the admission-billed one
    expect(inpatientRevenueAfter - inpatientRevenueBefore).toBe(12000);
  });

  it('admissions trend buckets a new admission on the day it started', async () => {
    const ward = await ownerPrisma.ward.create({
      data: { tenantId, name: `Ward ${Math.random().toString(36).slice(2, 8)}`, wardType: 'GENERAL', dailyRate: 15000 },
    });
    const bed = await ownerPrisma.bed.create({ data: { tenantId, wardId: ward.id, label: 'C1' } });
    const patient = await makePatient(tenantId);

    const { from, to } = windowAroundNow();
    const before = await reports.overview(accountantActor, { from, to, granularity: 'daily' });
    const totalBefore = before.admissionsTrend.reduce((s, p) => s + p.value, 0);

    await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);

    const after = await reports.overview(accountantActor, { from, to, granularity: 'daily' });
    const totalAfter = after.admissionsTrend.reduce((s, p) => s + p.value, 0);
    expect(totalAfter - totalBefore).toBe(1);
  });
});
