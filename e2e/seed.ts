/**
 * Seeds the dedicated e2e tenant (slug `e2e`) and a second small tenant
 * (slug `e2e-suspend`, used only by the platform-suspend smoke case so
 * suspending it never disrupts the main tenant's other tests) used by
 * Step 3's automated go-live smoke tests. Idempotent: destroys and
 * recreates both tenants every run, so each run starts from the exact
 * same clean fixture set - individual test specs then seed their own
 * precondition data (a patient, a visit, a prescription...) directly via
 * Prisma, the same way apps/api/test/int-helpers.ts fixtures do for the
 * integration suite, before driving the real UI for the action under
 * test.
 *
 * Usage: pnpm --filter e2e seed (or `ts-node e2e/seed.ts` from the repo
 * root) - run once per test run, before Playwright starts (wired into
 * global-setup.ts, not meant to be run by hand except to debug).
 */
import './env';
import { PrismaClient, Role, Plan, FacilityType, InsuranceKind } from './prisma';
import * as bcrypt from 'bcryptjs';
import { destroyTenant } from '../apps/api/test/int-helpers';

const prisma = new PrismaClient();

export const E2E = {
  tenantSlug: 'e2e',
  suspendTenantSlug: 'e2e-suspend',
  password: 'E2ePass123!',
  platformPassword: 'E2ePlatform123!',
  platformEmail: 'platform-e2e@oudmed.test',
  logins: {
    admin: 'admin@e2e.test',
    reception: 'reception@e2e.test',
    nurse: 'nurse@e2e.test',
    doctor: 'doctor@e2e.test',
    pharmacist: 'pharmacist@e2e.test',
    labStaff: 'lab@e2e.test',
    accountant: 'accountant@e2e.test',
  },
} as const;

export interface SeededFixtures {
  tenantId: string;
  userIds: Record<keyof typeof E2E.logins, string>;
  departmentId: string;
  serviceItemIds: { consultation: string; labTest: string };
  drugId: string;
  wardId: string;
  bedIds: string[];
  insuranceProviderId: string;
  insuranceProviderName: string;
  insuranceCoPayPct: number;
}

async function seedMainTenant(): Promise<SeededFixtures> {
  const passwordHash = await bcrypt.hash(E2E.password, 12);

  const tenant = await prisma.tenant.create({
    data: {
      name: 'E2E Smoke Hospital',
      slug: E2E.tenantSlug,
      facilityType: FacilityType.HOSPITAL,
      country: 'NG',
      plan: Plan.GROWTH,
      primaryColor: '#2563EB',
      contactEmail: E2E.logins.admin,
    },
  });
  const tenantId = tenant.id;

  const makeUser = (email: string, fullName: string, role: Role, jobTitle: string) =>
    prisma.user.create({
      data: {
        tenantId, email, fullName, role, jobTitle,
        passwordHash, isActive: true, emailVerifiedAt: new Date(),
      },
    });

  const [admin, reception, nurse, doctor, pharmacist, labStaff, accountant] = await Promise.all([
    makeUser(E2E.logins.admin, 'E2E Admin', Role.HOSPITAL_ADMIN, 'Administrator'),
    makeUser(E2E.logins.reception, 'E2E Reception', Role.RECEPTIONIST, 'Front Desk'),
    makeUser(E2E.logins.nurse, 'E2E Nurse', Role.NURSE, 'Staff Nurse'),
    makeUser(E2E.logins.doctor, 'E2E Doctor', Role.DOCTOR, 'Resident Doctor'),
    makeUser(E2E.logins.pharmacist, 'E2E Pharmacist', Role.PHARMACIST, 'Pharmacist'),
    makeUser(E2E.logins.labStaff, 'E2E Lab', Role.LAB_STAFF, 'Laboratory Scientist'),
    makeUser(E2E.logins.accountant, 'E2E Accountant', Role.ACCOUNTANT, 'Accountant'),
  ]);

  const department = await prisma.department.create({
    data: { tenantId, name: 'General Medicine' },
  });

  await prisma.userDepartment.createMany({
    data: [doctor, nurse].map((u) => ({ tenantId, userId: u.id, departmentId: department.id })),
  });

  const consultation = await prisma.serviceItem.create({
    data: { tenantId, code: 'E2E-SVC-001', name: 'General Consultation', category: 'Consultation', unitPrice: 5000 },
  });
  const labTest = await prisma.serviceItem.create({
    data: { tenantId, code: 'E2E-SVC-002', name: 'Full Blood Count', category: 'Laboratory', unitPrice: 6000 },
  });

  const drug = await prisma.drug.create({
    data: { tenantId, sku: 'E2E-MED-001', name: 'Paracetamol 500mg', sellPrice: 100, quantityOnHand: 0 },
  });
  await prisma.drugBatch.create({
    data: {
      tenantId, drugId: drug.id, batchNumber: 'E2E-B1',
      expiryDate: new Date(Date.now() + 365 * 86_400_000), quantity: 500,
    },
  });
  await prisma.drug.update({ where: { id: drug.id }, data: { quantityOnHand: 500 } });

  const ward = await prisma.ward.create({
    data: { tenantId, name: 'E2E General Ward', wardType: 'GENERAL', dailyRate: 15000 },
  });
  const beds = await Promise.all(
    ['E2E-01', 'E2E-02'].map((label) => prisma.bed.create({ data: { tenantId, wardId: ward.id, label } })),
  );

  const insuranceCoPayPct = 10;
  const provider = await prisma.insuranceProvider.create({
    data: {
      tenantId, name: 'E2E Test HMO', kind: InsuranceKind.HMO,
      defaultCoPayPct: insuranceCoPayPct, isActive: true,
    },
  });

  return {
    tenantId,
    userIds: {
      admin: admin.id, reception: reception.id, nurse: nurse.id, doctor: doctor.id,
      pharmacist: pharmacist.id, labStaff: labStaff.id, accountant: accountant.id,
    },
    departmentId: department.id,
    serviceItemIds: { consultation: consultation.id, labTest: labTest.id },
    drugId: drug.id,
    wardId: ward.id,
    bedIds: beds.map((b: { id: string }) => b.id),
    insuranceProviderId: provider.id,
    insuranceProviderName: provider.name,
    insuranceCoPayPct,
  };
}

async function seedSuspendTenant() {
  const passwordHash = await bcrypt.hash(E2E.password, 12);
  const tenant = await prisma.tenant.create({
    data: {
      name: 'E2E Suspend-Test Hospital', slug: E2E.suspendTenantSlug,
      facilityType: FacilityType.HOSPITAL, country: 'NG', plan: Plan.STARTER,
      contactEmail: `admin@${E2E.suspendTenantSlug}.test`,
    },
  });
  await prisma.user.create({
    data: {
      tenantId: tenant.id, email: `admin@${E2E.suspendTenantSlug}.test`, fullName: 'Suspend Test Admin',
      role: Role.HOSPITAL_ADMIN, passwordHash, isActive: true, emailVerifiedAt: new Date(),
    },
  });
  return tenant.id;
}

async function seedPlatformUser() {
  const passwordHash = await bcrypt.hash(E2E.platformPassword, 12);
  await prisma.platformUser.upsert({
    where: { email: E2E.platformEmail },
    create: { email: E2E.platformEmail, passwordHash, fullName: 'E2E Platform Admin' },
    update: { passwordHash, fullName: 'E2E Platform Admin', isActive: true },
  });
}

async function destroyIfExists(slug: string) {
  const existing = await prisma.tenant.findUnique({ where: { slug } });
  if (existing) await destroyTenant(existing.id);
}

export async function seed(): Promise<SeededFixtures> {
  await destroyIfExists(E2E.tenantSlug);
  await destroyIfExists(E2E.suspendTenantSlug);
  const fixtures = await seedMainTenant();
  await seedSuspendTenant();
  await seedPlatformUser();
  return fixtures;
}

if (require.main === module) {
  seed()
    .then((f) => {
      console.log('E2E fixtures seeded:', JSON.stringify(f, null, 2));
      return prisma.$disconnect();
    })
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
