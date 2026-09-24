import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { EmailModule } from '../email/email.module';
import { StorageModule } from '../storage/storage.module';
import { AuditModule } from '../common/audit/audit.module';
import { AuthModule } from './auth.module';
import { destroyTenant, makeTenant, ownerPrisma } from '../../test/int-helpers';

/**
 * The auth audit trail (P0, 2026-09-23): every real authentication event -
 * success, failure, the unverified-email block, a password reset being
 * requested and completed - must leave an AuditLog row. This is what lets
 * "who logged in when, and how many times did this account fail" actually be
 * answered later, instead of only being visible in transient server logs.
 */
describe('Auth audit trail (integration - HTTP)', () => {
  let app: INestApplication;
  let base: string;
  let prisma: PrismaService;

  let tenantId: string;
  let tenantSlug: string;
  const password = 'Password1!';
  let activeUserId: string;
  let unverifiedUserId: string;

  const req = (path: string, body: unknown) =>
    fetch(`${base}/api${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  const auditRows = (userId: string, action: string) =>
    ownerPrisma.auditLog.findMany({ where: { userId, action } });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, EmailModule, StorageModule, AuditModule, AuthModule],
    }).compile();

    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.listen(0);
    base = await app.getUrl();
    prisma = mod.get(PrismaService);

    const tenant = await makeTenant();
    tenantId = tenant.id;
    tenantSlug = tenant.slug;

    const passwordHash = await bcrypt.hash(password, 12);
    const active = await ownerPrisma.user.create({
      data: {
        tenantId, email: 'active@int.test', fullName: 'Active User', role: 'RECEPTIONIST',
        passwordHash, isActive: true, emailVerifiedAt: new Date(),
      },
    });
    activeUserId = active.id;

    const unverified = await ownerPrisma.user.create({
      data: {
        tenantId, email: 'unverified@int.test', fullName: 'Unverified User', role: 'RECEPTIONIST',
        passwordHash, isActive: true, emailVerifiedAt: null,
      },
    });
    unverifiedUserId = unverified.id;
  });

  afterAll(async () => {
    await app.close();
    await destroyTenant(tenantId);
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  it('a successful login records LOGIN_SUCCESS against the real user and tenant', async () => {
    const res = await req('/auth/login', { tenantSlug, email: 'active@int.test', password });
    expect(res.status).toBe(201);

    const rows = await auditRows(activeUserId, 'LOGIN_SUCCESS');
    expect(rows).toHaveLength(1);
    expect(rows[0].tenantId).toBe(tenantId);
  });

  it('a wrong password records LOGIN_FAILED with the matched user id', async () => {
    const res = await req('/auth/login', { tenantSlug, email: 'active@int.test', password: 'wrong-one' });
    expect(res.status).toBe(401);

    const rows = await auditRows(activeUserId, 'LOGIN_FAILED');
    expect(rows).toHaveLength(1);
  });

  it('an unknown email records LOGIN_FAILED with no user id (never confirms the account does not exist)', async () => {
    const res = await req('/auth/login', { tenantSlug, email: 'nobody@int.test', password });
    expect(res.status).toBe(401);

    const rows = await ownerPrisma.auditLog.findMany({
      where: { tenantId, action: 'LOGIN_FAILED', userId: null },
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('correct credentials on an unverified account record LOGIN_BLOCKED_UNVERIFIED, not a success', async () => {
    const res = await req('/auth/login', { tenantSlug, email: 'unverified@int.test', password });
    expect(res.status).toBe(403);

    expect(await auditRows(unverifiedUserId, 'LOGIN_SUCCESS')).toHaveLength(0);
    expect(await auditRows(unverifiedUserId, 'LOGIN_BLOCKED_UNVERIFIED')).toHaveLength(1);
  });

  it('forgot-password for a real account records PASSWORD_RESET_REQUESTED', async () => {
    const res = await req('/auth/forgot-password', { tenantSlug, email: 'active@int.test' });
    expect(res.status).toBe(201);

    const rows = await auditRows(activeUserId, 'PASSWORD_RESET_REQUESTED');
    expect(rows).toHaveLength(1);
  });

  it('completing a password reset records PASSWORD_RESET_COMPLETED', async () => {
    const raw = 'a-known-reset-token-for-this-test';
    const tokenHash = require('crypto').createHash('sha256').update(raw).digest('hex');
    await ownerPrisma.passwordReset.create({
      data: { userId: activeUserId, tokenHash, expiresAt: new Date(Date.now() + 60_000) },
    });

    const res = await req('/auth/reset-password', { token: raw, password: 'NewPassword1!' });
    expect(res.status).toBe(201);

    const rows = await auditRows(activeUserId, 'PASSWORD_RESET_COMPLETED');
    expect(rows).toHaveLength(1);
  });
});
