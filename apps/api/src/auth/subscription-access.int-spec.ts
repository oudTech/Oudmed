import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { StorageModule } from '../storage/storage.module';
import { AuditModule } from '../common/audit/audit.module';
import { EmailModule } from '../email/email.module';
import { AuthModule } from './auth.module';
import { TokensService } from './tokens.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { EntitlementsService } from '../subscriptions/entitlements.service';
import { SettingsModule } from '../settings/settings.module';
import { destroyTenant, makeTenant, makeUser, ownerPrisma } from '../../test/int-helpers';

/**
 * A hospital past its grace period keeps read access to everything it already
 * has but cannot write - enforced centrally in JwtStrategy (see its own
 * comment for why there, not a global guard). This is real, not a paper
 * policy: it must run through actual HTTP requests with a real signed
 * session token, the same as production traffic, not a mocked guard.
 */
describe('Subscription-based access (READ_ONLY enforcement, integration)', () => {
  let app: INestApplication;
  let base: string;
  let prisma: PrismaService;
  let tokens: TokensService;
  let entitlements: EntitlementsService;
  let tenantId: string;
  let token: string;

  const req = (method: string, path: string, body?: unknown) =>
    fetch(`${base}/api${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, StorageModule, AuditModule, EmailModule, AuthModule, SubscriptionsModule, SettingsModule],
    }).compile();

    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.listen(0);
    base = await app.getUrl();
    prisma = mod.get(PrismaService);
    tokens = mod.get(TokensService);
    entitlements = mod.get(EntitlementsService);

    const tenant = await makeTenant();
    tenantId = tenant.id;
    const user = await makeUser(tenantId, 'HOSPITAL_ADMIN');
    token = tokens.issueSession({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      tenantId,
      tenantSlug: tenant.slug,
    });
  });

  afterAll(async () => {
    await app.close();
    await destroyTenant(tenantId);
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  const setSubscription = (data: Record<string, unknown>) =>
    ownerPrisma.subscription.upsert({
      where: { tenantId },
      create: { tenantId, trialEndsAt: new Date(), ...data },
      update: data,
    });

  it('EntitlementsService: FULL while trialing within the grace window', async () => {
    await setSubscription({ status: 'TRIALING', trialEndsAt: new Date(Date.now() + 24 * 3600_000) });
    expect(await entitlements.getAccessLevel(tenantId)).toBe('FULL');

    await setSubscription({ status: 'TRIALING', trialEndsAt: new Date(Date.now() - 1 * 3600_000) }); // trial ended 1h ago, well within 3-day grace
    expect(await entitlements.getAccessLevel(tenantId)).toBe('FULL');
  });

  it('EntitlementsService: READ_ONLY once the trial grace window has passed', async () => {
    await setSubscription({ status: 'TRIALING', trialEndsAt: new Date(Date.now() - 4 * 24 * 3600_000) }); // 4 days ago > 3-day grace
    expect(await entitlements.getAccessLevel(tenantId)).toBe('READ_ONLY');
  });

  it('EntitlementsService: ACTIVE is FULL within its period, READ_ONLY once period end + grace has passed', async () => {
    await setSubscription({ status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 10 * 24 * 3600_000) });
    expect(await entitlements.getAccessLevel(tenantId)).toBe('FULL');

    await setSubscription({ status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() - 4 * 24 * 3600_000) });
    expect(await entitlements.getAccessLevel(tenantId)).toBe('READ_ONLY');
  });

  it('EntitlementsService: SUSPENDED and CANCELLED are always READ_ONLY, regardless of dates', async () => {
    await setSubscription({ status: 'SUSPENDED', currentPeriodEnd: new Date(Date.now() + 100 * 24 * 3600_000) });
    expect(await entitlements.getAccessLevel(tenantId)).toBe('READ_ONLY');

    await setSubscription({ status: 'CANCELLED', currentPeriodEnd: new Date(Date.now() + 100 * 24 * 3600_000) });
    expect(await entitlements.getAccessLevel(tenantId)).toBe('READ_ONLY');
  });

  it('a FULL-access tenant can write to a normal endpoint', async () => {
    await setSubscription({ status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 10 * 24 * 3600_000) });
    const res = await req('PATCH', '/settings', { documentFooter: 'still open for business' });
    expect(res.status).toBe(200);
  });

  it('a READ_ONLY tenant is blocked (402) from writing to a normal endpoint, but GET still works', async () => {
    await setSubscription({ status: 'SUSPENDED' });

    const write = await req('PATCH', '/settings', { documentFooter: 'should not land' });
    expect(write.status).toBe(402);
    const body = await write.json();
    expect(body.code).toBe('SUBSCRIPTION_READ_ONLY');

    const read = await req('GET', '/settings');
    expect(read.status).toBe(200);
    const settings = await read.json();
    expect(settings.documentFooter).not.toBe('should not land'); // the blocked write never landed
  });

  it('a READ_ONLY tenant can still use the allowlisted subscriptions and auth/me paths', async () => {
    await setSubscription({ status: 'SUSPENDED' });

    const pricing = await req('GET', '/subscriptions/pricing');
    expect(pricing.status).toBe(200);

    const bankTransfer = await req('POST', '/subscriptions/checkout/bank-transfer', { billingCycle: 'MONTHLY' });
    expect(bankTransfer.status).toBeLessThan(300); // writing an invoice is exactly how a locked-out hospital pays its way out

    const me = await req('GET', '/auth/me');
    expect(me.status).toBe(200);
  });
});
