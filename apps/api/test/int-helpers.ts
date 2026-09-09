/**
 * Shared setup for integration specs (`*.int-spec.ts`). These hit the real docker
 * Postgres. Fixtures are created/torn down with an OWNER connection (bypasses RLS);
 * the service under test uses the normal PrismaService (APP_DATABASE_URL, RLS on).
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

export const ownerPrisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

let counter = 0;
export function uniqueSlug(prefix = 'itest') {
  return `${prefix}-${Date.now().toString(36)}-${counter++}`;
}

export async function makeTenant() {
  const slug = uniqueSlug();
  const tenant = await ownerPrisma.tenant.create({
    data: { name: `IT ${slug}`, slug },
  });
  return tenant;
}

export async function makeUser(tenantId: string, role: any = 'HOSPITAL_ADMIN') {
  return ownerPrisma.user.create({
    data: {
      tenantId,
      email: `${uniqueSlug('u')}@int.test`,
      fullName: 'Integration Tester',
      role,
      isActive: true,
      passwordHash: 'x',
      emailVerifiedAt: new Date(),
    },
  });
}

export async function makePatient(tenantId: string, extra: Record<string, unknown> = {}) {
  const n = counter++;
  return ownerPrisma.patient.create({
    data: {
      tenantId,
      patientNumber: `PT-IT-${n}`,
      firstName: 'Test',
      lastName: `Patient${n}`,
      registrationStatus: 'COMPLETE',
      ...extra,
    },
  });
}

export async function makeVisit(
  tenantId: string,
  patientId: string,
  extra: Record<string, unknown> = {},
) {
  const start = new Date();
  return ownerPrisma.visit.create({
    data: {
      tenantId,
      patientId,
      visitType: 'CONSULTATION',
      status: 'COMPLETED',
      startsAt: start,
      endsAt: new Date(start.getTime() + 30 * 60000),
      ...extra,
    },
  });
}

export function actorFor(tenantId: string, userId: string, role = 'HOSPITAL_ADMIN') {
  return { tenantId, userId, role };
}

/** Delete every row a fixture might have created for one tenant, children first. */
export async function destroyTenant(tenantId: string) {
  const p = ownerPrisma;
  await p.claimRemittanceAllocation.deleteMany({ where: { tenantId } });
  await p.claimRemittance.deleteMany({ where: { tenantId } });
  await p.insuranceClaimLine.deleteMany({ where: { tenantId } });
  await p.insuranceClaim.deleteMany({ where: { tenantId } });
  await p.claimBatch.deleteMany({ where: { tenantId } });
  await p.payment.deleteMany({ where: { tenantId } });
  await p.invoiceLine.deleteMany({ where: { invoice: { tenantId } } });
  await p.invoice.deleteMany({ where: { tenantId } });
  await p.stockMovement.deleteMany({ where: { tenantId } });
  await p.drugBatch.deleteMany({ where: { tenantId } });
  await p.prescriptionItem.deleteMany({ where: { prescription: { tenantId } } });
  await p.prescription.deleteMany({ where: { tenantId } });
  await p.clinicalOrder.deleteMany({ where: { tenantId } });
  await p.clinicalNote.deleteMany({ where: { tenantId } });
  await p.vitalSigns.deleteMany({ where: { tenantId } });
  await p.diagnosis.deleteMany({ where: { tenantId } });
  await p.complaint.deleteMany({ where: { tenantId } });
  await p.patientDocument.deleteMany({ where: { tenantId } });
  await p.storedFile.deleteMany({ where: { tenantId } });
  await p.tenantSequence.deleteMany({ where: { tenantId } });
  await p.drug.deleteMany({ where: { tenantId } });
  await p.visit.deleteMany({ where: { tenantId } });
  await p.admission.deleteMany({ where: { tenantId } });
  await p.serviceItem.deleteMany({ where: { tenantId } });
  await p.insuranceProvider.deleteMany({ where: { tenantId } });
  await p.doctorShift.deleteMany({ where: { tenantId } });
  await p.userDepartment.deleteMany({ where: { tenantId } });
  await p.bed.deleteMany({ where: { tenantId } });
  await p.ward.deleteMany({ where: { tenantId } });
  await p.auditLog.deleteMany({ where: { tenantId } });
  await p.patient.deleteMany({ where: { tenantId } });
  await p.department.deleteMany({ where: { tenantId } });
  await p.user.deleteMany({ where: { tenantId } });
  await p.tenant.deleteMany({ where: { id: tenantId } });
}

export { randomUUID };
