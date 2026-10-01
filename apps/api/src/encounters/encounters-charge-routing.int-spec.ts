import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../common/audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { EncountersModule } from './encounters.module';
import { EncountersService } from './encounters.service';
import { AdmissionsModule } from '../admissions/admissions.module';
import { AdmissionsService } from '../admissions/admissions.service';
import { actorFor, destroyTenant, makePatient, makeTenant, makeUser, makeVisit, ownerPrisma } from '../../test/int-helpers';

/**
 * F1 correction 1: an order's billing target is the visit it was raised
 * from (its recorded source), never the patient's live admission status -
 * createOrder only ever runs from the outpatient encounter workspace in F1a,
 * so it must always charge that visit, even if the patient is admitted.
 */
describe('EncountersService.createOrder charge routing (integration - F1 correction 1)', () => {
  let encounters: EncountersService;
  let admissions: AdmissionsService;
  let tenantId: string;
  let doctorActor: { tenantId: string; userId: string; role: string };
  let nurseActor: { tenantId: string; userId: string; role: string };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, StorageModule, EncountersModule, AdmissionsModule],
    }).compile();
    encounters = mod.get(EncountersService);
    admissions = mod.get(AdmissionsService);

    const tenant = await makeTenant();
    tenantId = tenant.id;
    doctorActor = actorFor(tenantId, (await makeUser(tenantId, 'DOCTOR')).id, 'DOCTOR');
    nurseActor = actorFor(tenantId, (await makeUser(tenantId, 'NURSE')).id, 'NURSE');
  });

  afterAll(async () => {
    await destroyTenant(tenantId);
    await ownerPrisma.$disconnect();
  });

  it('an order created on a visit charges that visit even while the patient is admitted', async () => {
    const patient = await makePatient(tenantId);
    const visit = await makeVisit(tenantId, patient.id, { status: 'IN_PROGRESS' });

    const ward = await ownerPrisma.ward.create({
      data: { tenantId, name: `Ward ${Math.random().toString(36).slice(2, 8)}`, wardType: 'GENERAL', dailyRate: 15000 },
    });
    const bed = await ownerPrisma.bed.create({ data: { tenantId, wardId: ward.id, label: 'A1' } });
    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);

    const order = await encounters.createOrder(doctorActor, visit.id, {
      orderType: 'PROCEDURE', name: 'Dressing change', unitPrice: 2500, overrideReason: 'off-catalogue',
    } as any);

    const line = await ownerPrisma.invoiceLine.findFirst({ where: { id: order.invoiceLineId ?? '' }, include: { invoice: true } });
    expect(line!.invoice.visitId).toBe(visit.id);
    expect(line!.invoice.admissionId).toBeNull();

    const admissionInvoices = await ownerPrisma.invoice.findMany({ where: { admissionId: admission.id } });
    expect(admissionInvoices).toHaveLength(0);
  });

  it('F1b: an order created from the inpatient workspace (admissionId as source) charges the admission bill', async () => {
    const patient = await makePatient(tenantId);
    const ward = await ownerPrisma.ward.create({
      data: { tenantId, name: `Ward ${Math.random().toString(36).slice(2, 8)}`, wardType: 'GENERAL', dailyRate: 15000 },
    });
    const bed = await ownerPrisma.bed.create({ data: { tenantId, wardId: ward.id, label: 'A1' } });
    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);

    const order = await encounters.createOrder(doctorActor, { admissionId: admission.id }, {
      orderType: 'LABORATORY', name: 'FBC', unitPrice: 4000, overrideReason: 'off-catalogue',
    } as any);

    const line = await ownerPrisma.invoiceLine.findFirst({ where: { id: order.invoiceLineId ?? '' }, include: { invoice: true } });
    expect(line!.invoice.admissionId).toBe(admission.id);
    expect(line!.invoice.visitId).toBeNull();
  });

  it('F1b: an order cannot be raised against a closed admission', async () => {
    const patient = await makePatient(tenantId);
    const ward = await ownerPrisma.ward.create({
      data: { tenantId, name: `Ward ${Math.random().toString(36).slice(2, 8)}`, wardType: 'GENERAL', dailyRate: 15000 },
    });
    const bed = await ownerPrisma.bed.create({ data: { tenantId, wardId: ward.id, label: 'A1' } });
    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);
    await admissions.discharge(nurseActor, admission.id, { status: 'DISCHARGED' } as any);

    await expect(
      encounters.createOrder(doctorActor, { admissionId: admission.id }, {
        orderType: 'LABORATORY', name: 'FBC', unitPrice: 4000, overrideReason: 'off-catalogue',
      } as any),
    ).rejects.toThrow(/closed/);
  });
});
