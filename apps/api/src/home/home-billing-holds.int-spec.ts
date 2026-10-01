import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../common/audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { BillingModule } from '../billing/billing.module';
import { AdmissionsModule } from '../admissions/admissions.module';
import { AdmissionsService } from '../admissions/admissions.service';
import { HomeModule } from './home.module';
import { HomeService } from './home.service';
import { actorFor, destroyTenant, makePatient, makeTenant, makeUser, ownerPrisma } from '../../test/int-helpers';

/**
 * F1 condition 2: admitting into a ward with no rate set is never blocked,
 * but Hospital Admin / billing must be flagged so it does not go unnoticed.
 */
describe('HomeService billing-holds widget (integration - F1 correction 2)', () => {
  let admissions: AdmissionsService;
  let home: HomeService;
  let tenantId: string;
  let nurseActor: { tenantId: string; userId: string; role: string };
  let adminActor: { tenantId: string; userId: string; role: string };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, StorageModule, BillingModule, AdmissionsModule, HomeModule],
    }).compile();
    admissions = mod.get(AdmissionsService);
    home = mod.get(HomeService);

    const tenant = await makeTenant();
    tenantId = tenant.id;
    nurseActor = actorFor(tenantId, (await makeUser(tenantId, 'NURSE')).id, 'NURSE');
    const admin = await makeUser(tenantId, 'HOSPITAL_ADMIN');
    adminActor = actorFor(tenantId, admin.id, 'HOSPITAL_ADMIN');
  });

  afterAll(async () => {
    await destroyTenant(tenantId);
    await ownerPrisma.$disconnect();
  });

  it('flags an admitted patient whose ward has no daily rate on the admin dashboard', async () => {
    const before = await home.forActor(adminActor);
    expect(before.widgets.find((w) => w.key === 'billing-holds')).toBeUndefined();

    const ward = await ownerPrisma.ward.create({
      data: { tenantId, name: `Ward ${Math.random().toString(36).slice(2, 8)}`, wardType: 'GENERAL', dailyRate: null },
    });
    const bed = await ownerPrisma.bed.create({ data: { tenantId, wardId: ward.id, label: 'A1' } });
    const patient = await makePatient(tenantId);
    await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);

    const after = await home.forActor(adminActor);
    const widget = after.widgets.find((w) => w.key === 'billing-holds');
    expect(widget).toBeDefined();
    expect(widget!.items?.length).toBeGreaterThan(0);
  });
});
