import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { StorageModule } from '../storage/storage.module';
import { AuditModule } from '../common/audit/audit.module';
import { EmailModule } from '../email/email.module';
import { TenantsModule } from './tenants.module';
import { TenantsService } from './tenants.service';
import { TokensService } from '../auth/tokens.service';
import { destroyTenant, ownerPrisma, uniqueSlug } from '../../test/int-helpers';

/**
 * Every real hospital sign-up goes through TenantsService.createFromPending.
 * This must never leave a tenant without a subscription row, even for an
 * instant - the whole billing model depends on that row existing.
 */
describe('Tenant sign-up -> subscription (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenants: TenantsService;
  let tokens: TokensService;
  let tenantId: string | undefined;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, StorageModule, AuditModule, EmailModule, TenantsModule],
    }).compile();

    app = mod.createNestApplication();
    await app.init();
    prisma = mod.get(PrismaService);
    tenants = mod.get(TenantsService);
    tokens = mod.get(TokensService);
  });

  afterAll(async () => {
    if (tenantId) await destroyTenant(tenantId);
    await app.close();
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  it('creates a TRIALING subscription in the same transaction as the tenant and its admin user', async () => {
    const email = `${uniqueSlug('signup')}@int.test`;
    const pending = await ownerPrisma.pendingRegistration.create({
      data: {
        email,
        passwordHash: 'x',
        fullName: 'Signup Tester',
        codeHash: 'x',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        verifiedAt: new Date(),
      },
    });
    const pendingToken = tokens.issuePending({ id: pending.id, email: pending.email });

    const result = await tenants.createFromPending(pendingToken, {
      name: `Signup Test Hospital ${uniqueSlug()}`,
      facilityType: 'HOSPITAL',
      country: 'NG',
    });

    const tenant = await ownerPrisma.tenant.findUnique({ where: { slug: result.tenant.slug } });
    expect(tenant).not.toBeNull();
    tenantId = tenant!.id;

    const sub = await ownerPrisma.subscription.findUnique({ where: { tenantId: tenant!.id } });
    expect(sub).not.toBeNull();
    expect(sub!.status).toBe('TRIALING');
    expect(sub!.billingCycle).toBe('MONTHLY');
    const daysUntilTrialEnd = (sub!.trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysUntilTrialEnd).toBeGreaterThan(13.9);
    expect(daysUntilTrialEnd).toBeLessThanOrEqual(14);
  });
});
