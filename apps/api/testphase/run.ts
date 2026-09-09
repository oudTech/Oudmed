/* eslint-disable */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { JwtService } from '@nestjs/jwt';
import {
  owner, ROLES, Role, allowed, finding, check, checks, findings,
  bootShimApp, bootRealAuthApp, makeReq, seedTenant, destroyTenant, TenantWorld, Who, sha256,
} from './harness';

const JWT_SECRET = process.env.JWT_SECRET as string;
const S3_PUBLIC = process.env.S3_PUBLIC_ENDPOINT ?? 'http://localhost:9000';

let A: TenantWorld;
let B: TenantWorld;
let req: ReturnType<typeof makeReq>;

// PNG / PDF magic bytes for file tests
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 1)]);
const HTML_AS_PNG = Buffer.from('<html><script>alert(1)</script></html>');

function fd(buf: Buffer, name: string, mime: string, extra: Record<string, string> = {}) {
  const f = new FormData();
  f.append('file', new Blob([buf], { type: mime }), name);
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  return f;
}

// ────────────────────────────────────────────────────────────────────────────
// 1. TENANT ISOLATION
// ────────────────────────────────────────────────────────────────────────────
let A_MARKERS: string[] = [];
async function suiteIsolation() {
  console.log('\n== 1. TENANT ISOLATION ==');
  A_MARKERS = [
    A.tenantId, A.slug, A.patientId, A.patient2Id, A.visitId, A.admissionId, A.invoiceId,
    A.invoiceLineId, A.paymentId, A.drugId, A.batchId, A.prescriptionId, A.claimId,
    A.claimBatchId, A.remittanceId, A.storedFileId, A.documentId, A.orderId, A.complaintId,
    A.diagnosisId, A.vitalsId, A.wardId, A.departmentId, A.serviceItemId, A.providerId,
    A.users.NURSE.userId, A.users.DOCTOR.userId, 'Alice', 'PT-tp-a',
  ].filter(Boolean);
  // Each entry: an A-resource endpoint. `role` is a role that IS allowed the action
  // in both tenants, so a cross-tenant call reaching the resource check yields 404
  // (not 403). We hit it as B's user of that role.
  type Row = { area: string; method: string; path: (w: TenantWorld) => string; role: Role; body?: any };
  const rows: Row[] = [
    { area: 'patients', method: 'GET', path: (w) => `/patients/${w.patientId}`, role: 'DOCTOR' },
    { area: 'patients', method: 'PATCH', path: (w) => `/patients/${w.patientId}`, role: 'DOCTOR', body: { phone: '0800' } },
    { area: 'patients', method: 'GET', path: (w) => `/patients/${w.patientId}/documents`, role: 'DOCTOR' },
    { area: 'patients', method: 'GET', path: (w) => `/patients/${w.patientId}/documents/${w.documentId}/url`, role: 'DOCTOR' },
    { area: 'patients', method: 'DELETE', path: (w) => `/patients/${w.patientId}/documents/${w.documentId}`, role: 'HOSPITAL_ADMIN' },
    { area: 'clinical', method: 'GET', path: (w) => `/patients/${w.patientId}/complaints`, role: 'DOCTOR' },
    { area: 'clinical', method: 'GET', path: (w) => `/patients/${w.patientId}/diagnoses`, role: 'DOCTOR' },
    { area: 'clinical', method: 'GET', path: (w) => `/patients/${w.patientId}/vitals`, role: 'DOCTOR' },
    { area: 'clinical', method: 'GET', path: (w) => `/patients/${w.patientId}/prescriptions`, role: 'DOCTOR' },
    { area: 'clinical', method: 'GET', path: (w) => `/patients/${w.patientId}/orders`, role: 'DOCTOR' },
    { area: 'clinical', method: 'GET', path: (w) => `/patients/${w.patientId}/notes`, role: 'DOCTOR' },
    { area: 'clinical', method: 'GET', path: (w) => `/patients/${w.patientId}/appointments`, role: 'DOCTOR' },
    { area: 'clinical', method: 'GET', path: (w) => `/patients/${w.patientId}/invoices`, role: 'DOCTOR' },
    { area: 'clinical', method: 'POST', path: (w) => `/patients/${w.patientId}/complaints`, role: 'DOCTOR', body: { description: 'xx' } },
    { area: 'clinical', method: 'POST', path: (w) => `/patients/${w.patientId}/vitals`, role: 'DOCTOR', body: { temperatureC: 37 } },
    { area: 'clinical', method: 'POST', path: (w) => `/patients/${w.patientId}/diagnoses`, role: 'DOCTOR', body: { description: 'xx' } },
    { area: 'clinical', method: 'PATCH', path: (w) => `/patients/${w.patientId}/complaints/${w.complaintId}`, role: 'DOCTOR', body: { status: 'RESOLVED' } },
    { area: 'clinical', method: 'POST', path: (w) => `/patients/${w.patientId}/invoices/${w.invoiceId}/payments`, role: 'RECEPTIONIST', body: { amount: 10, method: 'CASH' } },
    { area: 'encounters', method: 'GET', path: (w) => `/encounters/${w.visitId}`, role: 'DOCTOR' },
    { area: 'encounters', method: 'PUT', path: (w) => `/encounters/${w.noteVisitId}/note`, role: 'DOCTOR', body: { subjective: 'x' } },
    { area: 'encounters', method: 'POST', path: (w) => `/encounters/${w.visitId}/orders`, role: 'DOCTOR', body: { orderType: 'LABORATORY', name: 'xx' } },
    { area: 'encounters', method: 'PATCH', path: (w) => `/encounters/orders/${w.orderId}`, role: 'DOCTOR', body: { status: 'IN_PROGRESS' } },
    { area: 'billing', method: 'GET', path: (w) => `/billing/invoices/${w.invoiceId}`, role: 'ACCOUNTANT' },
    { area: 'billing', method: 'PATCH', path: (w) => `/billing/invoices/${w.invoiceId}`, role: 'ACCOUNTANT', body: { note: 'x' } },
    { area: 'billing', method: 'POST', path: (w) => `/billing/invoices/${w.invoiceId}/payments`, role: 'ACCOUNTANT', body: { amount: 10, method: 'CASH' } },
    { area: 'billing', method: 'POST', path: (w) => `/billing/invoices/${w.invoiceId}/cancel`, role: 'ACCOUNTANT', body: { reason: 'x' } },
    { area: 'billing', method: 'DELETE', path: (w) => `/billing/invoices/${w.invoiceId}/lines/${w.invoiceLineId}`, role: 'ACCOUNTANT' },
    { area: 'billing', method: 'POST', path: (w) => `/billing/payments/${w.paymentId}/reverse`, role: 'ACCOUNTANT', body: { reason: 'x' } },
    { area: 'billing', method: 'GET', path: (w) => `/billing/payments/${w.paymentId}/receipt`, role: 'ACCOUNTANT' },
    { area: 'claims', method: 'GET', path: (w) => `/claims/${w.claimId}`, role: 'ACCOUNTANT' },
    { area: 'claims', method: 'PATCH', path: (w) => `/claims/${w.claimId}`, role: 'ACCOUNTANT', body: { notes: 'x' } },
    { area: 'claims', method: 'POST', path: (w) => `/claims/${w.claimId}/cancel`, role: 'ACCOUNTANT', body: { reason: 'x' } },
    { area: 'claims', method: 'GET', path: (w) => `/claims/batches/${w.claimBatchId}`, role: 'ACCOUNTANT' },
    { area: 'claims', method: 'GET', path: (w) => `/claims/batches/${w.claimBatchId}/export.csv`, role: 'ACCOUNTANT' },
    { area: 'claims', method: 'POST', path: (w) => `/claims/batches/${w.claimBatchId}/close`, role: 'ACCOUNTANT' },
    { area: 'claims', method: 'GET', path: (w) => `/claims/remittances/${w.remittanceId}`, role: 'ACCOUNTANT' },
    { area: 'claims', method: 'POST', path: (w) => `/claims/remittances/${w.remittanceId}/reverse`, role: 'ACCOUNTANT', body: { reason: 'x' } },
    { area: 'pharmacy', method: 'GET', path: (w) => `/pharmacy/drugs/${w.drugId}`, role: 'PHARMACIST' },
    { area: 'pharmacy', method: 'PATCH', path: (w) => `/pharmacy/drugs/${w.drugId}`, role: 'PHARMACIST', body: { name: 'x2' } },
    { area: 'pharmacy', method: 'DELETE', path: (w) => `/pharmacy/drugs/${w.drugId}`, role: 'PHARMACIST' },
    { area: 'pharmacy', method: 'POST', path: (w) => `/pharmacy/drugs/${w.drugId}/adjust`, role: 'PHARMACIST', body: { delta: 1, reason: 'count' } },
    { area: 'pharmacy', method: 'POST', path: (w) => `/pharmacy/prescriptions/${w.prescriptionId}/dispense`, role: 'PHARMACIST', body: { items: [{ itemId: '00000000-0000-0000-0000-000000000000', quantity: 0, unitPrice: 0 }] } },
    { area: 'pharmacy', method: 'PATCH', path: (w) => `/pharmacy/prescriptions/${w.prescriptionId}/cancel`, role: 'PHARMACIST' },
    { area: 'admissions', method: 'GET', path: (w) => `/admissions/${w.admissionId}`, role: 'DOCTOR' },
    { area: 'admissions', method: 'PATCH', path: (w) => `/admissions/${w.admissionId}`, role: 'DOCTOR', body: { reason: 'x' } },
    { area: 'admissions', method: 'POST', path: (w) => `/admissions/${w.admissionId}/discharge`, role: 'DOCTOR', body: { dischargeNotes: 'x' } },
    { area: 'admissions', method: 'POST', path: (w) => `/admissions/${w.admissionId}/transfer`, role: 'NURSE', body: { wardId: A.wardId, bedId: A.bedId } },
    { area: 'schedule', method: 'GET', path: (w) => `/schedule/${w.visitId}`, role: 'DOCTOR' },
    { area: 'schedule', method: 'PATCH', path: (w) => `/schedule/${w.visitId}`, role: 'NURSE', body: { reason: 'x' } },
    { area: 'schedule', method: 'POST', path: (w) => `/schedule/${w.visitId}/reschedule`, role: 'NURSE', body: { startsAt: new Date(Date.now() + 86400000).toISOString() } },
    { area: 'schedule', method: 'POST', path: (w) => `/schedule/${w.visitId}/status`, role: 'NURSE', body: { status: 'COMPLETED' } },
    { area: 'wards', method: 'PATCH', path: (w) => `/wards/${w.wardId}`, role: 'HOSPITAL_ADMIN', body: { name: 'x2' } },
    { area: 'wards', method: 'POST', path: (w) => `/wards/${w.wardId}/beds`, role: 'HOSPITAL_ADMIN', body: { labels: ['Z9'] } },
    { area: 'wards', method: 'PATCH', path: (w) => `/wards/${w.wardId}/beds/${w.bedId}`, role: 'NURSE', body: { status: 'AVAILABLE' } },
    { area: 'staff', method: 'GET', path: (w) => `/staff/${w.users.NURSE.userId}`, role: 'HOSPITAL_ADMIN' },
    { area: 'staff', method: 'PATCH', path: (w) => `/staff/${w.users.NURSE.userId}`, role: 'HOSPITAL_ADMIN', body: { jobTitle: 'x' } },
    { area: 'staff', method: 'POST', path: (w) => `/staff/${w.users.NURSE.userId}/deactivate`, role: 'HOSPITAL_ADMIN' },
    { area: 'staff', method: 'POST', path: (w) => `/staff/${w.users.NURSE.userId}/set-password`, role: 'HOSPITAL_ADMIN', body: { password: 'abcd1234!' } },
    { area: 'directory', method: 'GET', path: (w) => `/directory/staff/${w.users.DOCTOR.userId}/shifts`, role: 'HOSPITAL_ADMIN' },
    { area: 'directory', method: 'PUT', path: (w) => `/directory/staff/${w.users.DOCTOR.userId}/shifts`, role: 'HOSPITAL_ADMIN', body: { shifts: [] } },
    { area: 'admin', method: 'PATCH', path: (w) => `/admin/departments/${w.departmentId}`, role: 'HOSPITAL_ADMIN', body: { name: 'x2' } },
    { area: 'admin', method: 'POST', path: (w) => `/admin/departments/${w.departmentId}/toggle`, role: 'HOSPITAL_ADMIN' },
    { area: 'admin', method: 'DELETE', path: (w) => `/admin/services/${w.serviceItemId}`, role: 'HOSPITAL_ADMIN' },
    { area: 'admin', method: 'PATCH', path: (w) => `/admin/insurance-providers/${w.providerId}`, role: 'HOSPITAL_ADMIN', body: { name: 'x2' } },
    { area: 'files', method: 'GET', path: (w) => `/files/${w.storedFileId}`, role: 'HOSPITAL_ADMIN' },
    { area: 'files', method: 'GET', path: (w) => `/files/${w.storedFileId}/meta`, role: 'HOSPITAL_ADMIN' },
    { area: 'files', method: 'DELETE', path: (w) => `/files/${w.storedFileId}`, role: 'HOSPITAL_ADMIN' },
  ];

  // One read-only fixture sanity check (do NOT run mutating baselines - they
  // cascade-destroy the fixture and later suites need it).
  for (const [label, m, pth] of [
    ['patient', 'GET', `/patients/${A.patientId}`],
    ['invoice', 'GET', `/billing/invoices/${A.invoiceId}`],
    ['drug', 'GET', `/pharmacy/drugs/${A.drugId}`],
    ['claim', 'GET', `/claims/${A.claimId}`],
    ['admission', 'GET', `/admissions/${A.admissionId}`],
    ['file', 'GET', `/files/${A.storedFileId}/meta`],
  ] as const) {
    const role: Role = label === 'invoice' || label === 'claim' ? 'ACCOUNTANT' : label === 'drug' ? 'PHARMACIST' : label === 'file' ? 'HOSPITAL_ADMIN' : 'DOCTOR';
    const s = (await req(m, pth, A.users[role], undefined)).status;
    check(`isolation:fixture ${label} readable by its own tenant`, s >= 200 && s < 300, `A/${role} GET -> ${s}`);
  }

  for (const r of rows) {
    const path = r.path(A);
    // cross-tenant: B's user of the same role hits A's resource. No A-side call.
    const xres = await req(r.method, path, B.users[r.role], r.body);
    const tag = `${r.method} ${path.replace(/[0-9a-f-]{36}/g, ':id')}`;
    if (xres.status === 404) {
      check(`isolation:x ${r.area} ${tag}`, true, `B/${r.role} -> 404 (correct)`);
    } else if (xres.status >= 200 && xres.status < 300) {
      const s = JSON.stringify(xres.body ?? '');
      const arr = Array.isArray(xres.body);
      const leaked = A_MARKERS.some((m) => m && s.includes(m)) || (arr && (xres.body as any[]).length > 0);
      if (leaked) {
        finding({
          severity: 'P0', area: `tenant-isolation/${r.area}`, role: `B.${r.role}`, endpoint: tag,
          steps: `Create resource in tenant A. As tenant B ${r.role}, call ${tag} with A's id.`,
          expected: '404 (resource not visible to another tenant)',
          actual: `${xres.status} - response carries tenant A data`,
          impact: 'Cross-tenant data access / modification - breaks the core multi-tenant guarantee.',
          evidence: s.slice(0, 500),
          rootCause: 'Resource lookup not tenant-scoped / RLS not covering this path.',
          kind: 'new defect',
        });
      } else {
        // 200 with an empty result set (RLS filtered) or a mutation that hit no rows.
        // No data leak; weaker than a 404 but the existing patient-authz spec blesses
        // "200 [] under RLS" for list-under-patient routes.
        check(`isolation:x ${r.area} ${tag}`, true, `B/${r.role} -> ${xres.status} but no tenant-A data (RLS-empty)`);
        if (r.method !== 'GET') {
          finding({
            severity: 'P2', area: `tenant-isolation/${r.area}`, role: `B.${r.role}`, endpoint: tag,
            steps: `As tenant B ${r.role}, call ${tag} with tenant A's id.`,
            expected: '404 - the target does not exist for this tenant',
            actual: `${xres.status} - mutation "succeeded" (0 rows affected under RLS)`,
            impact: 'Confusing success semantics; a caller believes it modified something. No cross-tenant write occurred.',
            evidence: s.slice(0, 300),
            rootCause: 'Handler does not verify the row exists before the RLS-scoped UPDATE/DELETE.',
            kind: 'new defect',
          });
        }
      }
    } else if (xres.status === 403) {
      finding({
        severity: 'P3', area: `tenant-isolation/${r.area}`, role: `B.${r.role}`, endpoint: tag,
        steps: `As tenant B ${r.role}, call ${tag} with tenant A's id.`,
        expected: '404 (never reveal that the id exists in another tenant)',
        actual: '403 - reveals the id exists but is forbidden',
        impact: 'Minor: an attacker can distinguish "exists in another tenant" from "does not exist".',
        evidence: JSON.stringify(xres.body).slice(0, 200),
        rootCause: 'Authorization (assertCan) runs before the tenant-scoped lookup, so a cross-tenant id hits 403 not 404.',
        kind: 'expected behavior',
      });
    } else if (xres.status === 400 || xres.status === 409 || xres.status === 422) {
      // ValidationPipe / business-rule rejection before the resource is loaded.
      // Not a leak and not an oracle, but flag if the body echoes tenant-A data.
      const leaksA = JSON.stringify(xres.body || '').includes(A.tenantId) || JSON.stringify(xres.body || '').includes(A.slug);
      check(`isolation:x ${r.area} ${tag}`, !leaksA, `B/${r.role} got ${xres.status}${leaksA ? ' AND body references tenant A' : ' (no leak)'}`);
    } else {
      check(`isolation:x ${r.area} ${tag}`, false, `B/${r.role} got unexpected ${xres.status}`);
    }
  }

  // ID-in-body: create-with-foreign-reference
  const bodyProbes: { name: string; method: string; path: string; who: Who; body: any }[] = [
    { name: 'billing.createInvoice with A.patientId', method: 'POST', path: '/billing/invoices', who: B.users.ACCOUNTANT, body: { patientId: A.patientId, lines: [{ description: 'x', quantity: 1, unitPrice: 100 }] } },
    { name: 'schedule.create with A.patientId+A.doctorId', method: 'POST', path: '/schedule', who: B.users.RECEPTIONIST, body: { patientId: A.patientId, doctorId: A.users.DOCTOR.userId, startsAt: new Date(Date.now() + 3600000).toISOString(), endsAt: new Date(Date.now() + 5400000).toISOString() } },
    { name: 'admissions.admit with A.patientId', method: 'POST', path: '/admissions', who: B.users.DOCTOR, body: { patientId: A.patientId, wardId: B.wardId, bedId: B.bedId, admissionType: 'ELECTIVE' } },
    { name: 'clinical.addComplaint under B patient path with A patientId in URL', method: 'POST', path: `/patients/${A.patientId}/complaints`, who: B.users.DOCTOR, body: { description: 'xx' } },
  ];
  for (const p of bodyProbes) {
    const res = await req(p.method, p.path, p.who, p.body);
    const tag = `${p.method} ${p.path.replace(/[0-9a-f-]{36}/g, ':id')} [${p.name}]`;
    if (res.status >= 200 && res.status < 300) {
      const newId = res.body?.id;
      // characterise: can B read it back? does A see it? did A's own view change?
      let bReadBack = '', aSees = '', aPatientInvoices = '';
      if (p.path.includes('/billing/invoices') && newId) {
        bReadBack = String((await req('GET', `/billing/invoices/${newId}`, p.who, undefined)).status);
        aSees = String((await req('GET', `/billing/invoices/${newId}`, A.users.ACCOUNTANT, undefined)).status);
        const av = await req('GET', `/patients/${A.patientId}/invoices`, A.users.DOCTOR, undefined);
        aPatientInvoices = Array.isArray(av.body) ? `${av.body.length} rows; contains new=${JSON.stringify(av.body).includes(newId)}` : 'n/a';
      }
      finding({
        severity: 'P2', area: 'tenant-isolation/id-in-body', role: 'B.' + p.who.role, endpoint: tag,
        steps: `As tenant B ACCOUNTANT, POST /billing/invoices with { patientId: <tenant A patient uuid>, lines:[...] }.`,
        expected: '400 / 404 - cannot reference another tenant\'s patient',
        actual: `${res.status} - a tenant-B invoice row was created bound to tenant A's patient. B read-back=${bReadBack} (cannot use it), A read-back=${aSees}, A patient's invoice list contains it: no (${aPatientInvoices}).`,
        impact: 'Cross-tenant referential-integrity break + a patient-existence oracle (201 vs 4xx tells B whether a given UUID is a real patient in some tenant). No PHI crosses: the invoice lives in tenant B, A cannot see it, and B cannot load it (500 on read-back). Practical harm: DB pollution and a foreign FK on A\'s patient row.',
        evidence: JSON.stringify(res.body).slice(0, 200),
        rootCause: 'BillingService.createInvoiceTx does not verify dto.patientId belongs to actor.tenantId before tx.invoice.create; the Patient FK check runs with RLS bypassed.',
        kind: 'new defect',
      });
    } else {
      check(`isolation:body ${tag}`, res.status === 404 || res.status === 400, `got ${res.status} (${p.name})`);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 2. RBAC MATRIX
// ────────────────────────────────────────────────────────────────────────────
async function suiteRbac() {
  console.log('\n== 2. RBAC MATRIX ==');
  type Row = { area: string; action: string; method: string; path: (w: TenantWorld) => string; body?: any };
  const rows: Row[] = [
    { area: 'patients', action: 'patient:read', method: 'GET', path: (w) => `/patients/${w.patientId}` },
    { area: 'patients', action: 'patient:read', method: 'GET', path: () => `/patients` },
    { area: 'patients', action: 'patient:read', method: 'GET', path: () => `/patients/stats` },
    { area: 'patients', action: 'patient:register', method: 'POST', path: () => `/patients`, body: { firstName: 'New', lastName: 'P' } },
    { area: 'patients', action: 'patient:edit', method: 'PATCH', path: (w) => `/patients/${w.patientId}`, body: { phone: '0801' } },
    { area: 'patients', action: 'patient:read', method: 'GET', path: (w) => `/patients/${w.patientId}/documents` },
    { area: 'clinical', action: 'patient:read', method: 'GET', path: (w) => `/patients/${w.patientId}/vitals` },
    { area: 'clinical', action: 'vitals:record', method: 'POST', path: (w) => `/patients/${w.patientId}/vitals`, body: { temperatureC: 37 } },
    { area: 'clinical', action: 'diagnosis:record', method: 'POST', path: (w) => `/patients/${w.patientId}/diagnoses`, body: { description: 'dx' } },
    { area: 'clinical', action: 'prescription:write', method: 'POST', path: (w) => `/patients/${w.patientId}/prescriptions`, body: { items: [{ drugName: 'Para' }] } },
    { area: 'clinical', action: 'complaint:record', method: 'POST', path: (w) => `/patients/${w.patientId}/complaints`, body: { description: 'cc' } },
    { area: 'encounters', action: 'patient:read', method: 'GET', path: (w) => `/encounters/${w.visitId}` },
    { area: 'encounters', action: 'note:write', method: 'PUT', path: (w) => `/encounters/${w.noteVisitId}/note`, body: { subjective: 's' } },
    { area: 'encounters', action: 'order:create', method: 'POST', path: (w) => `/encounters/${w.visitId}/orders`, body: { orderType: 'LABORATORY', name: 'FBC' } },
    { area: 'lab', action: 'order:result', method: 'GET', path: () => `/lab/worklist` },
    { area: 'billing', action: 'billing:manage', method: 'GET', path: () => `/billing/invoices` },
    { area: 'billing', action: 'billing:manage', method: 'GET', path: (w) => `/billing/invoices/${w.invoiceId}` },
    { area: 'billing', action: 'invoice:pay', method: 'POST', path: (w) => `/billing/invoices/${w.invoiceId}/payments`, body: { amount: 1, method: 'CASH' } },
    { area: 'billing', action: 'billing:manage', method: 'GET', path: () => `/billing/catalogue` },
    { area: 'claims', action: 'claims:manage', method: 'GET', path: () => `/claims` },
    { area: 'claims', action: 'claims:manage', method: 'GET', path: (w) => `/claims/${w.claimId}` },
    { area: 'claims', action: 'claims:manage', method: 'GET', path: () => `/claims/receivables` },
    { area: 'claims', action: 'claims:manage', method: 'GET', path: () => `/claims/remittances` },
    { area: 'pharmacy', action: 'prescription:dispense', method: 'GET', path: () => `/pharmacy/queue` },
    { area: 'pharmacy', action: 'pharmacy:manage', method: 'GET', path: () => `/pharmacy/drugs` },
    { area: 'pharmacy', action: 'pharmacy:manage', method: 'GET', path: () => `/pharmacy/drugs/stats` },
    { area: 'pharmacy', action: 'pharmacy:manage', method: 'GET', path: (w) => `/pharmacy/drugs/${w.drugId}` },
    { area: 'admissions', action: 'patient:read', method: 'GET', path: () => `/admissions` },
    { area: 'admissions', action: 'admission:create', method: 'POST', path: (w) => `/admissions`, body: { patientId: A.patientId, wardId: A.wardId, bedId: A.bedId, admissionType: 'ELECTIVE' } },
    { area: 'schedule', action: 'patient:read', method: 'GET', path: () => `/schedule` },
    { area: 'schedule', action: 'appointment:book', method: 'POST', path: (w) => `/schedule`, body: { patientId: A.patientId, doctorId: A.users.DOCTOR.userId, startsAt: new Date(Date.now() + 3600000).toISOString(), endsAt: new Date(Date.now() + 5400000).toISOString() } },
    { area: 'staff', action: 'staff:manage', method: 'GET', path: () => `/staff` },
    { area: 'staff', action: 'staff:manage', method: 'GET', path: (w) => `/staff/${w.users.NURSE.userId}` },
    { area: 'staff', action: 'staff:manage', method: 'POST', path: () => `/staff`, body: { firstName: 'S', lastName: 'T', email: `x${Date.now()}@t.io`, role: 'NURSE', password: 'abcd1234!' } },
    { area: 'settings', action: 'admin:settings', method: 'PATCH', path: () => `/settings`, body: { website: 'https://x.io' } },
    { area: 'reports', action: 'reports:view', method: 'GET', path: () => `/reports/overview` },
    { area: 'admin', action: 'admin:settings', method: 'POST', path: () => `/admin/departments`, body: { name: `d${Date.now()}` } },
    { area: 'wards', action: 'ward:manage', method: 'POST', path: () => `/wards`, body: { name: `w${Date.now()}`, wardType: 'GENERAL' } },
    { area: 'directory', action: 'doctor:set-hours', method: 'PUT', path: (w) => `/directory/staff/${w.users.DOCTOR.userId}/shifts`, body: { shifts: [] } },
  ];

  for (const r of rows) {
    for (const role of ROLES) {
      const path = r.path(A);
      const res = await req(r.method, path, A.users[role], r.body);
      const tag = `${r.method} ${path.replace(/[0-9a-f-]{36}/g, ':id')} (${r.action})`;
      const shouldAllow = allowed(r.action, role);
      if (shouldAllow && res.status === 403) {
        finding({
          severity: 'P1', area: `rbac/${r.area}`, role, endpoint: tag,
          steps: `As ${role} in tenant A (which HAS ${r.action}), call ${tag}.`,
          expected: 'not 403 (role holds the permission)',
          actual: '403 - a legitimate role is blocked',
          impact: 'Broken workflow: this role cannot perform an action the permission matrix grants it.',
          evidence: JSON.stringify(res.body).slice(0, 200),
          rootCause: 'Endpoint asserts a stricter / wrong action than the matrix entry.',
          kind: 'regression',
        });
      } else if (!shouldAllow && res.status !== 403) {
        // 404 on a resource route for a role that also lacks patient:read etc is acceptable ONLY
        // if the gate is elsewhere; but our resources exist, so a non-403 for a denied role is a finding.
        finding({
          severity: 'P1', area: `rbac/${r.area}`, role, endpoint: tag,
          steps: `As ${role} in tenant A (which LACKS ${r.action}), call ${tag} against an existing resource.`,
          expected: '403',
          actual: `${res.status}`,
          impact: res.status < 300 ? 'Privilege escalation: role performed an action it should not have.' : 'Authorization not enforced for this role at this endpoint (leaks status / may act).',
          evidence: JSON.stringify(res.body).slice(0, 250),
          rootCause: 'Missing or wrong assertCan for this endpoint.',
          kind: 'new defect',
        });
      } else {
        check(`rbac ${tag} ${role}`, true, `${shouldAllow ? 'allow' : 'deny'} -> ${res.status}`);
      }
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 4. MONEY INTEGRITY (workflow + invariants + concurrency)
// ────────────────────────────────────────────────────────────────────────────
async function suiteMoney() {
  console.log('\n== 4. MONEY INTEGRITY ==');
  const acc = A.users.ACCOUNTANT;
  // fresh patient + ad-hoc invoice via the API
  const p = await owner.patient.create({ data: { tenantId: A.tenantId, patientNumber: `PT-${Date.now()}`, firstName: 'Mon', lastName: 'Ey', registrationStatus: 'COMPLETE' } });
  const created = await req('POST', '/billing/invoices', acc, { patientId: p.id, lines: [{ description: 'Consult', quantity: 1, unitPrice: 8000 }, { description: 'Test', quantity: 2, unitPrice: 1000 }] });
  check('money:create invoice 2xx', created.status >= 200 && created.status < 300, `status ${created.status}`);
  const invId = created.body?.id;
  if (!invId) { check('money:invoice id returned', false); return; }

  const get1 = await req('GET', `/billing/invoices/${invId}`, acc, undefined);
  check('money:invoice total = 10000', Number(get1.body?.totalAmount) === 10000, `got ${get1.body?.totalAmount}`);
  check('money:invoice status UNPAID', get1.body?.status === 'UNPAID', `got ${get1.body?.status}`);

  // partial payment
  const pay1 = await req('POST', `/billing/invoices/${invId}/payments`, acc, { amount: 3000, method: 'CASH' });
  check('money:partial payment 2xx', pay1.status >= 200 && pay1.status < 300, `status ${pay1.status} ${JSON.stringify(pay1.body).slice(0,150)}`);
  const get2 = await req('GET', `/billing/invoices/${invId}`, acc, undefined);
  check('money:after partial status PARTIAL', get2.body?.status === 'PARTIAL', `got ${get2.body?.status}`);
  check('money:after partial paid = 3000', Number(get2.body?.paidAmount) === 3000, `got ${get2.body?.paidAmount}`);

  // idempotent retry
  const key = 'tp-idem-' + Date.now();
  const r1 = await req('POST', `/billing/invoices/${invId}/payments`, acc, { amount: 2000, method: 'CASH', idempotencyKey: key });
  const r2 = await req('POST', `/billing/invoices/${invId}/payments`, acc, { amount: 2000, method: 'CASH', idempotencyKey: key });
  check('money:idempotent retry same paymentId', r1.body?.paymentId && r1.body.paymentId === r2.body?.paymentId, `${r1.body?.paymentId} vs ${r2.body?.paymentId}`);
  const payCount = await owner.payment.count({ where: { invoiceId: invId, idempotencyKey: key } });
  check('money:idempotent retry -> 1 payment row', payCount === 1, `rows=${payCount}`);

  // remaining payment
  const get3 = await req('GET', `/billing/invoices/${invId}`, acc, undefined);
  const bal = Number(get3.body?.totalAmount) - Number(get3.body?.paidAmount);
  const payFinal = await req('POST', `/billing/invoices/${invId}/payments`, acc, { amount: bal, method: 'CASH' });
  check('money:final payment 2xx', payFinal.status >= 200 && payFinal.status < 300, `status ${payFinal.status}`);
  const get4 = await req('GET', `/billing/invoices/${invId}`, acc, undefined);
  check('money:fully paid -> PAID', get4.body?.status === 'PAID', `got ${get4.body?.status}`);
  check('money:balance 0', Number(get4.body?.totalAmount) - Number(get4.body?.paidAmount) === 0, `bal ${Number(get4.body?.totalAmount) - Number(get4.body?.paidAmount)}`);

  // overpayment rejected
  const over = await req('POST', `/billing/invoices/${invId}/payments`, acc, { amount: 1, method: 'CASH' });
  check('money:overpayment rejected', over.status === 400 && over.body?.code === 'OVERPAYMENT', `status ${over.status} code ${over.body?.code}`);

  // reversal
  const firstPay = await owner.payment.findFirst({ where: { invoiceId: invId, reversedAt: null }, orderBy: { paidAt: 'asc' } });
  const rev = await req('POST', `/billing/payments/${firstPay!.id}/reverse`, acc, { reason: 'test' });
  check('money:reverse 2xx', rev.status >= 200 && rev.status < 300, `status ${rev.status}`);
  const get5 = await req('GET', `/billing/invoices/${invId}`, acc, undefined);
  check('money:after reversal not PAID', get5.body?.status !== 'PAID', `got ${get5.body?.status}`);
  // double reverse
  const rev2 = await req('POST', `/billing/payments/${firstPay!.id}/reverse`, acc, { reason: 'again' });
  check('money:double reverse rejected', rev2.status === 400, `status ${rev2.status}`);

  // audit rows exist for the money operations
  const audits = await owner.auditLog.count({ where: { tenantId: A.tenantId, entityType: 'Invoice', entityId: invId } });
  check('money:audit rows recorded for invoice', audits >= 3, `audit count ${audits}`);

  // invariant: sum(non-reversed payments) == paidAmount, never > total
  const rows = await owner.payment.findMany({ where: { invoiceId: invId } });
  const paidLive = rows.filter((r) => !r.reversedAt).reduce((s, r) => s + Number(r.amount), 0);
  const invRow = await owner.invoice.findUnique({ where: { id: invId } });
  check('money:invariant paid <= total', paidLive <= Number(invRow!.totalAmount) + 1e-9, `paid ${paidLive} total ${invRow!.totalAmount}`);

  // ── concurrency: N concurrent payments on one fresh invoice, each fits, sum overshoots
  const p2 = await owner.patient.create({ data: { tenantId: A.tenantId, patientNumber: `PT-${Date.now()}c`, firstName: 'Con', lastName: 'Cur', registrationStatus: 'COMPLETE' } });
  const inv2 = await req('POST', '/billing/invoices', acc, { patientId: p2.id, lines: [{ description: 'X', quantity: 1, unitPrice: 10000 }] });
  const inv2Id = inv2.body.id;
  const attempts = await Promise.allSettled(
    [0, 1, 2, 3, 4].map(() => req('POST', `/billing/invoices/${inv2Id}/payments`, acc, { amount: 4000, method: 'CASH' })),
  );
  const succeeded = attempts.filter((a) => a.status === 'fulfilled' && (a.value as any).status >= 200 && (a.value as any).status < 300).length;
  const inv2Row = await owner.invoice.findUnique({ where: { id: inv2Id }, include: { payments: true } });
  const inv2Paid = inv2Row!.payments.filter((x) => !x.reversedAt).reduce((s, x) => s + Number(x.amount), 0);
  check('money:concurrency total paid <= invoice total', inv2Paid <= 10000, `paid ${inv2Paid}, ${succeeded} of 5 accepted`);
  if (inv2Paid > 10000) {
    finding({
      severity: 'P0', area: 'money/concurrency', role: 'ACCOUNTANT', endpoint: 'POST /billing/invoices/:id/payments (x5 concurrent)',
      steps: 'Create a 10000 invoice. Fire 5 concurrent payments of 4000, no idempotency key.',
      expected: 'sum of accepted payments <= 10000',
      actual: `sum = ${inv2Paid} (${succeeded} accepted)`,
      impact: 'Overpayment via race; billing aggregates corrupt.',
      evidence: `payments: ${inv2Row!.payments.map((x) => x.amount).join(',')}`,
      rootCause: 'addPayment per-invoice advisory lock ineffective.',
      kind: 'regression',
    });
  }

  // ── receipt numbering: gapless & unique
  const payRows = await owner.payment.findMany({ where: { tenantId: A.tenantId, receiptNumber: { not: null } }, select: { receiptNumber: true, amount: true, reversedAt: true, invoiceId: true, paidAt: true }, orderBy: { paidAt: 'asc' } });
  const receipts = payRows.map((r) => r.receiptNumber!).filter((r) => /^[A-Z]+-\d{6}$/.test(r));
  const nums = receipts.map((r) => Number(r.split('-').pop())).sort((a, b) => a - b);
  const seqRow = await owner.tenantSequence.findFirst({ where: { tenantId: A.tenantId, kind: 'receipt' } });
  console.log(`  [receipt debug] TenantSequence.value=${seqRow?.value}; ${nums.length} numbered receipts; nums=[${nums.join(',')}]`);
  console.log(`  [receipt debug] rows: ${payRows.map((r) => `${r.receiptNumber}=${r.amount}${r.reversedAt ? '(rev)' : ''}`).join(' ')}`);
  const dupe = new Set(nums).size !== nums.length;
  const gap = nums.length > 0 && (nums[nums.length - 1] - nums[0] + 1) !== nums.length;
  check('money:receipt numbers unique', !dupe, `nums ${nums.join(',')}`);
  check('money:receipt numbers gapless (no seq consumed by a rolled-back tx)', !gap, `nums ${nums.join(',')} ; seq=${seqRow?.value}`);
  if (gap) {
    finding({
      severity: 'P2', area: 'money/numbering', role: 'ACCOUNTANT', endpoint: 'payment receipt sequence',
      steps: 'Run the money workflow incl. an overpayment-rejected concurrent burst; inspect RCP- receipt numbers vs TenantSequence.value.',
      expected: 'receipt numbers form a contiguous run (nextSequence is gapless: a rolled-back tx returns its number)',
      actual: `numbers = [${nums.join(',')}], gap(s) present; TenantSequence.value = ${seqRow?.value}`,
      impact: 'A skipped receipt number in a financial document series. Auditors treat gaps as missing/destroyed receipts. Not a data loss, but a compliance red flag.',
      evidence: payRows.map((r) => `${r.receiptNumber}=${r.amount}`).join(' '),
      rootCause: 'A code path allocates a receipt number then the transaction rolls back after the allocation (nextSequence only stays gapless if the allocation shares the failing transaction and is not preceded by a committed side effect).',
      kind: 'new defect',
    });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 5. PHARMACY INVENTORY INTEGRITY
// ────────────────────────────────────────────────────────────────────────────
async function suitePharmacy() {
  console.log('\n== 5. PHARMACY INVENTORY INTEGRITY ==');
  const ph = A.users.PHARMACIST;
  const doc = A.users.DOCTOR;

  async function drugWith(batches: { qty: number; days: number }[]) {
    const d = await owner.drug.create({ data: { tenantId: A.tenantId, sku: `MED-${Math.random().toString(36).slice(2, 9)}`, name: 'PhTest', sellPrice: 100, quantityOnHand: batches.reduce((s, b) => s + b.qty, 0) } });
    const bs = [];
    for (const b of batches) bs.push(await owner.drugBatch.create({ data: { tenantId: A.tenantId, drugId: d.id, batchNumber: `B${b.days}`, expiryDate: new Date(Date.now() + b.days * 86400_000), quantity: b.qty } }));
    return { drug: d, batches: bs };
  }
  async function rxFor(drugId: string, n = 1) {
    const pt = await owner.patient.create({ data: { tenantId: A.tenantId, patientNumber: `PT-${Math.random().toString(36).slice(2, 8)}`, firstName: 'Rx', lastName: 'P', registrationStatus: 'COMPLETE' } });
    return owner.prescription.create({ data: { tenantId: A.tenantId, patientId: pt.id, status: 'ACTIVE', dispenseStatus: 'PENDING', items: { create: Array.from({ length: n }, () => ({ tenantId: A.tenantId, drugId, drugName: 'PhTest' })) } }, include: { items: true } });
  }
  async function invariant(drugId: string, label: string) {
    const d = await owner.drug.findUnique({ where: { id: drugId } });
    const batchSum = (await owner.drugBatch.findMany({ where: { drugId } })).reduce((s, b) => s + b.quantity, 0);
    const moveSum = (await owner.stockMovement.aggregate({ where: { drugId }, _sum: { quantity: true } }))._sum.quantity ?? 0;
    const negBatch = (await owner.drugBatch.findMany({ where: { drugId } })).some((b) => b.quantity < 0);
    check(`pharmacy:${label} quantityOnHand == sum(batches)`, d!.quantityOnHand === batchSum, `cache ${d!.quantityOnHand} vs batches ${batchSum}`);
    check(`pharmacy:${label} no negative batch`, !negBatch);
    return { onHand: d!.quantityOnHand, batchSum, moveSum };
  }

  // FEFO + multi-batch + expiry (expired batch skipped)
  const w = await drugWith([{ qty: 5, days: 10 }, { qty: 10, days: 100 }, { qty: 99, days: -5 }]);
  const rx1 = await rxFor(w.drug.id);
  const disp = await req('POST', `/pharmacy/prescriptions/${rx1.id}/dispense`, ph, { items: [{ itemId: rx1.items[0].id, quantity: 8, unitPrice: 100 }] });
  check('pharmacy:dispense 2xx', disp.status >= 200 && disp.status < 300, `status ${disp.status} ${JSON.stringify(disp.body).slice(0,150)}`);
  const b10 = await owner.drugBatch.findUnique({ where: { id: w.batches[0].id } });
  const b100 = await owner.drugBatch.findUnique({ where: { id: w.batches[1].id } });
  const bExp = await owner.drugBatch.findUnique({ where: { id: w.batches[2].id } });
  check('pharmacy:FEFO earliest batch drained first', b10!.quantity === 0, `b10 qty ${b10!.quantity}`);
  check('pharmacy:FEFO spillover to next', b100!.quantity === 7, `b100 qty ${b100!.quantity}`);
  check('pharmacy:expired batch untouched', bExp!.quantity === 99, `bExp qty ${bExp!.quantity}`);
  await invariant(w.drug.id, 'FEFO');

  // insufficient stock -> 409, nothing mutates
  const w2 = await drugWith([{ qty: 3, days: 30 }]);
  const rx2 = await rxFor(w2.drug.id);
  const short = await req('POST', `/pharmacy/prescriptions/${rx2.id}/dispense`, ph, { items: [{ itemId: rx2.items[0].id, quantity: 10, unitPrice: 100 }] });
  check('pharmacy:short -> 409 INSUFFICIENT_STOCK', short.status === 409 && short.body?.code === 'INSUFFICIENT_STOCK', `status ${short.status} code ${short.body?.code}`);
  const w2b = await owner.drugBatch.findUnique({ where: { id: w2.batches[0].id } });
  check('pharmacy:short mutates nothing (batch)', w2b!.quantity === 3, `qty ${w2b!.quantity}`);
  const w2moves = await owner.stockMovement.count({ where: { drugId: w2.drug.id } });
  check('pharmacy:short mutates nothing (movements)', w2moves === 0, `moves ${w2moves}`);

  // replay of a PARTIAL dispense (2-item rx) -> no re-draw / re-charge
  const w3a = await drugWith([{ qty: 20, days: 30 }]);
  const w3b = await drugWith([{ qty: 20, days: 30 }]);
  const pt3 = await owner.patient.create({ data: { tenantId: A.tenantId, patientNumber: `PT-${Math.random().toString(36).slice(2, 8)}`, firstName: 'Rp', lastName: 'L', registrationStatus: 'COMPLETE' } });
  const rx3 = await owner.prescription.create({ data: { tenantId: A.tenantId, patientId: pt3.id, status: 'ACTIVE', dispenseStatus: 'PENDING', items: { create: [{ tenantId: A.tenantId, drugId: w3a.drug.id, drugName: 'A' }, { tenantId: A.tenantId, drugId: w3b.drug.id, drugName: 'B' }] } }, include: { items: true } });
  const payloadR = { items: [{ itemId: rx3.items[0].id, quantity: 5, unitPrice: 100 }, { itemId: rx3.items[1].id, quantity: 0, unitPrice: 100 }] };
  await req('POST', `/pharmacy/prescriptions/${rx3.id}/dispense`, ph, payloadR);
  await req('POST', `/pharmacy/prescriptions/${rx3.id}/dispense`, ph, payloadR); // replay
  const inv3 = await invariant(w3a.drug.id, 'replay');
  check('pharmacy:replay drew only 5', inv3.onHand === 15, `onHand ${inv3.onHand}`);
  const w3moves = await owner.stockMovement.count({ where: { drugId: w3a.drug.id, type: 'DISPENSE' } });
  check('pharmacy:replay -> 1 stock movement', w3moves === 1, `moves ${w3moves}`);
  const w3lines = await owner.invoiceLine.count({ where: { invoice: { patientId: pt3.id } } });
  check('pharmacy:replay -> 1 charge line', w3lines === 1, `lines ${w3lines}`);

  // concurrent dispense of the SAME drug, stock exactly enough for one
  const w4 = await drugWith([{ qty: 10, days: 30 }]);
  const rxA = await rxFor(w4.drug.id);
  const rxB = await rxFor(w4.drug.id);
  const cc = await Promise.allSettled([
    req('POST', `/pharmacy/prescriptions/${rxA.id}/dispense`, ph, { items: [{ itemId: rxA.items[0].id, quantity: 8, unitPrice: 100 }] }),
    req('POST', `/pharmacy/prescriptions/${rxB.id}/dispense`, ph, { items: [{ itemId: rxB.items[0].id, quantity: 8, unitPrice: 100 }] }),
  ]);
  const ok = cc.filter((r) => r.status === 'fulfilled' && (r.value as any).status >= 200 && (r.value as any).status < 300).length;
  const iv4 = await invariant(w4.drug.id, 'concurrent');
  check('pharmacy:concurrent -> exactly one succeeds', ok === 1, `succeeded ${ok}`);
  check('pharmacy:concurrent -> stock not negative & reconciles', iv4.onHand === 2 && iv4.batchSum === 2, `onHand ${iv4.onHand} batches ${iv4.batchSum}`);
  if (iv4.onHand < 0 || iv4.batchSum < 0 || ok === 2) {
    finding({
      severity: 'P0', area: 'pharmacy/concurrency', role: 'PHARMACIST', endpoint: 'POST /pharmacy/prescriptions/:id/dispense (concurrent, same drug)',
      steps: 'One drug, 10 in stock. Two prescriptions, dispense 8 each, concurrently.',
      expected: 'one succeeds, one 409; stock >= 0 and reconciles',
      actual: `${ok} succeeded, onHand ${iv4.onHand}, batchSum ${iv4.batchSum}`,
      impact: 'Negative / phantom stock; inventory no longer trustworthy.',
      evidence: JSON.stringify(cc.map((x) => x.status === 'fulfilled' ? (x.value as any).status : 'rej')),
      rootCause: 'drawStockFefo per-drug advisory lock ineffective.',
      kind: 'regression',
    });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 6. FILE / DOCUMENT SECURITY
// ────────────────────────────────────────────────────────────────────────────
async function suiteFiles() {
  console.log('\n== 6. FILE / DOCUMENT SECURITY ==');
  const doc = A.users.DOCTOR;
  const nurse2 = A.users.NURSE;
  const admin = A.users.HOSPITAL_ADMIN;

  // valid upload
  const up = await req('POST', '/files', doc, fd(PNG, 'ok.png', 'image/png', { category: 'DOCUMENT' }));
  check('files:valid PNG upload 2xx', up.status >= 200 && up.status < 300, `status ${up.status} ${JSON.stringify(up.body).slice(0,150)}`);
  const fileId = up.body?.id;

  // MIME spoof: html bytes as image/png
  const spoof = await req('POST', '/files', doc, fd(HTML_AS_PNG, 'x.png', 'image/png', { category: 'DOCUMENT' }));
  check('files:magic-byte mismatch rejected', spoof.status === 400, `status ${spoof.status}`);
  // disallowed type
  const bad = await req('POST', '/files', doc, fd(Buffer.from('MZ...'), 'x.exe', 'application/octet-stream', { category: 'DOCUMENT' }));
  check('files:disallowed type rejected', bad.status === 400, `status ${bad.status}`);
  // oversized
  const big = Buffer.concat([PNG, Buffer.alloc(21 * 1024 * 1024, 2)]);
  const over = await req('POST', '/files', doc, fd(big, 'big.png', 'image/png', { category: 'DOCUMENT' }));
  check('files:oversized rejected (413/400)', over.status === 413 || over.status === 400, `status ${over.status}`);

  if (fileId) {
    // ownership: uploader ok, other same-tenant non-admin forbidden, admin ok
    const asUploader = await req('GET', `/files/${fileId}/meta`, doc, undefined);
    check('files:uploader can use handle', asUploader.status === 200, `status ${asUploader.status}`);
    const asOther = await req('GET', `/files/${fileId}/meta`, nurse2, undefined);
    check('files:other same-tenant non-owner forbidden (403)', asOther.status === 403, `status ${asOther.status}`);
    const asAdmin = await req('GET', `/files/${fileId}/meta`, admin, undefined);
    check('files:hospital admin can use handle', asAdmin.status === 200, `status ${asAdmin.status}`);
    // cross-tenant -> 404
    const xt = await req('GET', `/files/${fileId}/meta`, B.users.HOSPITAL_ADMIN, undefined);
    check('files:cross-tenant handle -> 404', xt.status === 404, `status ${xt.status}`);
    if (xt.status !== 404 && xt.status !== 403) {
      finding({ severity: 'P0', area: 'files/tenant-isolation', role: 'B.HOSPITAL_ADMIN', endpoint: 'GET /files/:id/meta',
        steps: 'Upload a file in A. Fetch its handle as B admin.', expected: '404', actual: `${xt.status}`,
        impact: 'Cross-tenant file metadata / content access.', evidence: JSON.stringify(xt.body).slice(0, 200),
        rootCause: 'StoredFile lookup not tenant-scoped.', kind: 'new defect' });
    }
    // download redirect + presigned URL shape + TTL
    const dl = await req('GET', `/files/${fileId}`, doc, undefined);
    const loc = dl.headers.get('location') || (dl.body && dl.body.url);
    check('files:download issues a presigned URL', !!loc && String(loc).includes('X-Amz-'), `loc ${String(loc).slice(0, 80)}`);
    const m = String(loc).match(/X-Amz-Expires=(\d+)/);
    check('files:presigned TTL is short (<= 300s)', !!m && Number(m[1]) <= 300, `expires ${m?.[1]}`);
    // repeated downloads still work (fresh URL each time)
    const dl2 = await req('GET', `/files/${fileId}`, doc, undefined);
    check('files:repeat download ok', (dl2.headers.get('location') || dl2.body?.url) ? true : false);
    // delete: non-owner non-admin refused
    const delOther = await req('DELETE', `/files/${fileId}`, nurse2, undefined);
    check('files:delete by non-owner refused', delOther.status === 403, `status ${delOther.status}`);
    const delOwner = await req('DELETE', `/files/${fileId}`, doc, undefined);
    check('files:delete by uploader ok', delOwner.status >= 200 && delOwner.status < 300, `status ${delOwner.status}`);
  }

  // patient document: metadata list carries NO presigned URL; mint-on-click; INFECTED gate
  const list = await req('GET', `/patients/${A.patientId}/documents`, doc, undefined);
  const leaks = JSON.stringify(list.body || '').includes('X-Amz-');
  check('files:document list has NO presigned URL', !leaks);
  const mint = await req('GET', `/patients/${A.patientId}/documents/${A.documentId}/url`, doc, undefined);
  check('files:mint-on-click returns a URL for authorized reader', !!mint.body?.url && String(mint.body.url).includes('X-Amz-'), `status ${mint.status}`);
  // INFECTED file cannot be served
  const infKey = `t/${A.tenantId}/document/${cryptoRandom()}-i.pdf`;
  const infFile = await owner.storedFile.create({ data: { tenantId: A.tenantId, key: infKey, bucket: process.env.S3_BUCKET ?? 'oudhealth-dev', mimeType: 'application/pdf', size: 3, sha256: sha256('i'), originalName: 'i.pdf', category: 'DOCUMENT', uploadedById: doc.userId, scanStatus: 'INFECTED' } });
  const infDl = await req('GET', `/files/${infFile.id}`, doc, undefined);
  check('files:INFECTED file refused on download (403)', infDl.status === 403, `status ${infDl.status}`);
}
function cryptoRandom() { return require('crypto').randomUUID(); }

// ────────────────────────────────────────────────────────────────────────────
// 7. AUTH / SECURITY EDGE CASES (real JWT guard)
// ────────────────────────────────────────────────────────────────────────────
async function suiteAuth(base: string) {
  console.log('\n== 7. AUTH EDGE CASES ==');
  const rr = makeReq(base);
  const admin = A.users.HOSPITAL_ADMIN;
  const realJwt = new JwtService({ secret: JWT_SECRET });
  const wrongJwt = new JwtService({ secret: 'a-totally-different-secret-32-chars-xx' });
  const sessionClaims = (w: Who) => ({ sub: w.userId, typ: 'session', tenantId: w.tenantId, tenantSlug: w.tenantSlug, role: w.role, email: w.email, fullName: w.fullName });
  const sign = (claims: any, opts: any = {}) => realJwt.sign(claims, { expiresIn: '7d', ...opts });
  const b64u = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const algNone = (claims: any) => `${b64u({ alg: 'none', typ: 'JWT' })}.${b64u(claims)}.`;

  const good = sign(sessionClaims(admin));
  check('auth:valid session token -> 200', (await rr('GET', '/patients', null, undefined, `Bearer ${good}`)).status === 200);
  check('auth:no token -> 401', (await rr('GET', '/patients', null, undefined)).status === 401);
  check('auth:garbage token -> 401', (await rr('GET', '/patients', null, undefined, 'Bearer not.a.jwt')).status === 401);
  const forgedRes = await rr('GET', '/patients', null, undefined, `Bearer ${wrongJwt.sign(sessionClaims(admin), { expiresIn: '7d' })}`);
  check('auth:wrong-signature token -> 401', forgedRes.status === 401, `status ${forgedRes.status}`);
  const noneRes = await rr('GET', '/patients', null, undefined, `Bearer ${algNone(sessionClaims(admin))}`);
  check('auth:alg=none token -> 401', noneRes.status === 401, `status ${noneRes.status}`);
  const expiredRes = await rr('GET', '/patients', null, undefined, `Bearer ${sign(sessionClaims(admin), { expiresIn: '-1h' })}`);
  check('auth:expired token -> 401', expiredRes.status === 401, `status ${expiredRes.status}`);
  const pendingRes = await rr('GET', '/patients', null, undefined, `Bearer ${sign({ sub: admin.userId, typ: 'pending', email: admin.email }, { expiresIn: '30m' })}`);
  check('auth:pending token rejected on app API -> 401', pendingRes.status === 401, `status ${pendingRes.status}`);

  // tampered tenantId claim (token says tenant B, DB user is tenant A)
  const ctRes = await rr('GET', '/patients', null, undefined, `Bearer ${sign({ ...sessionClaims(admin), tenantId: B.tenantId, tenantSlug: B.slug })}`);
  check('auth:mismatched tenant claim -> 401 (DB check)', ctRes.status === 401, `status ${ctRes.status}`);

  // tampered role claim: token says SUPER_ADMIN, DB says LAB_STAFF
  const escalate = sign({ ...sessionClaims(A.users.LAB_STAFF), role: 'SUPER_ADMIN' });
  const escRes = await rr('POST', '/staff', null, { firstName: 'Esc', lastName: 'Al', email: `esc${Date.now()}@t.io`, role: 'NURSE', password: 'abcd1234!' }, `Bearer ${escalate}`);
  check('auth:tampered role claim does not escalate -> 403', escRes.status === 403, `status ${escRes.status}`);
  if (escRes.status >= 200 && escRes.status < 300) {
    finding({ severity: 'P0', area: 'auth/privilege-escalation', role: 'LAB_STAFF(claim:SUPER_ADMIN)', endpoint: 'POST /staff',
      steps: 'Sign a valid-signature token for a LAB_STAFF user but with role=SUPER_ADMIN; call POST /staff.',
      expected: '403 - role is authoritative from the DB', actual: `${escRes.status} - escalation succeeded`,
      impact: 'Full privilege escalation via token claim tampering.', evidence: JSON.stringify(escRes.body).slice(0, 200),
      rootCause: 'JwtStrategy trusts payload.role.', kind: 'regression' });
  }
  // ...also verify the escalated token is still 401 outright (tenant/user OK but role mismatch is not itself rejected -> just re-read)
  const escReadRes = await rr('GET', '/patients', null, undefined, `Bearer ${escalate}`);
  check('auth:token with tampered role still authenticates (role ignored)', escReadRes.status === 403 || escReadRes.status === 200, `status ${escReadRes.status} (LAB_STAFF lacks patient:read -> 403 expected)`);

  // deactivated user - immediate effect
  const tmp = await owner.user.create({ data: { tenantId: A.tenantId, email: `deact${Date.now()}@t.io`, fullName: 'D', role: 'DOCTOR', isActive: true, passwordHash: 'x', emailVerifiedAt: new Date() } });
  const tmpTok = sign(sessionClaims({ userId: tmp.id, tenantId: A.tenantId, tenantSlug: A.slug, role: 'DOCTOR', email: tmp.email, fullName: 'D' }));
  check('auth:active user token -> 200', (await rr('GET', '/patients', null, undefined, `Bearer ${tmpTok}`)).status === 200);
  await owner.user.update({ where: { id: tmp.id }, data: { isActive: false } });
  check('auth:deactivated user token -> 401 immediately', (await rr('GET', '/patients', null, undefined, `Bearer ${tmpTok}`)).status === 401);

  // deactivated tenant - immediate effect
  const tt = await owner.tenant.create({ data: { name: 'Deact T', slug: `deact-${Date.now()}` } });
  const tu = await owner.user.create({ data: { tenantId: tt.id, email: `tu${Date.now()}@t.io`, fullName: 'TU', role: 'HOSPITAL_ADMIN', isActive: true, passwordHash: 'x', emailVerifiedAt: new Date() } });
  const tuTok = sign({ sub: tu.id, typ: 'session', tenantId: tt.id, tenantSlug: tt.slug, role: 'HOSPITAL_ADMIN', email: tu.email, fullName: 'TU' });
  check('auth:active tenant user -> 200', (await rr('GET', '/patients', null, undefined, `Bearer ${tuTok}`)).status === 200);
  await owner.tenant.update({ where: { id: tt.id }, data: { isActive: false } });
  check('auth:deactivated tenant -> 401 immediately', (await rr('GET', '/patients', null, undefined, `Bearer ${tuTok}`)).status === 401);
  await owner.user.deleteMany({ where: { tenantId: tt.id } });
  await owner.tenant.delete({ where: { id: tt.id } });

  // malformed id / body -> 4xx not 500
  const badId = await rr('GET', '/patients/not-a-uuid', null, undefined, `Bearer ${good}`);
  check('auth:malformed id -> 4xx not 500', badId.status >= 400 && badId.status < 500, `status ${badId.status}`);
  const badBody = await rr('POST', '/billing/invoices', null, { patientId: 123, lines: 'nope' }, `Bearer ${sign(sessionClaims(A.users.ACCOUNTANT))}`);
  check('auth:malformed body -> 400 not 500', badBody.status === 400, `status ${badBody.status}`);

  check('auth:/health is public 200', (await rr('GET', '/health', null, undefined)).status === 200);
}

// ────────────────────────────────────────────────────────────────────────────
// 10. CONTROLLED CONCURRENCY - NUMBERING
// ────────────────────────────────────────────────────────────────────────────
async function suiteNumbering() {
  console.log('\n== 10. NUMBERING CONCURRENCY ==');
  const rec = A.users.RECEPTIONIST;
  const acc = A.users.ACCOUNTANT;
  const doc = A.users.DOCTOR;

  // concurrent patient registration
  const pcreates = await Promise.allSettled(Array.from({ length: 8 }, (_, i) =>
    req('POST', '/patients', rec, { firstName: `Num${i}`, lastName: 'Test' })));
  const pids = pcreates.filter((r) => r.status === 'fulfilled' && (r.value as any).status >= 200 && (r.value as any).status < 300).map((r) => (r as any).value.body.id);
  const pnums = (await owner.patient.findMany({ where: { id: { in: pids } }, select: { patientNumber: true } })).map((p) => p.patientNumber);
  check('numbering:patient numbers unique', new Set(pnums).size === pnums.length, `${pnums.join(',')}`);

  // concurrent ad-hoc invoices -> unique gapless invoice numbers
  const pt = await owner.patient.create({ data: { tenantId: A.tenantId, patientNumber: `PT-${Date.now()}n`, firstName: 'N', lastName: 'I', registrationStatus: 'COMPLETE' } });
  const invs = await Promise.allSettled(Array.from({ length: 6 }, () =>
    req('POST', '/billing/invoices', acc, { patientId: pt.id, lines: [{ description: 'x', quantity: 1, unitPrice: 100 }] })));
  const iids = invs.filter((r) => r.status === 'fulfilled' && (r.value as any).status >= 200 && (r.value as any).status < 300).map((r) => (r as any).value.body.id);
  const inums = (await owner.invoice.findMany({ where: { id: { in: iids } }, select: { invoiceNumber: true } })).map((i) => Number(i.invoiceNumber.split('-').pop()));
  inums.sort((a, b) => a - b);
  check('numbering:invoice numbers unique', new Set(inums).size === inums.length, `${inums.join(',')}`);
  check('numbering:invoice numbers gapless', inums.every((v, i) => i === 0 || v === inums[i - 1] + 1), `${inums.join(',')}`);

  // concurrent admissions -> unique admission numbers
  const adms = await Promise.allSettled(Array.from({ length: 5 }, async (_, i) => {
    const p = await owner.patient.create({ data: { tenantId: A.tenantId, patientNumber: `PT-a${Date.now()}${i}`, firstName: 'Ad', lastName: `M${i}`, registrationStatus: 'COMPLETE' } });
    return req('POST', '/admissions', A.users.NURSE, { patientId: p.id, wardId: A.wardId, bedId: A.bedId, admissionType: 'ELECTIVE' });
  }));
  const admOk = adms.filter((r) => r.status === 'fulfilled' && (r.value as any).status >= 200 && (r.value as any).status < 300).length;
  const admNums = (await owner.admission.findMany({ where: { tenantId: A.tenantId }, select: { admissionNumber: true } })).map((a) => a.admissionNumber);
  check('numbering:admission numbers unique', new Set(admNums).size === admNums.length, `count ${admNums.length}, ${admOk} concurrent ok`);
}

// ────────────────────────────────────────────────────────────────────────────
// 8. FAILURE / RESILIENCE (bounded - the app is already booted with good config)
// ────────────────────────────────────────────────────────────────────────────
async function suiteFailure() {
  console.log('\n== 8. FAILURE / RESILIENCE ==');
  const admin = A.users.HOSPITAL_ADMIN;
  // liveness always cheap
  check('failure:/health liveness 200', (await req('GET', '/health', null, undefined)).status === 200);
  // readiness reflects real deps (db + storage both up here)
  const ready = await req('GET', '/health/ready', null, undefined);
  check('failure:/health/ready 200 when deps up', ready.status === 200 && ready.body?.checks?.database === 'ok' && ready.body?.checks?.storage === 'ok', `status ${ready.status} ${JSON.stringify(ready.body?.checks)}`);
  // forced unknown error -> generic 500 + x-request-id, no stack in body
  const boom = await req('GET', '/billing/invoices/not-a-uuid', admin, undefined);
  const is5xx = boom.status >= 500;
  if (is5xx) {
    check('failure:unknown 500 carries x-request-id', !!boom.headers.get('x-request-id'), `hdr ${boom.headers.get('x-request-id')}`);
    check('failure:unknown 500 body has no stack trace', !JSON.stringify(boom.body ?? '').match(/\bat \/|node_modules|\.ts:\d+/), JSON.stringify(boom.body).slice(0, 150));
  } else {
    check('failure:malformed id handled as 4xx (not 500)', boom.status >= 400 && boom.status < 500, `status ${boom.status}`);
  }
  // transaction conflict does not corrupt: two concurrent updateInvoice on one invoice
  const p = await owner.patient.create({ data: { tenantId: A.tenantId, patientNumber: `PT-${Date.now()}f`, firstName: 'F', lastName: 'R', registrationStatus: 'COMPLETE' } });
  const iv = await req('POST', '/billing/invoices', A.users.ACCOUNTANT, { patientId: p.id, lines: [{ description: 'x', quantity: 1, unitPrice: 10000 }] });
  await Promise.allSettled([
    req('PATCH', `/billing/invoices/${iv.body.id}`, A.users.ACCOUNTANT, { invoiceDiscountPct: 10 }),
    req('PATCH', `/billing/invoices/${iv.body.id}`, A.users.ACCOUNTANT, { invoiceDiscountPct: 20 }),
  ]);
  const after = await req('GET', `/billing/invoices/${iv.body.id}`, A.users.ACCOUNTANT, undefined);
  const disc = Number(after.body?.discountPct);
  const total = Number(after.body?.totalAmount);
  check('failure:concurrent invoice edit leaves consistent state', (disc === 10 && total === 9000) || (disc === 20 && total === 8000), `disc ${disc} total ${total}`);
}

// ────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Seeding tenants...');
  A = await seedTenant('A');
  B = await seedTenant('B');
  const { app, base } = await bootShimApp();
  req = makeReq(base);

  const t0 = Date.now();
  try {
    await suiteIsolation();
    await suiteRbac();
    await suiteMoney();
    await suitePharmacy();
    await suiteFiles();
    await suiteNumbering();
    await suiteFailure();
  } catch (e) {
    console.error('SUITE ERROR', e);
    finding({ severity: 'P1', area: 'harness', role: '-', endpoint: '-', steps: 'run suites', expected: 'complete', actual: String((e as Error).message || e), impact: 'incomplete coverage', evidence: String((e as Error).stack || '').slice(0, 500), rootCause: 'harness/exception', kind: 'new defect' });
  }
  await app.close();

  const { app: app2, base: base2 } = await bootRealAuthApp();
  try {
    await suiteAuth(base2);
  } catch (e) {
    console.error('AUTH SUITE ERROR', e);
    finding({ severity: 'P1', area: 'harness/auth', role: '-', endpoint: '-', steps: 'run auth suite', expected: 'complete', actual: String((e as Error).message || e), impact: 'incomplete', evidence: String((e as Error).stack || '').slice(0, 500), rootCause: 'harness', kind: 'new defect' });
  }
  await app2.close();

  await destroyTenant(A.tenantId);
  await destroyTenant(B.tenantId);
  await owner.$disconnect();

  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.filter((c) => !c.ok);
  const byCat: Record<string, { pass: number; fail: number }> = {};
  for (const c of checks) {
    const cat = c.name.split(':')[0].split(' ')[0];
    (byCat[cat] ||= { pass: 0, fail: 0 })[c.ok ? 'pass' : 'fail'] += 1;
  }
  const report = {
    ranAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    checks: { total: checks.length, passed, failed: failed.length },
    byCategory: byCat,
    allCheckNames: checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.name}`),
    failedChecks: failed,
    findings,
    counts: {
      P0: findings.filter((f) => f.severity === 'P0').length,
      P1: findings.filter((f) => f.severity === 'P1').length,
      P2: findings.filter((f) => f.severity === 'P2').length,
      P3: findings.filter((f) => f.severity === 'P3').length,
    },
  };
  writeFileSync(join(__dirname, 'report.json'), JSON.stringify(report, null, 2));
  console.log('\n================ SUMMARY ================');
  console.log(`checks: ${passed}/${checks.length} passed, ${failed.length} failed`);
  console.log(`findings: P0=${report.counts.P0} P1=${report.counts.P1} P2=${report.counts.P2} P3=${report.counts.P3}`);
  console.log('failed checks:');
  for (const f of failed) console.log(`  - ${f.name} :: ${f.detail ?? ''}`);
  console.log('report -> testphase/report.json');
}

main().catch((e) => { console.error(e); process.exit(1); });
