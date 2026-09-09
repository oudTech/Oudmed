import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../common/audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { BillingModule } from '../billing/billing.module';
import { PatientsModule } from './patients.module';
import { ClinicalService } from './clinical.service';
import { SettingsModule } from '../settings/settings.module';
import { SettingsService } from '../settings/settings.service';
import { actorFor, destroyTenant, makePatient, makeTenant, makeUser, ownerPrisma } from '../../test/int-helpers';

/**
 * Wave C - audit completeness (NN5) + settings before/after (#10).
 */
describe('Clinical update + settings audit (integration)', () => {
  let prisma: PrismaService;
  let clinical: ClinicalService;
  let settings: SettingsService;
  let tenantId: string;
  let actor: { tenantId: string; userId: string; role: string };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, StorageModule, BillingModule, PatientsModule, SettingsModule],
    }).compile();
    prisma = mod.get(PrismaService);
    clinical = mod.get(ClinicalService);
    settings = mod.get(SettingsService);
    tenantId = (await makeTenant()).id;
    actor = actorFor(tenantId, (await makeUser(tenantId, 'HOSPITAL_ADMIN')).id, 'HOSPITAL_ADMIN');
  });

  afterAll(async () => {
    await destroyTenant(tenantId);
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  const auditRows = (action: string) =>
    ownerPrisma.auditLog.findMany({ where: { tenantId, action } });

  it('updatePrescription records an UPDATE_PRESCRIPTION audit row with before/after status', async () => {
    const patient = await makePatient(tenantId);
    const rx = await ownerPrisma.prescription.create({
      data: { tenantId, patientId: patient.id, status: 'ACTIVE', items: { create: [{ tenantId, drugName: 'X' }] } },
    });

    const updated = await clinical.updatePrescription(actor, patient.id, rx.id, { status: 'COMPLETED' } as any);
    expect(updated.status).toBe('COMPLETED');
    expect(updated.items).toHaveLength(1); // include: { items: true } preserved

    const rows = await auditRows('UPDATE_PRESCRIPTION');
    expect(rows.some((r) => (r.metadata as any)?.status?.before === 'ACTIVE' && (r.metadata as any)?.status?.after === 'COMPLETED')).toBe(true);
  });

  it('addPrescription stamps tenantId onto the nested items (RLS write path)', async () => {
    const patient = await makePatient(tenantId);
    const rx = await clinical.addPrescription(actor, patient.id, {
      items: [{ drugName: 'Amoxicillin' }, { drugName: 'Paracetamol' }],
    } as any);
    expect(rx.items).toHaveLength(2);
    expect(rx.items.every((i) => i.tenantId === tenantId)).toBe(true);
  });

  it('updateComplaint records an UPDATE_COMPLAINT audit row', async () => {
    const patient = await makePatient(tenantId);
    const c = await ownerPrisma.complaint.create({
      data: { tenantId, patientId: patient.id, description: 'headache', status: 'OPEN' },
    });

    await clinical.updateComplaint(actor, patient.id, c.id, { status: 'RESOLVED' } as any);

    const rows = await auditRows('UPDATE_COMPLAINT');
    expect(rows.some((r) => (r.metadata as any)?.complaintId === c.id)).toBe(true);
  });

  it('settings.update records only changed fields with before/after values', async () => {
    await settings.update(actor, { rcNumber: 'RC-1' } as any);
    await settings.update(actor, { rcNumber: 'RC-2', website: 'https://x.example' } as any);

    const rows = await ownerPrisma.auditLog.findMany({
      where: { tenantId, entityType: 'Tenant', action: 'UPDATE' },
      orderBy: { createdAt: 'desc' },
    });
    const latest = rows[0]?.metadata as any;
    expect(latest.changes.rcNumber).toEqual({ before: 'RC-1', after: 'RC-2' });
    expect(latest.changes.website).toEqual({ before: null, after: 'https://x.example' });
  });

  it('settings.update with no effective change writes no diff', async () => {
    await settings.update(actor, { rcNumber: 'RC-2' } as any); // same as current
    const rows = await ownerPrisma.auditLog.findMany({
      where: { tenantId, entityType: 'Tenant', action: 'UPDATE' },
      orderBy: { createdAt: 'desc' },
    });
    expect((rows[0]?.metadata as any).changes).toEqual({});
  });
});
