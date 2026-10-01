import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../common/audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { BillingModule } from '../billing/billing.module';
import { PharmacyModule } from './pharmacy.module';
import { PharmacyService } from './pharmacy.service';
import { AdmissionsModule } from '../admissions/admissions.module';
import { AdmissionsService } from '../admissions/admissions.service';
import { actorFor, destroyTenant, makePatient, makeTenant, makeUser, makeVisit, ownerPrisma } from '../../test/int-helpers';

/**
 * F1 correction 1: a charge's billing target must come from where the
 * prescription/order was actually created, not from the patient's live
 * admission status. Only a prescription with no recorded context at all
 * falls back to the patient's currently open admission.
 */
describe('PharmacyService.dispense charge routing (integration - F1 correction 1)', () => {
  let pharmacy: PharmacyService;
  let admissions: AdmissionsService;
  let tenantId: string;
  let pharmacistActor: { tenantId: string; userId: string; role: string };
  let nurseActor: { tenantId: string; userId: string; role: string };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, StorageModule, BillingModule, PharmacyModule, AdmissionsModule],
    }).compile();
    pharmacy = mod.get(PharmacyService);
    admissions = mod.get(AdmissionsService);

    const tenant = await makeTenant();
    tenantId = tenant.id;
    pharmacistActor = actorFor(tenantId, (await makeUser(tenantId, 'PHARMACIST')).id, 'PHARMACIST');
    nurseActor = actorFor(tenantId, (await makeUser(tenantId, 'NURSE')).id, 'NURSE');
  });

  afterAll(async () => {
    await destroyTenant(tenantId);
    await ownerPrisma.$disconnect();
  });

  async function makeDrug() {
    return ownerPrisma.drug.create({
      data: {
        tenantId, sku: `MED-${Math.random().toString(36).slice(2, 8)}`, name: 'Test Drug',
        sellPrice: 100, quantityOnHand: 100,
        batches: { create: [{ tenantId, batchNumber: 'B1', expiryDate: new Date(Date.now() + 30 * 86_400_000), quantity: 100 }] },
      },
    });
  }

  async function makeWard() {
    const ward = await ownerPrisma.ward.create({
      data: { tenantId, name: `Ward ${Math.random().toString(36).slice(2, 8)}`, wardType: 'GENERAL', dailyRate: 15000 },
    });
    const bed = await ownerPrisma.bed.create({ data: { tenantId, wardId: ward.id, label: 'A1' } });
    return { ward, bed };
  }

  it('an outpatient prescription dispensed after the patient is admitted stays on the visit invoice', async () => {
    const drug = await makeDrug();
    const patient = await makePatient(tenantId);
    const visit = await makeVisit(tenantId, patient.id);
    const rx = await ownerPrisma.prescription.create({
      data: {
        tenantId, patientId: patient.id, visitId: visit.id, status: 'ACTIVE', dispenseStatus: 'PENDING',
        items: { create: [{ tenantId, drugId: drug.id, drugName: drug.name }] },
      },
      include: { items: true },
    });

    // Admit the same patient into a different ward after the script was written.
    const { ward, bed } = await makeWard();
    await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);

    await pharmacy.dispense(pharmacistActor, rx.id, { items: [{ itemId: rx.items[0].id, quantity: 2, unitPrice: 100 }] });

    const visitInvoices = await ownerPrisma.invoice.findMany({ where: { visitId: visit.id } });
    const admissionInvoices = await ownerPrisma.invoice.findMany({ where: { patient: { id: patient.id }, admissionId: { not: null } } });
    expect(visitInvoices).toHaveLength(1);
    expect(Number(visitInvoices[0].totalAmount)).toBe(200);
    expect(admissionInvoices).toHaveLength(0);
  });

  it('an inpatient prescription (admissionId recorded) goes to the admission bill', async () => {
    const drug = await makeDrug();
    const patient = await makePatient(tenantId);
    const { ward, bed } = await makeWard();
    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);
    const rx = await ownerPrisma.prescription.create({
      data: {
        tenantId, patientId: patient.id, admissionId: admission.id, status: 'ACTIVE', dispenseStatus: 'PENDING',
        items: { create: [{ tenantId, drugId: drug.id, drugName: drug.name }] },
      },
      include: { items: true },
    });

    await pharmacy.dispense(pharmacistActor, rx.id, { items: [{ itemId: rx.items[0].id, quantity: 3, unitPrice: 100 }] });

    const invoices = await ownerPrisma.invoice.findMany({ where: { admissionId: admission.id } });
    expect(invoices).toHaveLength(1);
    expect(Number(invoices[0].totalAmount)).toBe(300);
  });

  it('a prescription written against the admission\'s originating visit stays on that visit, not the admission bill', async () => {
    const drug = await makeDrug();
    const patient = await makePatient(tenantId);
    const originatingVisit = await makeVisit(tenantId, patient.id);
    const { ward, bed } = await makeWard();
    await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'EMERGENCY',
      originatingVisitId: originatingVisit.id,
    } as any);

    // A prescription still explicitly tied to the originating visit (its
    // recorded source) after the admission has started - per the F1
    // recommendation, it stays on that visit's own invoice. Clinicians are
    // expected to record new in-stay prescriptions against the admission
    // instead, as the inpatient workspace lets them do.
    const rx = await ownerPrisma.prescription.create({
      data: {
        tenantId, patientId: patient.id, visitId: originatingVisit.id, status: 'ACTIVE', dispenseStatus: 'PENDING',
        items: { create: [{ tenantId, drugId: drug.id, drugName: drug.name }] },
      },
      include: { items: true },
    });

    await pharmacy.dispense(pharmacistActor, rx.id, { items: [{ itemId: rx.items[0].id, quantity: 1, unitPrice: 100 }] });

    const visitInvoices = await ownerPrisma.invoice.findMany({ where: { visitId: originatingVisit.id } });
    expect(visitInvoices).toHaveLength(1);
    const admissionInvoices = await ownerPrisma.invoice.findMany({ where: { patient: { id: patient.id }, admissionId: { not: null } } });
    expect(admissionInvoices).toHaveLength(0);
  });

  it('a prescription with no recorded visit or admission falls back to the patient\'s open admission', async () => {
    const drug = await makeDrug();
    const patient = await makePatient(tenantId);
    const { ward, bed } = await makeWard();
    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);
    const rx = await ownerPrisma.prescription.create({
      data: {
        tenantId, patientId: patient.id, status: 'ACTIVE', dispenseStatus: 'PENDING',
        items: { create: [{ tenantId, drugId: drug.id, drugName: drug.name }] },
      },
      include: { items: true },
    });

    await pharmacy.dispense(pharmacistActor, rx.id, { items: [{ itemId: rx.items[0].id, quantity: 1, unitPrice: 100 }] });

    const invoices = await ownerPrisma.invoice.findMany({ where: { admissionId: admission.id } });
    expect(invoices).toHaveLength(1);
  });
});
