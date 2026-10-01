import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../common/audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { BillingModule } from '../billing/billing.module';
import { AdmissionsModule } from './admissions.module';
import { AdmissionsService } from './admissions.service';
import { actorFor, destroyTenant, makePatient, makeTenant, makeUser, ownerPrisma } from '../../test/int-helpers';

/**
 * F1c: multiple dated ward-round notes per admission (not a single
 * overwritable note like a visit's), their addenda, and admission reopen -
 * which lifts the closed-admission guard on new notes/prescriptions/orders.
 */
describe('AdmissionsService notes and reopen (integration - F1c)', () => {
  let prisma: PrismaService;
  let admissions: AdmissionsService;
  let tenantId: string;
  let nurseActor: { tenantId: string; userId: string; role: string };
  let doctorId: string;
  let doctorActor: { tenantId: string; userId: string; role: string };
  let otherDoctorActor: { tenantId: string; userId: string; role: string };
  let adminActor: { tenantId: string; userId: string; role: string };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, StorageModule, BillingModule, AdmissionsModule],
    }).compile();
    prisma = mod.get(PrismaService);
    admissions = mod.get(AdmissionsService);

    const tenant = await makeTenant();
    tenantId = tenant.id;
    nurseActor = actorFor(tenantId, (await makeUser(tenantId, 'NURSE')).id, 'NURSE');
    const doctor = await makeUser(tenantId, 'DOCTOR');
    doctorId = doctor.id;
    doctorActor = actorFor(tenantId, doctor.id, 'DOCTOR');
    otherDoctorActor = actorFor(tenantId, (await makeUser(tenantId, 'DOCTOR')).id, 'DOCTOR');
    const admin = await makeUser(tenantId, 'HOSPITAL_ADMIN');
    adminActor = actorFor(tenantId, admin.id, 'HOSPITAL_ADMIN');
  });

  afterAll(async () => {
    await destroyTenant(tenantId);
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  async function makeAdmission(attendingDoctorId?: string) {
    const ward = await ownerPrisma.ward.create({
      data: { tenantId, name: `Ward ${Math.random().toString(36).slice(2, 8)}`, wardType: 'GENERAL', dailyRate: 15000 },
    });
    const bed = await ownerPrisma.bed.create({ data: { tenantId, wardId: ward.id, label: 'A1' } });
    const patient = await makePatient(tenantId);
    return admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE', attendingDoctorId,
    } as any);
  }

  it('records multiple dated notes per admission, each with its own author and timestamp', async () => {
    const admission = await makeAdmission(doctorId);

    const n1 = await admissions.addNote(doctorActor, admission.id, { subjective: 'Day 1 round' } as any);
    const n2 = await admissions.addNote(doctorActor, admission.id, { subjective: 'Day 2 round' } as any);
    expect(n1.id).not.toBe(n2.id);

    const ws = await admissions.workspace(tenantId, admission.id);
    expect(ws.notes).toHaveLength(2);
    expect(ws.notes.map((n: any) => n.subjective).sort()).toEqual(['Day 1 round', 'Day 2 round']);
    expect(ws.notes[0].authorName).toBeTruthy();
  });

  it('blocks a new note once discharged, unless the admission is reopened', async () => {
    const admission = await makeAdmission(doctorId);
    await admissions.discharge(nurseActor, admission.id, { status: 'DISCHARGED' } as any);

    await expect(
      admissions.addNote(doctorActor, admission.id, { subjective: 'late entry' } as any),
    ).rejects.toThrow(/closed/);

    await admissions.reopen(doctorActor, admission.id, { reason: 'late note needed' } as any);
    const note = await admissions.addNote(doctorActor, admission.id, { subjective: 'late entry' } as any);
    expect(note.id).toBeTruthy();
  });

  it('reopen is restricted to the attending doctor or Hospital Admin, and never readmits', async () => {
    const admission = await makeAdmission(doctorId);
    await admissions.discharge(nurseActor, admission.id, { status: 'DISCHARGED' } as any);

    await expect(
      admissions.reopen(otherDoctorActor, admission.id, { reason: 'x' } as any),
    ).rejects.toThrow(/attending doctor/);

    const reopened = await admissions.reopen(adminActor, admission.id, { reason: 'audit correction' } as any);
    expect(reopened.status).toBe('DISCHARGED'); // never moves back to ADMITTED
    expect(reopened.reopenedAt).not.toBeNull();

    // reopening again is not blocked - status never left DISCHARGED, so there
    // is no "already reopened" state to guard against, same as calling it once
    await expect(
      admissions.reopen(adminActor, admission.id, { reason: 'again' } as any),
    ).resolves.toBeDefined();
  });

  it('an addendum targets one specific note and requires at least one field filled in', async () => {
    const admission = await makeAdmission(doctorId);
    const n1 = await admissions.addNote(doctorActor, admission.id, { subjective: 'round 1' } as any);
    await admissions.addNote(doctorActor, admission.id, { subjective: 'round 2' } as any);

    await expect(
      admissions.addNoteAddendum(doctorActor, admission.id, n1.id, {} as any),
    ).rejects.toThrow(/at least one field/);

    const addendum = await admissions.addNoteAddendum(doctorActor, admission.id, n1.id, { plan: 'correction to round 1' } as any);
    expect(addendum.noteId).toBe(n1.id);

    const ws = await admissions.workspace(tenantId, admission.id);
    const note1 = ws.notes.find((n: any) => n.id === n1.id)!;
    expect(note1.addenda).toHaveLength(1);
    const note2 = ws.notes.find((n: any) => n.subjective === 'round 2')!;
    expect(note2.addenda).toHaveLength(0);
  });

  it('discharge summary assembles diagnoses, prescriptions and notes recorded during the stay', async () => {
    const admission = await makeAdmission(doctorId);
    await admissions.addNote(doctorActor, admission.id, { subjective: 'ward round' } as any);
    await ownerPrisma.diagnosis.create({
      data: { tenantId, patientId: (await ownerPrisma.admission.findUnique({ where: { id: admission.id } }))!.patientId, admissionId: admission.id, description: 'Malaria', certainty: 'FINAL' },
    });
    await admissions.discharge(nurseActor, admission.id, { status: 'DISCHARGED' } as any);

    const summary = await admissions.dischargeSummary(tenantId, admission.id);
    expect(summary.notes).toHaveLength(1);
    expect(summary.diagnoses).toHaveLength(1);
    expect(summary.admission.status).toBe('DISCHARGED');
  });
});
