import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../common/audit/audit.module';
import { EmailModule } from '../email/email.module';
import { EmailService } from '../email/email.service';
import { SubscriptionsModule } from './subscriptions.module';
import { SubscriptionsService } from './subscriptions.service';
import { RenewalService } from './renewal.service';
import { destroyTenant, makeTenant, makeUser, ownerPrisma } from '../../test/int-helpers';

/**
 * Auto-renewal, dunning and the two proactive notifications - all driven by
 * RenewalService's daily jobs (see its own comment on why it iterates tenants
 * one at a time rather than a bare cross-tenant query). No real cron tick is
 * needed to test this: @Cron only adds scheduling metadata, the methods
 * remain ordinary functions callable directly.
 */
describe('Auto-renewal, dunning and billing notifications (integration)', () => {
  let prisma: PrismaService;
  let subscriptions: SubscriptionsService;
  let renewal: RenewalService;
  let email: EmailService;
  let tenantId: string;
  const originalFetch = global.fetch;

  const mockPaystackCharge = (status: 'success' | 'failed') => {
    global.fetch = (async (url: unknown, init?: { body?: string }) => {
      const u = String(url);
      if (u.includes('/transaction/charge_authorization')) {
        return {
          ok: true,
          json: async () => ({
            status: true,
            data: { status, reference: init?.body ? JSON.parse(init.body).reference : 'x', authorization: { authorization_code: 'AUTH_reused', reusable: true } },
          }),
        };
      }
      return originalFetch(url as RequestInfo, init as RequestInit);
    }) as unknown as typeof fetch;
  };

  beforeAll(async () => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_fake';

    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, EmailModule, SubscriptionsModule],
    }).compile();

    prisma = mod.get(PrismaService);
    subscriptions = mod.get(SubscriptionsService);
    renewal = mod.get(RenewalService);
    email = mod.get(EmailService);

    const tenant = await makeTenant();
    tenantId = tenant.id;
    await makeUser(tenantId, 'HOSPITAL_ADMIN');
    await ownerPrisma.tenant.update({ where: { id: tenantId }, data: { contactEmail: 'billing-contact@int.test' } });
    await prisma.$transaction((tx) => subscriptions.startTrial(tx, tenantId));
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await destroyTenant(tenantId);
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  const setSub = (data: Record<string, unknown>) => ownerPrisma.subscription.update({ where: { tenantId }, data });

  it('attemptAutoRenewal is a no-op when nothing is actually due', async () => {
    // still trialing - never renews
    await setSub({ status: 'TRIALING' });
    await subscriptions.attemptAutoRenewal(tenantId);
    expect((await ownerPrisma.subscription.findUnique({ where: { tenantId } }))?.status).toBe('TRIALING');

    // active but no saved card yet
    await setSub({ status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() - 24 * 3600_000), paystackAuthorizationCode: null });
    await subscriptions.attemptAutoRenewal(tenantId);
    expect((await ownerPrisma.subscription.findUnique({ where: { tenantId } }))?.dunningAttempts).toBe(0);

    // active, has a card, but period has not ended yet
    await setSub({ paystackAuthorizationCode: 'AUTH_test', currentPeriodEnd: new Date(Date.now() + 24 * 3600_000) });
    await subscriptions.attemptAutoRenewal(tenantId);
    expect((await ownerPrisma.subscription.findUnique({ where: { tenantId } }))?.dunningAttempts).toBe(0);
  });

  it('a successful renewal charge extends the period and resets dunning state', async () => {
    await setSub({
      status: 'ACTIVE',
      billingCycle: 'MONTHLY',
      paystackAuthorizationCode: 'AUTH_test',
      currentPeriodEnd: new Date(Date.now() - 24 * 3600_000),
      dunningAttempts: 2,
      nextRenewalAttemptAt: new Date(Date.now() - 1000),
    });
    const spy = jest.spyOn(email, 'sendPaymentReceived').mockResolvedValue();
    mockPaystackCharge('success');

    await subscriptions.attemptAutoRenewal(tenantId);

    const sub = await ownerPrisma.subscription.findUnique({ where: { tenantId } });
    expect(sub?.status).toBe('ACTIVE');
    expect(sub?.dunningAttempts).toBe(0);
    expect(sub?.nextRenewalAttemptAt).toBeNull();
    expect(sub?.currentPeriodEnd?.getTime()).toBeGreaterThan(Date.now());
    expect(spy).toHaveBeenCalled();

    const invoices = await ownerPrisma.subscriptionInvoice.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
    expect(invoices[0].status).toBe('PAID');
    expect(invoices[0].paymentMethod).toBe('CARD');
  });

  it('a failed renewal charge moves the subscription to PAST_DUE with a backoff date, and sends a payment-failed email', async () => {
    await setSub({
      status: 'ACTIVE',
      billingCycle: 'MONTHLY',
      paystackAuthorizationCode: 'AUTH_test',
      currentPeriodEnd: new Date(Date.now() - 24 * 3600_000),
      dunningAttempts: 0,
      nextRenewalAttemptAt: null,
    });
    const spy = jest.spyOn(email, 'sendPaymentFailed').mockResolvedValue();
    mockPaystackCharge('failed');

    await subscriptions.attemptAutoRenewal(tenantId);

    const sub = await ownerPrisma.subscription.findUnique({ where: { tenantId } });
    expect(sub?.status).toBe('PAST_DUE');
    expect(sub?.dunningAttempts).toBe(1);
    expect(sub?.nextRenewalAttemptAt).not.toBeNull();
    expect(sub!.nextRenewalAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    expect(spy).toHaveBeenCalledWith('billing-contact@int.test', expect.any(String), 1, expect.any(String), expect.any(String));

    const invoices = await ownerPrisma.subscriptionInvoice.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
    expect(invoices[0].status).toBe('FAILED');
  });

  it('stops retrying after the backoff schedule is exhausted', async () => {
    await setSub({
      status: 'PAST_DUE',
      paystackAuthorizationCode: 'AUTH_test',
      currentPeriodEnd: new Date(Date.now() - 24 * 3600_000),
      dunningAttempts: 3, // already at the last scheduled attempt
      nextRenewalAttemptAt: new Date(Date.now() - 1000),
    });
    jest.spyOn(email, 'sendPaymentFailed').mockResolvedValue();
    mockPaystackCharge('failed');

    await subscriptions.attemptAutoRenewal(tenantId);

    const sub = await ownerPrisma.subscription.findUnique({ where: { tenantId } });
    expect(sub?.dunningAttempts).toBe(4);
    expect(sub?.nextRenewalAttemptAt).toBeNull(); // no further auto-retry - the read-only grace period is the backstop now
  });

  it('sendTrialEndingReminders emails once when a trial is within the reminder window, and never resends', async () => {
    await setSub({
      status: 'TRIALING',
      trialEndsAt: new Date(Date.now() + 2 * 24 * 3600_000),
      trialEndingReminderSentAt: null,
    });
    const spy = jest.spyOn(email, 'sendTrialEndingSoon').mockResolvedValue();

    await renewal.sendTrialEndingReminders();
    expect(spy).toHaveBeenCalledTimes(1);
    const sub = await ownerPrisma.subscription.findUnique({ where: { tenantId } });
    expect(sub?.trialEndingReminderSentAt).not.toBeNull();

    await renewal.sendTrialEndingReminders(); // second run must not resend
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('sendReadOnlyNotices emails once when a subscription has actually gone read-only, and never resends', async () => {
    await setSub({ status: 'SUSPENDED', readOnlyNoticeSentAt: null });
    const spy = jest.spyOn(email, 'sendReadOnlyNotice').mockResolvedValue();

    await renewal.sendReadOnlyNotices();
    expect(spy).toHaveBeenCalledTimes(1);
    const sub = await ownerPrisma.subscription.findUnique({ where: { tenantId } });
    expect(sub?.readOnlyNoticeSentAt).not.toBeNull();

    await renewal.sendReadOnlyNotices();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('processRenewals iterates every active tenant without throwing, even with a mix of due and not-due subscriptions', async () => {
    await setSub({ status: 'ACTIVE', paystackAuthorizationCode: null }); // not due (no card) - must be skipped silently
    await expect(renewal.processRenewals()).resolves.not.toThrow();
  });
});
