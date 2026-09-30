import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../common/audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { ScheduleModule } from './schedule.module';
import { ScheduleService } from './schedule.service';
import {
  actorFor,
  destroyTenant,
  makePatient,
  makeTenant,
  makeUser,
  makeVisit,
  ownerPrisma,
} from '../../test/int-helpers';

describe('ScheduleService.reopenVisit (integration - FUNC-2)', () => {
  let prisma: PrismaService;
  let schedule: ScheduleService;
  let tenantId: string;
  let patientId: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, StorageModule, ScheduleModule],
    }).compile();
    prisma = mod.get(PrismaService);
    schedule = mod.get(ScheduleService);

    const tenant = await makeTenant();
    tenantId = tenant.id;
    await ownerPrisma.serviceItem.create({
      data: { tenantId, name: 'General Consultation', category: 'Consultation', unitPrice: 5000, isActive: true },
    });
  });

  beforeEach(async () => {
    patientId = (await makePatient(tenantId)).id;
  });

  afterAll(async () => {
    await destroyTenant(tenantId);
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  async function completedVisit(doctorId: string | null) {
    return makeVisit(tenantId, patientId, { status: 'COMPLETED', completedAt: new Date(), doctorId });
  }

  it('the attending doctor can reopen their own completed visit', async () => {
    const doc = await makeUser(tenantId, 'DOCTOR');
    const visit = await completedVisit(doc.id);
    const actor = actorFor(tenantId, doc.id, 'DOCTOR');

    const updated = await schedule.reopenVisit(actor, visit.id, { reason: 'Forgot to order a lab test' });
    expect(updated.status).toBe('IN_PROGRESS');

    const row = await ownerPrisma.visit.findUnique({ where: { id: visit.id } });
    expect(row!.reopenedAt).not.toBeNull();

    const auditRows = await ownerPrisma.auditLog.findMany({ where: { tenantId, action: 'REOPEN_VISIT', entityId: visit.id } });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].metadata).toMatchObject({ reason: 'Forgot to order a lab test' });
  });

  it('a doctor who is not the attending doctor cannot reopen the visit', async () => {
    const attending = await makeUser(tenantId, 'DOCTOR');
    const otherDoctor = await makeUser(tenantId, 'DOCTOR');
    const visit = await completedVisit(attending.id);
    const actor = actorFor(tenantId, otherDoctor.id, 'DOCTOR');

    await expect(schedule.reopenVisit(actor, visit.id, { reason: 'trying anyway' })).rejects.toThrow(
      /attending doctor/i,
    );
  });

  it('a role without visit:reopen (e.g. Receptionist) cannot reopen a visit', async () => {
    const doc = await makeUser(tenantId, 'DOCTOR');
    const receptionist = await makeUser(tenantId, 'RECEPTIONIST');
    const visit = await completedVisit(doc.id);
    const actor = actorFor(tenantId, receptionist.id, 'RECEPTIONIST');

    await expect(schedule.reopenVisit(actor, visit.id, { reason: 'trying anyway' })).rejects.toThrow();
  });

  it('Hospital Admin can reopen any visit regardless of attending doctor', async () => {
    const doc = await makeUser(tenantId, 'DOCTOR');
    const admin = await makeUser(tenantId, 'HOSPITAL_ADMIN');
    const visit = await completedVisit(doc.id);
    const actor = actorFor(tenantId, admin.id, 'HOSPITAL_ADMIN');

    const updated = await schedule.reopenVisit(actor, visit.id, { reason: 'Admin correction' });
    expect(updated.status).toBe('IN_PROGRESS');
  });

  it('cannot reopen a visit that is not completed', async () => {
    const doc = await makeUser(tenantId, 'DOCTOR');
    const visit = await makeVisit(tenantId, patientId, { status: 'IN_PROGRESS', doctorId: doc.id });
    const actor = actorFor(tenantId, doc.id, 'DOCTOR');

    await expect(schedule.reopenVisit(actor, visit.id, { reason: 'n/a' })).rejects.toThrow(/completed/i);
  });

  it('re-completing a reopened visit does not double-post the consultation charge', async () => {
    const doc = await makeUser(tenantId, 'DOCTOR');
    const actor = actorFor(tenantId, doc.id, 'DOCTOR');
    const admin = actorFor(tenantId, (await makeUser(tenantId, 'HOSPITAL_ADMIN')).id, 'HOSPITAL_ADMIN');

    // first completion via the normal flow
    const visit = await makeVisit(tenantId, patientId, { status: 'IN_PROGRESS', doctorId: doc.id });
    await schedule.setStatus(actor, visit.id, { status: 'COMPLETED' } as any);

    let lines = await ownerPrisma.invoiceLine.findMany({
      where: { category: 'Consultation', invoice: { visitId: visit.id } },
    });
    expect(lines).toHaveLength(1);

    // reopen, then complete again
    await schedule.reopenVisit(admin, visit.id, { reason: 'add a late order' });
    await schedule.setStatus(actor, visit.id, { status: 'COMPLETED' } as any);

    lines = await ownerPrisma.invoiceLine.findMany({
      where: { category: 'Consultation', invoice: { visitId: visit.id } },
    });
    expect(lines).toHaveLength(1); // still exactly one - not doubled
  });
});
