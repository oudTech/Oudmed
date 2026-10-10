import { INestApplication, ValidationPipe, ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../common/audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { BillingModule } from '../billing/billing.module';
import { BillingService } from '../billing/billing.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdmissionsModule } from './admissions.module';
import { AdmissionsService } from './admissions.service';
import { actorFor, destroyTenant, makePatient, makeTenant, makeUser, ownerPrisma } from '../../test/int-helpers';

/**
 * The billing-focused admissions overview (`GET /admissions/billing-overview`)
 * exists so a billing:manage role without patient:read - Accountant - can
 * find an admission to take a deposit against, without the full inpatient
 * workspace. Two concerns: the numbers match `bill()`'s own math, and the
 * route is reachable on billing:manage alone, unlike every other admission
 * read.
 */
describe('AdmissionsService.listForBilling (integration)', () => {
  let prisma: PrismaService;
  let admissions: AdmissionsService;
  let billing: BillingService;
  let tenantId: string;
  let nurseActor: { tenantId: string; userId: string; role: string };
  let receptionActor: { tenantId: string; userId: string; role: string };
  let accountantActor: { tenantId: string; userId: string; role: string };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, StorageModule, BillingModule, AdmissionsModule],
    }).compile();
    prisma = mod.get(PrismaService);
    admissions = mod.get(AdmissionsService);
    billing = mod.get(BillingService);

    const tenant = await makeTenant();
    tenantId = tenant.id;
    await ownerPrisma.tenant.update({ where: { id: tenant.id }, data: { shortStayChargeMode: 'NONE' } });
    nurseActor = actorFor(tenantId, (await makeUser(tenantId, 'NURSE')).id, 'NURSE');
    receptionActor = actorFor(tenantId, (await makeUser(tenantId, 'RECEPTIONIST')).id, 'RECEPTIONIST');
    accountantActor = actorFor(tenantId, (await makeUser(tenantId, 'ACCOUNTANT')).id, 'ACCOUNTANT');
  });

  afterAll(async () => {
    await destroyTenant(tenantId);
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  async function makeWard() {
    const ward = await ownerPrisma.ward.create({
      data: { tenantId, name: `Ward ${Math.random().toString(36).slice(2, 8)}`, wardType: 'GENERAL', dailyRate: 15000 },
    });
    const bed = await ownerPrisma.bed.create({ data: { tenantId, wardId: ward.id, label: 'A1' } });
    return { ward, bed };
  }

  it('reports the same totalDeposited/balance as bill()', async () => {
    const { ward, bed } = await makeWard();
    const patient = await makePatient(tenantId);
    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);
    await prisma.forTenant(tenantId, (tx) =>
      billing.postCharge(tx, {
        tenantId, userId: nurseActor.userId, admissionId: admission.id, patientId: patient.id,
        description: 'Ward charge', quantity: 1, unitPrice: 30000, category: 'Inpatient',
      }),
    );
    await admissions.addDeposit(receptionActor, admission.id, { amount: 10000, method: 'CASH' } as any);

    const overview = await admissions.listForBilling(tenantId);
    const row = overview.find((a) => a.id === admission.id);
    expect(row).toBeDefined();
    expect(row!.totalDeposited).toBe('10000');
    expect(row!.balance).toBe('20000');
    expect(row!.deposits).toHaveLength(1);
    expect(row!.deposits[0].remaining).toBe('10000');

    const direct = await admissions.bill(tenantId, admission.id);
    expect(row!.totalDeposited).toBe(direct.totalDeposited);
    expect(row!.balance).toBe(direct.balance);
  });

  it('a manual deposit refund (the ad-hoc "Refund" action, not discharge) is reflected immediately, and the deposit drops off once fully refunded', async () => {
    const { ward, bed } = await makeWard();
    const patient = await makePatient(tenantId);
    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);
    await prisma.forTenant(tenantId, (tx) =>
      billing.postCharge(tx, {
        tenantId, userId: nurseActor.userId, admissionId: admission.id, patientId: patient.id,
        description: 'Ward charge', quantity: 1, unitPrice: 5000, category: 'Inpatient',
      }),
    );
    const deposit = await admissions.addDeposit(receptionActor, admission.id, { amount: 20000, method: 'CASH' } as any);
    await admissions.refundDeposit(accountantActor, admission.id, (deposit as any).id, { amount: 15000, reason: 'overpaid' } as any);

    const overview = await admissions.listForBilling(tenantId);
    const row = overview.find((a) => a.id === admission.id)!;
    // 20000 deposited - 15000 refunded = 5000 still held, which exactly
    // covers the 5000 charge. The remaining 5000 is still a live,
    // refundable deposit line.
    expect(row.totalDeposited).toBe('5000');
    expect(row.balance).toBe('0');
    expect(row.deposits).toEqual([{ id: (deposit as any).id, amount: '20000', remaining: '5000' }]);
  });

  it('a discharged admission does not appear in the default (current) view', async () => {
    const { ward, bed } = await makeWard();
    const patient = await makePatient(tenantId);
    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);
    await admissions.discharge(nurseActor, admission.id, { status: 'DISCHARGED' } as any);

    const overview = await admissions.listForBilling(tenantId, 'current');
    expect(overview.find((a) => a.id === admission.id)).toBeUndefined();
  });

  it('discharged-due: a discharged admission with an unpaid balance appears, with unpaidInvoiceId set, and is absent from the current view', async () => {
    const { ward, bed } = await makeWard();
    const patient = await makePatient(tenantId);
    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);
    await prisma.forTenant(tenantId, (tx) =>
      billing.postCharge(tx, {
        tenantId, userId: nurseActor.userId, admissionId: admission.id, patientId: patient.id,
        description: 'Ward charge', quantity: 1, unitPrice: 30000, category: 'Inpatient',
      }),
    );
    await admissions.discharge(nurseActor, admission.id, { status: 'DISCHARGED' } as any);

    const current = await admissions.listForBilling(tenantId, 'current');
    expect(current.find((a) => a.id === admission.id)).toBeUndefined();

    const due = await admissions.listForBilling(tenantId, 'discharged-due');
    const row = due.find((a) => a.id === admission.id);
    expect(row).toBeDefined();
    expect(row!.balance).toBe('30000');
    expect(row!.unpaidInvoiceId).not.toBeNull();
    expect(row!.pendingRefund).toBeNull();

    const direct = await admissions.bill(tenantId, admission.id);
    expect(direct.invoices.map((i) => i.id)).toContain(row!.unpaidInvoiceId);
  });

  it('discharged-due: a deposit left over at discharge with no refund details creates a PENDING refund that shows here; paying it out drops the admission off the list', async () => {
    const { ward, bed } = await makeWard();
    const patient = await makePatient(tenantId);
    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);
    await prisma.forTenant(tenantId, (tx) =>
      billing.postCharge(tx, {
        tenantId, userId: nurseActor.userId, admissionId: admission.id, patientId: patient.id,
        description: 'Ward charge', quantity: 1, unitPrice: 10000, category: 'Inpatient',
      }),
    );
    await admissions.addDeposit(receptionActor, admission.id, { amount: 25000, method: 'CASH' } as any);
    // 25000 deposited, 10000 owed - 10000 auto-applied at discharge, 15000
    // left over with no refundMethod given, so it is recorded as a PENDING
    // AdmissionRefund rather than paid out immediately.
    await admissions.discharge(nurseActor, admission.id, { status: 'DISCHARGED' } as any);

    const due = await admissions.listForBilling(tenantId, 'discharged-due');
    const row = due.find((a) => a.id === admission.id);
    expect(row).toBeDefined();
    expect(row!.balance).toBe('0');
    expect(row!.pendingRefund).not.toBeNull();
    expect(row!.pendingRefund!.amount).toBe('15000');

    await admissions.payRefund(accountantActor, admission.id, row!.pendingRefund!.id, { method: 'CASH' } as any);

    const after = await admissions.listForBilling(tenantId, 'discharged-due');
    expect(after.find((a) => a.id === admission.id)).toBeUndefined();
  });

  it('discharged-due: a discharged admission fully settled with nothing owed either way never appears', async () => {
    const { ward, bed } = await makeWard();
    const patient = await makePatient(tenantId);
    const admission = await admissions.admit(nurseActor, {
      patientId: patient.id, wardId: ward.id, bedId: bed.id, admissionType: 'ELECTIVE',
    } as any);
    await prisma.forTenant(tenantId, (tx) =>
      billing.postCharge(tx, {
        tenantId, userId: nurseActor.userId, admissionId: admission.id, patientId: patient.id,
        description: 'Ward charge', quantity: 1, unitPrice: 10000, category: 'Inpatient',
      }),
    );
    // Deposit exactly covers the charge - nothing left over, nothing owed.
    await admissions.addDeposit(receptionActor, admission.id, { amount: 10000, method: 'CASH' } as any);
    await admissions.discharge(nurseActor, admission.id, { status: 'DISCHARGED' } as any);

    const due = await admissions.listForBilling(tenantId, 'discharged-due');
    expect(due.find((a) => a.id === admission.id)).toBeUndefined();
  });
});

const testAuthGuard = {
  canActivate: (ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    const hdr = req.headers['x-test-user'];
    if (!hdr) return false;
    req.user = JSON.parse(Array.isArray(hdr) ? hdr[0] : hdr);
    return true;
  },
};

type Who = { tenantId: string; userId: string; role: string };
const auth = (w: Who) => ({ ...w, tenantSlug: 't', email: `${w.role}@int.test`, fullName: w.role });

describe('GET /admissions/billing-overview authorization (integration - HTTP)', () => {
  let app: INestApplication;
  let base: string;
  let prisma: PrismaService;
  let tenantId: string;
  const who: Record<string, Who> = {};

  const req = (path: string, w: Who) =>
    fetch(`${base}/api${path}`, { headers: { 'x-test-user': JSON.stringify(auth(w)) } });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, StorageModule, BillingModule, AdmissionsModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(testAuthGuard)
      .compile();

    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.listen(0);
    base = await app.getUrl();
    prisma = mod.get(PrismaService);

    tenantId = (await makeTenant()).id;
    for (const role of ['RECEPTIONIST', 'ACCOUNTANT', 'HOSPITAL_ADMIN', 'NURSE', 'DOCTOR', 'LAB_STAFF', 'PHARMACIST']) {
      who[role] = { tenantId, userId: (await makeUser(tenantId, role)).id, role };
    }
  });

  afterAll(async () => {
    await app.close();
    await destroyTenant(tenantId);
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  it.each(['RECEPTIONIST', 'ACCOUNTANT', 'HOSPITAL_ADMIN'])('%s (billing:manage) may read (200)', async (role) => {
    expect((await req('/admissions/billing-overview', who[role])).status).toBe(200);
  });

  // The whole point of this route: Accountant has billing:manage but not
  // patient:read, so the plain /admissions list stays forbidden for them
  // while the billing-overview one does not.
  it('ACCOUNTANT is forbidden on the clinical admissions list, but allowed on the billing overview', async () => {
    expect((await req('/admissions', who.ACCOUNTANT)).status).toBe(403);
    expect((await req('/admissions/billing-overview', who.ACCOUNTANT)).status).toBe(200);
  });

  it.each(['NURSE', 'DOCTOR', 'LAB_STAFF', 'PHARMACIST'])('%s (no billing:manage) is forbidden (403)', async (role) => {
    const res = await req('/admissions/billing-overview', who[role]);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('FORBIDDEN_ACTION');
  });

  it('the discharged-due view is gated the same way as the default view', async () => {
    expect((await req('/admissions/billing-overview?view=discharged-due', who.ACCOUNTANT)).status).toBe(200);
    expect((await req('/admissions/billing-overview?view=discharged-due', who.NURSE)).status).toBe(403);
  });
});
