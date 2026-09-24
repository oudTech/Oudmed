import { INestApplication, ValidationPipe, ExecutionContext } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { configurePaystackRawBody } from '../common/raw-body';
import { EmailModule } from '../email/email.module';
import { SubscriptionsModule } from './subscriptions.module';
import { SubscriptionsService } from './subscriptions.service';
import { destroyTenant, makeTenant, makeUser, ownerPrisma } from '../../test/int-helpers';

/**
 * Phase 1 of platform subscription billing: seat pricing is data (PlatformPricing,
 * one row, SUPER_ADMIN-editable), every new tenant starts a trial, and the seat
 * breakdown is a live computation off active Users - never a stored, staleable
 * number.
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

describe('Subscriptions (integration - HTTP)', () => {
  let app: INestApplication;
  let base: string;
  let prisma: PrismaService;
  let subscriptions: SubscriptionsService;

  let tenantA: string;
  let adminA: Who;

  const req = (method: string, path: string, w: Who | null, body?: unknown) =>
    fetch(`${base}/api${path}`, {
      method,
      headers: {
        ...(w ? { 'x-test-user': JSON.stringify(auth(w)) } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, EmailModule, SubscriptionsModule],
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
    subscriptions = mod.get(SubscriptionsService);

    tenantA = (await makeTenant()).id;
    adminA = { tenantId: tenantA, userId: (await makeUser(tenantA, 'HOSPITAL_ADMIN')).id, role: 'HOSPITAL_ADMIN' };

    // Fixtures create tenants directly via the owner connection, bypassing the
    // real sign-up flow - so, like TenantsService.createFromPending does for a
    // real sign-up, start the trial here too.
    await prisma.$transaction((tx) => subscriptions.startTrial(tx, tenantA));
  });

  afterAll(async () => {
    await app.close();
    await destroyTenant(tenantA);
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  it('GET /subscriptions/pricing is public and returns the seeded row', async () => {
    const res = await req('GET', '/subscriptions/pricing', null);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.adminSeatPriceMonthly).toBe('20000.00');
    expect(body.otherSeatPriceMonthly).toBe('5000.00');
    expect(body.annualDiscountPct).toBe('15.00');
    expect(body.vatPct).toBe('7.50');
    // platformTin is a real, mutable operational value (not test-owned state) -
    // assert its shape, not a specific value that a real TIN entry would break.
    expect(body.platformTin === null || typeof body.platformTin === 'string').toBe(true);
    expect(body.trialDays).toBe(14);
  });

  it('PATCH /subscriptions/pricing refuses a hospital session token - it is a platform-only action now', async () => {
    // adminA is a HOSPITAL_ADMIN/SUPER_ADMIN-shaped tenant token either way -
    // this route only accepts a genuine platform token (see platform-auth.int-spec.ts).
    const res = await req('PATCH', '/subscriptions/pricing', adminA, { adminSeatPriceMonthly: 99 });
    expect(res.status).toBe(401);
    const pricing = await (await req('GET', '/subscriptions/pricing', null)).json();
    expect(pricing.adminSeatPriceMonthly).toBe('20000.00'); // unchanged
  });

  it('GET /subscriptions/me reports a live TRIALING subscription with the right trial window', async () => {
    const res = await req('GET', '/subscriptions/me', adminA);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('TRIALING');
    expect(body.billingCycle).toBe('MONTHLY');
    expect(body.trialDaysRemaining).toBeGreaterThanOrEqual(13);
    expect(body.trialDaysRemaining).toBeLessThanOrEqual(14);
  });

  it('GET /subscriptions/me is gated to admin:settings (a non-admin role is refused)', async () => {
    const nurse: Who = { tenantId: tenantA, userId: adminA.userId, role: 'NURSE' };
    const res = await req('GET', '/subscriptions/me', nurse);
    expect(res.status).toBe(403);
  });

  it('the seat breakdown counts HOSPITAL_ADMIN and every other role separately, and only active users', async () => {
    const doctor = await makeUser(tenantA, 'DOCTOR');
    const nurse = await makeUser(tenantA, 'NURSE');
    const deactivatedReceptionist = await makeUser(tenantA, 'RECEPTIONIST');
    await ownerPrisma.user.update({ where: { id: deactivatedReceptionist.id }, data: { isActive: false } });

    const body = await (await req('GET', '/subscriptions/me', adminA)).json();
    // 1 admin (adminA) + doctor + nurse active; the deactivated receptionist must not count
    expect(body.seats.adminSeats).toBe(1);
    expect(body.seats.otherSeats).toBe(2);
    expect(body.seats.monthlyNet).toBe('30000.00'); // 1*20000 + 2*5000
    expect(body.seats.monthlyVat).toBe('2250.00'); // 7.5% of 30000
    expect(body.seats.monthlyGross).toBe('32250.00');
    // 30000 * 12 * 0.85 = 306000.00
    expect(body.seats.annualNet).toBe('306000.00');
    expect(body.seats.annualVat).toBe('22950.00'); // 7.5% of 306000
    expect(body.seats.annualGross).toBe('328950.00');

    await ownerPrisma.user.deleteMany({ where: { id: { in: [doctor.id, nurse.id, deactivatedReceptionist.id] } } });
  });
});

describe('Subscription payment collection (integration - HTTP)', () => {
  let app: INestApplication;
  let base: string;
  let prisma: PrismaService;
  let subscriptions: SubscriptionsService;
  let tenantA: string;
  let adminA: Who;
  const originalFetch = global.fetch;

  const req = (method: string, path: string, w: Who | null, body?: unknown) =>
    fetch(`${base}/api${path}`, {
      method,
      headers: {
        ...(w ? { 'x-test-user': JSON.stringify(auth(w)) } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  /**
   * Only Paystack's own API calls are faked - everything else (including this
   * file's own `req()` calls to the local test server) must reach the real
   * fetch, or the test would be mocking its own HTTP client by accident.
   */
  const mockPaystack = (handler: (url: string, body: any) => Promise<{ status: boolean; data: unknown }>) => {
    global.fetch = (async (url: unknown, init?: { body?: string }) => {
      const u = String(url);
      if (u.startsWith('https://api.paystack.co')) {
        const data = await handler(u, init?.body ? JSON.parse(init.body) : undefined);
        return { ok: true, json: async () => data };
      }
      return originalFetch(url as RequestInfo, init as RequestInit);
    }) as unknown as typeof fetch;
  };

  beforeAll(async () => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_fake';
    process.env.PAYSTACK_WEBHOOK_SECRET = 'whsec_fake';

    const mod = await Test.createTestingModule({
      imports: [PrismaModule, EmailModule, SubscriptionsModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(testAuthGuard)
      .compile();

    // bodyParser: false + configurePaystackRawBody mirrors main.ts exactly -
    // a webhook signature test is worthless if this app doesn't actually
    // capture the raw bytes the way the real one does.
    app = mod.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configurePaystackRawBody(app as NestExpressApplication);
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.listen(0);
    base = await app.getUrl();
    prisma = mod.get(PrismaService);
    subscriptions = mod.get(SubscriptionsService);

    tenantA = (await makeTenant()).id;
    adminA = { tenantId: tenantA, userId: (await makeUser(tenantA, 'HOSPITAL_ADMIN')).id, role: 'HOSPITAL_ADMIN' };
    await prisma.$transaction((tx) => subscriptions.startTrial(tx, tenantA));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(async () => {
    await app.close();
    await destroyTenant(tenantA);
    await prisma.$disconnect();
  });

  it('POST /subscriptions/checkout/card creates a PENDING invoice and returns Paystack\'s authorization URL', async () => {
    mockPaystack(async (url, sentBody) => {
      expect(url).toContain('/transaction/initialize');
      // A real Paystack echoes back whatever reference the caller supplied.
      return {
        status: true,
        data: { authorization_url: 'https://checkout.paystack.com/abc', access_code: 'abc', reference: sentBody.reference },
      };
    });

    const res = await req('POST', '/subscriptions/checkout/card', adminA, { billingCycle: 'MONTHLY' });
    const body = await res.json();
    expect(body.authorizationUrl).toBe('https://checkout.paystack.com/abc');
    expect(body.reference).toMatch(/^SUB-\d{6}$/);

    const invoice = await ownerPrisma.subscriptionInvoice.findUnique({ where: { id: body.invoiceId } });
    expect(invoice?.status).toBe('PENDING');
    expect(invoice?.paymentMethod).toBe('CARD');
    expect(invoice?.paystackReference).toBe(body.reference);
    expect(invoice?.paystackReference).toBe(invoice?.invoiceNumber);
  });

  it('card checkout is refused with a clear error when Paystack is not configured', async () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    const res = await req('POST', '/subscriptions/checkout/card', adminA, { billingCycle: 'MONTHLY' });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('PAYSTACK_NOT_CONFIGURED');
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_fake';
  });

  it('POST /subscriptions/checkout/bank-transfer creates a PENDING invoice with no card reference', async () => {
    const res = await req('POST', '/subscriptions/checkout/bank-transfer', adminA, { billingCycle: 'ANNUAL' });
    const body = await res.json();
    expect(body.status).toBe('PENDING');
    expect(body.paymentMethod).toBe('BANK_TRANSFER');
    expect(body.billingCycle).toBe('ANNUAL');

    const row = await ownerPrisma.subscriptionInvoice.findUnique({ where: { id: body.id } });
    expect(row?.paystackReference).toBeNull();
  });

  it('a hospital session token cannot reach the platform mark-paid route (it lives under /platform/*, see platform-auth.int-spec.ts)', async () => {
    const created = await (await req('POST', '/subscriptions/checkout/bank-transfer', adminA, { billingCycle: 'MONTHLY' })).json();
    const res = await req('PATCH', `/platform/subscriptions/${tenantA}/invoices/${created.id}/mark-paid`, adminA);
    expect(res.status).toBe(401);
  });

  it('POST /subscriptions/webhooks/paystack rejects a bad signature', async () => {
    const res = await fetch(`${base}/api/subscriptions/webhooks/paystack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-paystack-signature': 'not-a-real-signature' },
      body: JSON.stringify({ event: 'charge.success', data: {} }),
    });
    expect(res.status).toBe(403);
  });

  it('a valid charge.success webhook activates the subscription, and redelivery is a no-op', async () => {
    mockPaystack(async (_url, sentBody) => ({
      status: true,
      data: { authorization_url: 'https://x', access_code: 'x', reference: sentBody.reference },
    }));
    const checkout = await (await req('POST', '/subscriptions/checkout/card', adminA, { billingCycle: 'MONTHLY' })).json();
    global.fetch = originalFetch;

    // A fixed id would collide with a leftover row from a prior run of this
    // same test against a persistent dev database (the idempotency check
    // would then treat this as an already-processed redelivery from the very
    // first send) - so this must be unique per run, the same way a real
    // Paystack transaction id always is.
    const eventId = Date.now();
    const { createHmac } = await import('crypto');
    const payload = JSON.stringify({
      event: 'charge.success',
      data: {
        id: eventId,
        reference: checkout.reference,
        amount: 3225000,
        metadata: { tenantId: tenantA, subscriptionInvoiceId: checkout.invoiceId },
      },
    });
    const signature = createHmac('sha512', 'whsec_fake').update(payload).digest('hex');
    const send = () =>
      fetch(`${base}/api/subscriptions/webhooks/paystack`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-paystack-signature': signature },
        body: payload,
      });

    const res1 = await send();
    expect(res1.status).toBeLessThan(300);

    const invoice = await ownerPrisma.subscriptionInvoice.findUnique({ where: { id: checkout.invoiceId } });
    expect(invoice?.status).toBe('PAID');
    const sub = await ownerPrisma.subscription.findUnique({ where: { tenantId: tenantA } });
    expect(sub?.status).toBe('ACTIVE');

    // Paystack may redeliver the same event - must not error and must not be reprocessed
    const res2 = await send();
    expect(res2.status).toBeLessThan(300);
    const events = await ownerPrisma.platformWebhookEvent.findMany({ where: { id: String(eventId) } });
    expect(events).toHaveLength(1);
    expect(events[0].processedAt).not.toBeNull();

    await ownerPrisma.platformWebhookEvent.deleteMany({ where: { id: String(eventId) } });
  });
});
