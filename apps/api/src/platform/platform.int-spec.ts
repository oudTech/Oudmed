import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../common/audit/audit.module';
import { EmailModule } from '../email/email.module';
import { PlatformAuthModule } from '../platform-auth/platform-auth.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PlatformModule } from './platform.module';
import { AuthModule } from '../auth/auth.module';
import { TokensService } from '../auth/tokens.service';
import { MeModule } from '../me/me.module';
import { StorageModule } from '../storage/storage.module';
import { destroyTenant, makeTenant, makeUser, ownerPrisma, uniqueSlug } from '../../test/int-helpers';

/**
 * Real HTTP calls throughout, same discipline as platform-auth.int-spec.ts: a
 * genuine PlatformUser identity and a real issued JWT, not a mocked guard.
 */
describe('Platform module (integration - HTTP)', () => {
  let app: INestApplication;
  let base: string;
  let prisma: PrismaService;
  let tokens: TokensService;
  let platformEmail: string;
  const platformPassword = 'a-strong-platform-password-123';
  let platformToken: string;
  let extraTenantId: string;
  let createdTenantId: string | undefined;

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
      imports: [PrismaModule, AuditModule, EmailModule, StorageModule, PlatformAuthModule, SubscriptionsModule, PlatformModule, AuthModule, MeModule],
    }).compile();

    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.listen(0);
    base = await app.getUrl();
    prisma = mod.get(PrismaService);
    tokens = mod.get(TokensService);

    platformEmail = `${uniqueSlug('platform')}@int.test`;
    await ownerPrisma.platformUser.create({
      data: { email: platformEmail, passwordHash: await bcrypt.hash(platformPassword, 12), fullName: 'Platform Tester' },
    });
    const login = await req('POST', '/platform/auth/login', null, { email: platformEmail, password: platformPassword });
    platformToken = (await login.json()).accessToken;

    const extra = await makeTenant();
    extraTenantId = extra.id;
    await makeUser(extraTenantId, 'HOSPITAL_ADMIN');
  });

  afterAll(async () => {
    // Belt-and-braces: never leave the platform down for other suites even if
    // an assertion above threw before the explicit disable ran.
    await ownerPrisma.platformConfig.updateMany({ data: { maintenanceMode: false } });
    await app.close();
    await destroyTenant(extraTenantId);
    if (createdTenantId) await destroyTenant(createdTenantId);
    await ownerPrisma.platformUser.deleteMany({ where: { email: platformEmail } });
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  it('rejects every platform route without a token', async () => {
    const res = await req('GET', '/platform/tenants', null);
    expect(res.status).toBe(401);
  });

  it('creates a hospital directly, and its admin can really log in', async () => {
    const slug = uniqueSlug('direct');
    const adminEmail = `${slug}-admin@int.test`;
    const res = await req('POST', '/platform/tenants', platformToken, {
      name: `Direct Hospital ${slug}`,
      address: 'Lagos, Nigeria',
      adminFullName: 'Direct Admin',
      adminEmail,
      adminPassword: 'a-strong-password-123',
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    createdTenantId = body.id;
    expect(body.subscriptionStatus).toBe('TRIALING');
    expect(body.users).toBe(1);
    expect(body.invoices).toEqual([]);

    const tenantRow = await ownerPrisma.tenant.findUnique({ where: { id: createdTenantId } });
    const loginRes = await req('POST', '/auth/login', null, {
      tenantSlug: tenantRow!.slug,
      email: adminEmail,
      password: 'a-strong-password-123',
    });
    expect(loginRes.status).toBe(201);
    const loginBody = await loginRes.json();
    expect(loginBody.user.role).toBe('HOSPITAL_ADMIN');

    const auditRow = await ownerPrisma.platformAuditLog.findFirst({
      where: { entityType: 'Tenant', action: 'CREATE', entityId: createdTenantId },
    });
    expect(auditRow).not.toBeNull();
  });

  it('lists hospitals and finds the one just created by search', async () => {
    const res = await req('GET', `/platform/tenants?search=${encodeURIComponent('Direct Hospital')}`, platformToken);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows.some((r: { id: string }) => r.id === createdTenantId)).toBe(true);
  });

  it('suspends then reactivates a hospital, both audited', async () => {
    const suspendRes = await req('POST', `/platform/tenants/${extraTenantId}/suspend`, platformToken);
    expect(suspendRes.status).toBe(201);
    expect((await suspendRes.json()).isActive).toBe(false);
    expect((await ownerPrisma.tenant.findUnique({ where: { id: extraTenantId } }))?.isActive).toBe(false);

    const reactivateRes = await req('POST', `/platform/tenants/${extraTenantId}/reactivate`, platformToken);
    expect(reactivateRes.status).toBe(201);
    expect((await reactivateRes.json()).isActive).toBe(true);

    const suspendLog = await ownerPrisma.platformAuditLog.findFirst({
      where: { tenantId: extraTenantId, action: 'SUSPEND', entityType: 'Tenant' },
    });
    expect(suspendLog).not.toBeNull();
  });

  it('overview and activity reflect real cross-tenant data', async () => {
    const overview = await req('GET', '/platform/overview', platformToken);
    expect(overview.status).toBe(200);
    const overviewBody = await overview.json();
    expect(overviewBody.totalHospitals).toBeGreaterThanOrEqual(2);
    expect(typeof overviewBody.statusCounts.TRIALING).toBe('number');
    expect(Array.isArray(overviewBody.revenueTrend)).toBe(true);

    const activity = await req('GET', '/platform/activity', platformToken);
    expect(activity.status).toBe(200);
    const activityBody = await activity.json();
    expect(activityBody.rows.some((r: { entityType: string; action: string }) => r.entityType === 'Tenant' && r.action === 'CREATE')).toBe(true);
  });

  it('lists subscriptions and stats across tenants', async () => {
    const list = await req('GET', '/platform/subscriptions', platformToken);
    expect(list.status).toBe(200);
    expect((await list.json()).rows.length).toBeGreaterThanOrEqual(2);

    const stats = await req('GET', '/platform/subscriptions/stats', platformToken);
    expect(stats.status).toBe(200);
    const statsBody = await stats.json();
    expect(statsBody.refunded).toBe(0);
  });

  it('reads and updates platform config', async () => {
    const get = await req('GET', '/platform/config', platformToken);
    expect(get.status).toBe(200);

    const update = await req('PATCH', '/platform/config', platformToken, { supportEmail: 'support@int.test' });
    expect(update.status).toBe(200);
    expect((await update.json()).supportEmail).toBe('support@int.test');
  });

  it('maintenance mode blocks hospital sessions but never platform routes, and is reversible', async () => {
    const user = await makeUser(extraTenantId, 'HOSPITAL_ADMIN');
    const tenantRow = await ownerPrisma.tenant.findUniqueOrThrow({ where: { id: extraTenantId } });
    const hospitalToken = tokens.issueSession({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      tenantId: extraTenantId,
      tenantSlug: tenantRow.slug,
    });

    const before = await req('GET', '/me/preferences', hospitalToken);
    expect(before.status).not.toBe(503);

    const on = await req('PATCH', '/platform/config/maintenance', platformToken, { maintenanceMode: true });
    expect(on.status).toBe(200);
    expect((await on.json()).maintenanceMode).toBe(true);

    try {
      const blocked = await req('GET', '/me/preferences', hospitalToken);
      expect(blocked.status).toBe(503);
      expect((await blocked.json()).code).toBe('MAINTENANCE_MODE');

      const stillWorks = await req('GET', '/platform/tenants', platformToken);
      expect(stillWorks.status).toBe(200);
    } finally {
      const off = await req('PATCH', '/platform/config/maintenance', platformToken, { maintenanceMode: false });
      expect(off.status).toBe(200);
    }

    const after = await req('GET', '/me/preferences', hospitalToken);
    expect(after.status).not.toBe(503);
  });

  it('creates, deactivates and reactivates a platform user, and blocks self-deactivation', async () => {
    const email = `${uniqueSlug('op')}@int.test`;
    const create = await req('POST', '/platform/users', platformToken, {
      fullName: 'Second Operator',
      email,
      password: 'another-strong-password-123',
    });
    expect(create.status).toBe(201);
    const created = await create.json();
    expect(created.isActive).toBe(true);

    const deactivate = await req('PATCH', `/platform/users/${created.id}/deactivate`, platformToken);
    expect(deactivate.status).toBe(200);
    expect((await deactivate.json()).isActive).toBe(false);

    const reactivate = await req('PATCH', `/platform/users/${created.id}/reactivate`, platformToken);
    expect(reactivate.status).toBe(200);
    expect((await reactivate.json()).isActive).toBe(true);

    await ownerPrisma.platformUser.deleteMany({ where: { email } });

    const acting = await ownerPrisma.platformUser.findUnique({ where: { email: platformEmail } });
    const selfDeactivate = await req('PATCH', `/platform/users/${acting!.id}/deactivate`, platformToken);
    expect(selfDeactivate.status).toBe(409);
  });

  it('self-service account: view profile, update name, and change password', async () => {
    const me = await req('GET', '/platform/auth/me', platformToken);
    expect(me.status).toBe(200);
    expect((await me.json()).email).toBe(platformEmail);

    const updated = await req('PATCH', '/platform/auth/me', platformToken, { fullName: 'Renamed Operator' });
    expect(updated.status).toBe(200);
    expect((await updated.json()).fullName).toBe('Renamed Operator');

    const wrongCurrent = await req('PATCH', '/platform/auth/me/password', platformToken, {
      currentPassword: 'not-the-real-password',
      newPassword: 'a-brand-new-strong-password-123',
    });
    expect(wrongCurrent.status).toBe(401);

    const changed = await req('PATCH', '/platform/auth/me/password', platformToken, {
      currentPassword: platformPassword,
      newPassword: 'a-brand-new-strong-password-123',
    });
    expect(changed.status).toBe(200);

    const loginOld = await req('POST', '/platform/auth/login', null, { email: platformEmail, password: platformPassword });
    expect(loginOld.status).toBe(401);

    const loginNew = await req('POST', '/platform/auth/login', null, {
      email: platformEmail,
      password: 'a-brand-new-strong-password-123',
    });
    expect(loginNew.status).toBe(201);

    const acting = await ownerPrisma.platformUser.findUniqueOrThrow({ where: { email: platformEmail } });
    const changeLog = await ownerPrisma.platformAuditLog.findFirst({
      where: { entityType: 'PlatformUser', action: 'CHANGE_PASSWORD', platformUserId: acting.id },
    });
    expect(changeLog).not.toBeNull();
  });

  it('exports hospitals and subscriptions as CSV using the same fields already shown in the tables', async () => {
    const hospitalsCsv = await req('GET', '/platform/tenants/export.csv', platformToken);
    expect(hospitalsCsv.status).toBe(200);
    expect(hospitalsCsv.headers.get('content-type')).toContain('text/csv');
    const hospitalsBody = await hospitalsCsv.text();
    expect(hospitalsBody.split('\r\n')[0]).toBe(
      '"Hospital","Status","Users","Patients","Monthly revenue (NGN)","Last activity","Joined"',
    );
    expect(hospitalsBody).toContain('Direct Hospital');

    const subsCsv = await req('GET', '/platform/subscriptions/export.csv', platformToken);
    expect(subsCsv.status).toBe(200);
    expect(subsCsv.headers.get('content-type')).toContain('text/csv');
    const subsBody = await subsCsv.text();
    expect(subsBody.split('\r\n')[0]).toBe(
      '"Hospital","Status","Billing cycle","Monthly price (NGN)","Annual price (NGN)","Renews / trial ends"',
    );
  });
});
