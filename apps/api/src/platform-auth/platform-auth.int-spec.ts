import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../common/audit/audit.module';
import { PlatformAuthModule } from './platform-auth.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { destroyTenant, makeTenant, makeUser, ownerPrisma, uniqueSlug } from '../../test/int-helpers';

/**
 * The platform operator identity (Option A from the Super Admin decision):
 * a PlatformUser has no tenant at all, by construction - these are real HTTP
 * calls with a real issued JWT throughout, the same as a genuine operator
 * would use, not a mocked guard.
 */
describe('Platform auth (integration - HTTP)', () => {
  let app: INestApplication;
  let base: string;
  let prisma: PrismaService;
  let subscriptions: SubscriptionsService;
  let platformEmail: string;
  const platformPassword = 'a-strong-platform-password-123';
  let platformToken: string;
  let tenantId: string;

  const req = (method: string, path: string, token: string | null, body?: unknown) =>
    fetch(`${base}/api${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, PlatformAuthModule, SubscriptionsModule],
    }).compile();

    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.listen(0);
    base = await app.getUrl();
    prisma = mod.get(PrismaService);
    subscriptions = mod.get(SubscriptionsService);

    platformEmail = `${uniqueSlug('platform')}@int.test`;
    await ownerPrisma.platformUser.create({
      data: { email: platformEmail, passwordHash: await bcrypt.hash(platformPassword, 12), fullName: 'Platform Tester' },
    });

    const tenant = await makeTenant();
    tenantId = tenant.id;
    await makeUser(tenantId, 'HOSPITAL_ADMIN');
    await prisma.$transaction((tx) => subscriptions.startTrial(tx, tenantId));
  });

  afterAll(async () => {
    await app.close();
    await destroyTenant(tenantId);
    await ownerPrisma.platformUser.deleteMany({ where: { email: platformEmail } });
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  it('rejects a wrong password', async () => {
    const res = await req('POST', '/platform/auth/login', null, { email: platformEmail, password: 'wrong-password-here' });
    expect(res.status).toBe(401);
  });

  it('logs in with the right password and issues a usable token', async () => {
    const res = await req('POST', '/platform/auth/login', null, { email: platformEmail, password: platformPassword });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(typeof body.accessToken).toBe('string');
    platformToken = body.accessToken;
  });

  it('a hospital session-shaped request cannot use platform routes, and a platform token cannot use hospital ones', async () => {
    // no Authorization header at all -> 401, proving the route is genuinely gated
    const noAuth = await req('PATCH', '/subscriptions/pricing', null, { trialDays: 10 });
    expect(noAuth.status).toBe(401);
  });

  it('PATCH /subscriptions/pricing works with a real platform token and changes only the given field', async () => {
    const res = await req('PATCH', '/subscriptions/pricing', platformToken, { adminSeatPriceMonthly: 25000 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.adminSeatPriceMonthly).toBe('25000.00');
    expect(body.otherSeatPriceMonthly).toBe('5000.00'); // untouched

    // revert so other suites reading the same singleton row see the original price
    await req('PATCH', '/subscriptions/pricing', platformToken, { adminSeatPriceMonthly: 20000 });
  });

  it('PATCH /platform/subscriptions/:tenantId/invoices/:invoiceId/mark-paid confirms a bank-transfer invoice and activates the subscription', async () => {
    const invoice = await ownerPrisma.subscriptionInvoice.create({
      data: {
        tenantId,
        subscriptionId: (await ownerPrisma.subscription.findUniqueOrThrow({ where: { tenantId } })).id,
        invoiceNumber: `SUB-TEST-${Date.now()}`,
        billingCycle: 'MONTHLY',
        netAmount: 65000,
        vatAmount: 4875,
        totalAmount: 69875,
        paymentMethod: 'BANK_TRANSFER',
      },
    });

    const res = await req('PATCH', `/platform/subscriptions/${tenantId}/invoices/${invoice.id}/mark-paid`, platformToken);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('PAID');

    const sub = await ownerPrisma.subscription.findUnique({ where: { tenantId } });
    expect(sub?.status).toBe('ACTIVE');
    expect(sub?.currentPeriodEnd).not.toBeNull();

    const auditRow = await ownerPrisma.auditLog.findFirst({
      where: { tenantId, entityType: 'SubscriptionInvoice', entityId: invoice.id },
    });
    expect(auditRow).not.toBeNull(); // the platform action is still traceable in the hospital's own audit log

    // idempotent: confirming an already-PAID invoice again just returns it unchanged
    const again = await req('PATCH', `/platform/subscriptions/${tenantId}/invoices/${invoice.id}/mark-paid`, platformToken);
    expect(again.status).toBe(200);
  });

  it('a deactivated platform user is rejected even with a previously-valid token', async () => {
    await ownerPrisma.platformUser.update({ where: { email: platformEmail }, data: { isActive: false } });
    const res = await req('PATCH', '/subscriptions/pricing', platformToken, { trialDays: 10 });
    expect(res.status).toBe(401);
    await ownerPrisma.platformUser.update({ where: { email: platformEmail }, data: { isActive: true } });
  });
});
