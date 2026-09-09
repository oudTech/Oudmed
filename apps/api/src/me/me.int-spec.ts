import { INestApplication, ValidationPipe, ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { MeModule } from './me.module';
import { destroyTenant, makeTenant, makeUser, ownerPrisma } from '../../test/int-helpers';

/**
 * `GET/PATCH /api/me/preferences` is the self-scoped store for UI state
 * (guided-tour progress, dismissed feature callouts). It must: start empty,
 * merge only the whitelisted keys, deep-merge `onboarding`, and only ever touch
 * the caller's own row.
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

describe('Me preferences (integration - HTTP)', () => {
  let app: INestApplication;
  let base: string;
  let prisma: PrismaService;

  let tenantA: string;
  let userA: Who;
  let otherA: Who;

  const req = (method: string, path: string, w: Who, body?: unknown) =>
    fetch(`${base}/api${path}`, {
      method,
      headers: {
        'x-test-user': JSON.stringify(auth(w)),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, MeModule],
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

    tenantA = (await makeTenant()).id;
    userA = { tenantId: tenantA, userId: (await makeUser(tenantA, 'DOCTOR')).id, role: 'DOCTOR' };
    otherA = { tenantId: tenantA, userId: (await makeUser(tenantA, 'NURSE')).id, role: 'NURSE' };
  });

  afterAll(async () => {
    await app.close();
    await destroyTenant(tenantA);
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  it('GET returns {} before anything is stored', async () => {
    const res = await req('GET', '/me/preferences', userA);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it('PATCH merges the onboarding key and echoes the stored value', async () => {
    const res = await req('PATCH', '/me/preferences', userA, {
      onboarding: { status: 'in_progress', currentTour: 'getting-around', currentStep: 2 },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.onboarding).toMatchObject({
      status: 'in_progress',
      currentTour: 'getting-around',
      currentStep: 2,
    });
  });

  it('a second PATCH deep-merges onboarding rather than replacing it', async () => {
    await req('PATCH', '/me/preferences', userA, { onboarding: { currentStep: 5 } });
    const res = await req('GET', '/me/preferences', userA);
    const body = await res.json();
    expect(body.onboarding).toMatchObject({
      status: 'in_progress', // preserved from the earlier write
      currentTour: 'getting-around',
      currentStep: 5, // updated
    });
  });

  it('drops keys that are not whitelisted', async () => {
    await req('PATCH', '/me/preferences', userA, {
      seenFeatures: ['reports-csv-export'],
      role: 'SUPER_ADMIN',
      isActive: false,
    } as Record<string, unknown>);
    const body = await (await req('GET', '/me/preferences', userA)).json();
    expect(body.seenFeatures).toEqual(['reports-csv-export']);
    expect(body.role).toBeUndefined();
    expect(body.isActive).toBeUndefined();

    // and the real user row is untouched
    const row = await ownerPrisma.user.findUnique({ where: { id: userA.userId } });
    expect(row?.role).toBe('DOCTOR');
    expect(row?.isActive).toBe(true);
  });

  it('is self-scoped: one user never sees or writes another user\'s preferences', async () => {
    const mine = await (await req('GET', '/me/preferences', otherA)).json();
    expect(mine).toEqual({}); // userA's writes are not visible here

    await req('PATCH', '/me/preferences', otherA, { onboarding: { status: 'skipped' } });

    const userAStill = await (await req('GET', '/me/preferences', userA)).json();
    expect(userAStill.onboarding.status).toBe('in_progress'); // unchanged by otherA
  });
});
