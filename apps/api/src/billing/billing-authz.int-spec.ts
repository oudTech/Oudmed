import { INestApplication, ValidationPipe, ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../common/audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { BillingModule } from './billing.module';
import { BillingService } from './billing.service';
import {
  actorFor,
  destroyTenant,
  makePatient,
  makeTenant,
  makeUser,
  makeVisit,
  ownerPrisma,
} from '../../test/int-helpers';

/**
 * Wave A: financial reads (invoices, receipts, price catalogue) are limited to
 * the billing office (billing:manage). Service items are additionally readable by
 * clinicians (order:create) for the encounter order-entry autocomplete.
 * Enforcement is at the HTTP boundary so internal ClaimsService -> BillingService
 * calls are unaffected. The obsolete GET /dashboard route is gone.
 */

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

describe('Billing authorization (integration - HTTP)', () => {
  let app: INestApplication;
  let base: string;
  let prisma: PrismaService;
  let billing: BillingService;

  let tenantA: string;
  const who: Record<string, Who> = {};
  let invoiceId: string;
  let paymentId: string;

  let tenantB: string;
  let adminB: Who;

  const req = (method: string, path: string, w: Who) =>
    fetch(`${base}/api${path}`, { method, headers: { 'x-test-user': JSON.stringify(auth(w)) } });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, StorageModule, BillingModule],
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
    billing = mod.get(BillingService);

    tenantA = (await makeTenant()).id;
    for (const role of ['HOSPITAL_ADMIN', 'RECEPTIONIST', 'ACCOUNTANT', 'DOCTOR', 'NURSE', 'PHARMACIST', 'LAB_STAFF', 'SUPER_ADMIN']) {
      who[role] = { tenantId: tenantA, userId: (await makeUser(tenantA, role)).id, role };
    }

    const patient = await makePatient(tenantA);
    const visit = await makeVisit(tenantA, patient.id);
    const admin = actorFor(tenantA, who.HOSPITAL_ADMIN.userId, 'HOSPITAL_ADMIN');
    const charge = await prisma.forTenant(tenantA, (tx) =>
      billing.postChargeToVisit(tx, {
        tenantId: tenantA, userId: admin.userId, visitId: visit.id, patientId: patient.id,
        description: 'Consultation', quantity: 1, unitPrice: 5000, category: 'Consultation',
      }),
    );
    invoiceId = charge.invoiceId;
    const pay = await billing.addPayment(admin, invoiceId, { amount: 1000, method: 'CASH' } as any);
    paymentId = pay.paymentId;

    tenantB = (await makeTenant()).id;
    adminB = { tenantId: tenantB, userId: (await makeUser(tenantB, 'HOSPITAL_ADMIN')).id, role: 'HOSPITAL_ADMIN' };
  });

  afterAll(async () => {
    await app.close();
    await destroyTenant(tenantA);
    await destroyTenant(tenantB);
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  const BILLING_READS = [
    ['GET', '/billing/invoices'],
    ['GET', () => `/billing/invoices/${invoiceId}`],
    ['GET', () => `/billing/payments/${paymentId}/receipt`],
    ['GET', '/billing/catalogue'],
  ] as const;

  it.each(['RECEPTIONIST', 'ACCOUNTANT', 'HOSPITAL_ADMIN', 'SUPER_ADMIN'])('%s may read billing', async (role) => {
    for (const [method, p] of BILLING_READS) {
      const path = typeof p === 'function' ? p() : p;
      expect((await req(method, path, who[role])).status).toBe(200);
    }
  });

  it.each(['DOCTOR', 'NURSE', 'PHARMACIST', 'LAB_STAFF'])('%s is forbidden from billing reads (403)', async (role) => {
    for (const [method, p] of BILLING_READS) {
      const path = typeof p === 'function' ? p() : p;
      const res = await req(method, path, who[role]);
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('FORBIDDEN_ACTION');
    }
  });

  it('service-items is also readable by a doctor (order-entry autocomplete), not a nurse', async () => {
    expect((await req('GET', '/billing/service-items', who.DOCTOR)).status).toBe(200);
    expect((await req('GET', '/billing/service-items', who.ACCOUNTANT)).status).toBe(200);
    expect((await req('GET', '/billing/service-items', who.NURSE)).status).toBe(403);
    expect((await req('GET', '/billing/service-items', who.PHARMACIST)).status).toBe(403);
  });

  it('the obsolete GET /dashboard route is gone (404)', async () => {
    expect((await req('GET', '/dashboard', who.HOSPITAL_ADMIN)).status).toBe(404);
  });

  it('cross-tenant invoice read returns 404, never 403', async () => {
    const res = await req('GET', `/billing/invoices/${invoiceId}`, adminB);
    expect(res.status).toBe(404);
  });

  it('internal ClaimsService-style call path still works: BillingService.getInvoice by tenantId', async () => {
    const inv = await billing.getInvoice(tenantA, invoiceId);
    expect(inv.id).toBe(invoiceId);
    expect(Number(inv.paidAmount)).toBe(1000);
  });
});
