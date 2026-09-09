/* eslint-disable */
/**
 * Structured testing phase harness. NOT a jest suite - run directly:
 *   pnpm --filter @oudhealth/api exec ts-node testphase/run.ts
 *
 * Boots the full AppModule against the real docker Postgres + MinIO, seeds two
 * complete tenants with data in every module, then drives adversarial /
 * cross-tenant / RBAC / money / stock / file / auth probes over HTTP and checks
 * DB invariants. Emits testphase/report.json + a console summary.
 *
 * The JWT auth guard is replaced with an `x-test-user` shim for the RBAC and
 * isolation matrices (it sets req.user exactly as JwtStrategy would); the
 * dedicated auth-edge suite builds a second app with the REAL guard + tokens.
 */
import 'reflect-metadata';
import { INestApplication, ValidationPipe, ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomUUID, createHash } from 'crypto';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { ThrottlerGuard } from '@nestjs/throttler';

export const owner = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

export type Role =
  | 'SUPER_ADMIN' | 'HOSPITAL_ADMIN' | 'DOCTOR' | 'NURSE'
  | 'RECEPTIONIST' | 'PHARMACIST' | 'LAB_STAFF' | 'ACCOUNTANT';

export const ROLES: Role[] = [
  'SUPER_ADMIN', 'HOSPITAL_ADMIN', 'DOCTOR', 'NURSE',
  'RECEPTIONIST', 'PHARMACIST', 'LAB_STAFF', 'ACCOUNTANT',
];

// ── permission matrix (mirror of src/common/permissions.ts, for expectations) ──
const M: Record<string, Role[]> = {
  'appointment:book': ['RECEPTIONIST', 'NURSE', 'DOCTOR', 'HOSPITAL_ADMIN'],
  'appointment:edit': ['RECEPTIONIST', 'NURSE', 'DOCTOR', 'HOSPITAL_ADMIN'],
  'appointment:reschedule': ['RECEPTIONIST', 'NURSE', 'HOSPITAL_ADMIN'],
  'appointment:start': ['DOCTOR', 'NURSE', 'HOSPITAL_ADMIN'],
  'admission:create': ['NURSE', 'DOCTOR', 'HOSPITAL_ADMIN'],
  'admission:edit': ['NURSE', 'DOCTOR', 'HOSPITAL_ADMIN'],
  'admission:transfer': ['NURSE', 'HOSPITAL_ADMIN'],
  'admission:discharge': ['DOCTOR', 'NURSE', 'HOSPITAL_ADMIN'],
  'ward:manage': ['HOSPITAL_ADMIN'],
  'bed:set-status': ['NURSE', 'HOSPITAL_ADMIN'],
  'doctor:set-hours': ['HOSPITAL_ADMIN'],
  'patient:register': ['RECEPTIONIST', 'NURSE', 'DOCTOR', 'HOSPITAL_ADMIN'],
  'patient:read': ['RECEPTIONIST', 'NURSE', 'DOCTOR', 'HOSPITAL_ADMIN'],
  'patient:edit': ['RECEPTIONIST', 'NURSE', 'DOCTOR', 'HOSPITAL_ADMIN'],
  'patient:document': ['RECEPTIONIST', 'NURSE', 'DOCTOR', 'HOSPITAL_ADMIN'],
  'complaint:record': ['RECEPTIONIST', 'NURSE', 'DOCTOR', 'HOSPITAL_ADMIN'],
  'vitals:record': ['NURSE', 'DOCTOR', 'HOSPITAL_ADMIN'],
  'diagnosis:record': ['DOCTOR', 'HOSPITAL_ADMIN'],
  'prescription:write': ['DOCTOR', 'HOSPITAL_ADMIN'],
  'prescription:dispense': ['PHARMACIST', 'HOSPITAL_ADMIN'],
  'pharmacy:manage': ['PHARMACIST', 'HOSPITAL_ADMIN'],
  'note:write': ['DOCTOR', 'HOSPITAL_ADMIN'],
  'order:create': ['DOCTOR', 'HOSPITAL_ADMIN'],
  'order:result': ['LAB_STAFF', 'DOCTOR', 'HOSPITAL_ADMIN'],
  'invoice:pay': ['RECEPTIONIST', 'ACCOUNTANT', 'HOSPITAL_ADMIN'],
  'billing:manage': ['RECEPTIONIST', 'ACCOUNTANT', 'HOSPITAL_ADMIN'],
  'staff:manage': ['HOSPITAL_ADMIN'],
  'admin:settings': ['HOSPITAL_ADMIN'],
  'reports:view': ['HOSPITAL_ADMIN', 'ACCOUNTANT'],
  'claims:manage': ['HOSPITAL_ADMIN', 'ACCOUNTANT'],
};
export function allowed(action: string, role: Role): boolean {
  if (role === 'SUPER_ADMIN') return true;
  return (M[action] ?? []).includes(role);
}

// ── findings ──────────────────────────────────────────────────────────────
export type Sev = 'P0' | 'P1' | 'P2' | 'P3';
export type Kind = 'regression' | 'new defect' | 'known limitation' | 'expected behavior';
export interface Finding {
  id: string;
  severity: Sev;
  area: string;
  role: string;
  endpoint: string;
  steps: string;
  expected: string;
  actual: string;
  impact: string;
  evidence: string;
  rootCause: string;
  kind: Kind;
}
export const findings: Finding[] = [];
let seq = 0;
export function finding(f: Omit<Finding, 'id'>) {
  seq += 1;
  const rec = { id: `TP-${String(seq).padStart(3, '0')}`, ...f };
  findings.push(rec);
  console.log(`  [FINDING ${rec.id}] ${rec.severity} ${rec.area} :: ${rec.endpoint} :: ${rec.actual}`);
  return rec;
}

export interface Check { name: string; ok: boolean; detail?: string }
export const checks: Check[] = [];
export function check(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
  if (!ok) console.log(`  [CHECK FAIL] ${name}${detail ? ' :: ' + detail : ''}`);
  return ok;
}

// ── app setup ─────────────────────────────────────────────────────────────
const testAuthGuard = {
  canActivate: (ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    const hdr = req.headers['x-test-user'];
    if (!hdr) return false;
    req.user = JSON.parse(Array.isArray(hdr) ? hdr[0] : hdr);
    return true;
  },
};

export async function bootShimApp(): Promise<{ app: INestApplication; base: string }> {
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideGuard(JwtAuthGuard).useValue(testAuthGuard)
    .overrideGuard(ThrottlerGuard).useValue({ canActivate: () => true })
    .compile();
  const app = mod.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  await app.init();
  await app.listen(0);
  return { app, base: await app.getUrl() };
}

export async function bootRealAuthApp(): Promise<{ app: INestApplication; base: string }> {
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideGuard(ThrottlerGuard).useValue({ canActivate: () => true })
    .compile();
  const app = mod.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  await app.listen(0);
  return { app, base: await app.getUrl() };
}

// ── HTTP helpers ──────────────────────────────────────────────────────────
export type Who = { userId: string; tenantId: string; tenantSlug: string; role: Role; email: string; fullName: string };

export function makeReq(base: string) {
  return async (method: string, path: string, who: Who | null, body?: any, rawAuth?: string) => {
    const headers: Record<string, string> = {};
    if (who) headers['x-test-user'] = JSON.stringify(who);
    if (rawAuth) headers['authorization'] = rawAuth;
    if (body !== undefined && !(body instanceof FormData)) headers['content-type'] = 'application/json';
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers,
      redirect: 'manual',
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
    let json: any = null;
    const txt = await res.text();
    try { json = txt ? JSON.parse(txt) : null; } catch { json = txt; }
    return { status: res.status, body: json, headers: res.headers };
  };
}

export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

// ── fixtures: a full tenant ───────────────────────────────────────────────
let n = 0;
export const uniq = (p = 'tp') => `${p}-${Date.now().toString(36)}-${n++}`;

export interface TenantWorld {
  tenantId: string;
  slug: string;
  users: Record<Role, Who>;
  patientId: string;
  patient2Id: string;
  visitId: string;
  admissionId: string;
  wardId: string;
  bedId: string;
  departmentId: string;
  serviceItemId: string;
  providerId: string;
  invoiceId: string;
  invoiceLineId: string;
  paymentId: string;
  drugId: string;
  batchId: string;
  prescriptionId: string;
  prescriptionItemId: string;
  complaintId: string;
  diagnosisId: string;
  vitalsId: string;
  noteVisitId: string;
  orderId: string;
  claimId: string;
  claimBatchId: string;
  remittanceId: string;
  storedFileId: string;
  documentId: string;
}

export async function seedTenant(label: string): Promise<TenantWorld> {
  const slug = uniq(label);
  const t = await owner.tenant.create({ data: { name: `TP ${slug}`, slug } });
  const tenantId = t.id;

  const users = {} as Record<Role, Who>;
  for (const role of ROLES) {
    const u = await owner.user.create({
      data: {
        tenantId, email: `${uniq('u')}@tp.test`, fullName: `${role} User`,
        role, isActive: true, passwordHash: 'x', emailVerifiedAt: new Date(),
      },
    });
    users[role] = { userId: u.id, tenantId, tenantSlug: slug, role, email: u.email, fullName: u.fullName };
  }
  const doctorId = users.DOCTOR.userId;

  const dept = await owner.department.create({ data: { tenantId, name: uniq('dept') } });
  const ward = await owner.ward.create({ data: { tenantId, name: uniq('ward') } });
  const bed = await owner.bed.create({ data: { tenantId, wardId: ward.id, label: 'B1' } });
  const svc = await owner.serviceItem.create({ data: { tenantId, name: uniq('svc'), unitPrice: 5000, category: 'Laboratory' } });
  const provider = await owner.insuranceProvider.create({ data: { tenantId, name: uniq('hmo'), kind: 'HMO' } });

  const p1 = await owner.patient.create({
    data: { tenantId, patientNumber: `PT-${uniq('a')}`, firstName: 'Alice', lastName: 'A', registrationStatus: 'COMPLETE', payerType: 'HMO', hmoName: 'X' },
  });
  const p2 = await owner.patient.create({
    data: { tenantId, patientNumber: `PT-${uniq('b')}`, firstName: 'Bob', lastName: 'B', registrationStatus: 'COMPLETE' },
  });

  const now = new Date();
  const visit = await owner.visit.create({
    data: {
      tenantId, patientId: p1.id, doctorId, departmentId: dept.id, visitType: 'CONSULTATION',
      status: 'IN_PROGRESS', startsAt: now, endsAt: new Date(now.getTime() + 1800_000), payerType: 'HMO',
    },
  });
  const noteVisit = await owner.visit.create({
    data: {
      tenantId, patientId: p1.id, doctorId, visitType: 'CONSULTATION',
      status: 'IN_PROGRESS', startsAt: now, endsAt: new Date(now.getTime() + 1800_000),
    },
  });
  const adm = await owner.admission.create({
    data: { tenantId, admissionNumber: `ADM-${uniq()}`, patientId: p2.id, wardId: ward.id, bedId: bed.id, status: 'ADMITTED', admittedAt: now },
  });

  const inv = await owner.invoice.create({
    data: {
      tenantId, patientId: p1.id, invoiceNumber: `INV-${uniq()}`, category: 'Services',
      payerType: 'HMO', status: 'UNPAID', subtotal: 10000, totalAmount: 10000,
      lines: { create: [{ tenantId, description: 'Consult', quantity: 1, unitPrice: 10000, grossAmount: 10000, lineTotal: 10000 }] },
    },
    include: { lines: true },
  });
  const pay = await owner.payment.create({
    data: { tenantId, invoiceId: inv.id, receiptNumber: 'RCP-SEED', amount: 1000, method: 'CASH' },
  });

  const drug = await owner.drug.create({
    data: { tenantId, sku: uniq('med'), name: uniq('Drug'), sellPrice: 100, quantityOnHand: 50 },
  });
  const batch = await owner.drugBatch.create({
    data: { tenantId, drugId: drug.id, batchNumber: 'BA', expiryDate: new Date(now.getTime() + 90 * 86400_000), quantity: 50 },
  });
  const rx = await owner.prescription.create({
    data: {
      tenantId, patientId: p1.id, visitId: visit.id, status: 'ACTIVE', dispenseStatus: 'PENDING',
      items: { create: [{ tenantId, drugId: drug.id, drugName: 'Drug', strengthConc: '500mg' }] },
    },
    include: { items: true },
  });

  const complaint = await owner.complaint.create({ data: { tenantId, patientId: p1.id, description: 'Headache', status: 'OPEN' } });
  const diagnosis = await owner.diagnosis.create({ data: { tenantId, patientId: p1.id, description: 'Migraine' } });
  const vitals = await owner.vitalSigns.create({ data: { tenantId, patientId: p1.id, temperatureC: 37 } });
  const order = await owner.clinicalOrder.create({
    data: { tenantId, patientId: p1.id, visitId: visit.id, orderType: 'LABORATORY', name: 'FBC', status: 'ORDERED' },
  });

  const claim = await owner.insuranceClaim.create({
    data: {
      tenantId, claimNumber: `CLM-${uniq()}`, providerId: provider.id, patientId: p1.id, invoiceId: inv.id,
      memberName: 'Alice A', memberNumber: 'M1', serviceDate: now, status: 'DRAFT',
      claimedAmount: 10000, approvedAmount: 0, paidAmount: 0,
      lines: { create: [{ tenantId, description: 'Consult', quantity: 1, unitPrice: 10000, claimedAmount: 10000 }] },
    } as any,
  });
  const cbatch = await owner.claimBatch.create({
    data: { tenantId, batchNumber: `CB-${uniq()}`, providerId: provider.id, periodStart: now, periodEnd: now, status: 'OPEN' },
  });
  const remit = await owner.claimRemittance.create({
    data: { tenantId, remittanceNumber: `RM-${uniq()}`, providerId: provider.id, receivedAmount: 5000, receivedAt: now },
  });

  const key = `t/${tenantId}/document/${randomUUID()}-f.pdf`;
  const sf = await owner.storedFile.create({
    data: {
      tenantId, key, bucket: process.env.S3_BUCKET ?? 'oudhealth-dev', mimeType: 'application/pdf',
      size: 10, sha256: sha256('x'), originalName: 'f.pdf', category: 'DOCUMENT',
      uploadedById: users.DOCTOR.userId, scanStatus: 'SKIPPED',
    },
  });
  const doc = await owner.patientDocument.create({
    data: {
      tenantId, patientId: p1.id, category: 'OTHER', title: 'Doc', fileName: 'f.pdf',
      mimeType: 'application/pdf', fileUrl: `/api/files/${sf.id}`, uploadedById: users.DOCTOR.userId,
    },
  });

  return {
    tenantId, slug, users,
    patientId: p1.id, patient2Id: p2.id, visitId: visit.id, admissionId: adm.id,
    wardId: ward.id, bedId: bed.id, departmentId: dept.id, serviceItemId: svc.id, providerId: provider.id,
    invoiceId: inv.id, invoiceLineId: inv.lines[0].id, paymentId: pay.id,
    drugId: drug.id, batchId: batch.id, prescriptionId: rx.id, prescriptionItemId: rx.items[0].id,
    complaintId: complaint.id, diagnosisId: diagnosis.id, vitalsId: vitals.id, noteVisitId: noteVisit.id,
    orderId: order.id, claimId: claim.id, claimBatchId: cbatch.id, remittanceId: remit.id,
    storedFileId: sf.id, documentId: doc.id,
  };
}

export async function destroyTenant(tenantId: string) {
  const p = owner;
  await p.claimRemittanceAllocation.deleteMany({ where: { tenantId } });
  await p.claimRemittance.deleteMany({ where: { tenantId } });
  await p.insuranceClaimLine.deleteMany({ where: { OR: [{ tenantId }, { claim: { patient: { tenantId } } }] } });
  await p.insuranceClaim.deleteMany({ where: { OR: [{ tenantId }, { patient: { tenantId } }] } });
  await p.claimBatch.deleteMany({ where: { tenantId } });
  // include cross-tenant rows that reference THIS tenant's patients (id-in-body injection)
  await p.payment.deleteMany({ where: { OR: [{ tenantId }, { invoice: { patient: { tenantId } } }] } });
  await p.invoiceLine.deleteMany({ where: { OR: [{ tenantId }, { invoice: { tenantId } }, { invoice: { patient: { tenantId } } }] } });
  await p.invoice.deleteMany({ where: { OR: [{ tenantId }, { patient: { tenantId } }] } });
  await p.stockMovement.deleteMany({ where: { tenantId } });
  await p.drugBatch.deleteMany({ where: { tenantId } });
  await p.prescriptionItem.deleteMany({ where: { prescription: { OR: [{ tenantId }, { patient: { tenantId } }] } } });
  await p.prescription.deleteMany({ where: { OR: [{ tenantId }, { patient: { tenantId } }] } });
  await p.clinicalOrder.deleteMany({ where: { OR: [{ tenantId }, { patient: { tenantId } }] } });
  await p.clinicalNote.deleteMany({ where: { OR: [{ tenantId }, { patient: { tenantId } }] } });
  await p.vitalSigns.deleteMany({ where: { OR: [{ tenantId }, { patient: { tenantId } }] } });
  await p.diagnosis.deleteMany({ where: { OR: [{ tenantId }, { patient: { tenantId } }] } });
  await p.complaint.deleteMany({ where: { OR: [{ tenantId }, { patient: { tenantId } }] } });
  await p.patientDocument.deleteMany({ where: { OR: [{ tenantId }, { patient: { tenantId } }] } });
  await p.storedFile.deleteMany({ where: { tenantId } });
  await p.tenantSequence.deleteMany({ where: { tenantId } });
  await p.drug.deleteMany({ where: { tenantId } });
  await p.visit.deleteMany({ where: { OR: [{ tenantId }, { patient: { tenantId } }] } });
  await p.admission.deleteMany({ where: { OR: [{ tenantId }, { patient: { tenantId } }] } });
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
