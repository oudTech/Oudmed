import { INestApplication, ValidationPipe, ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../common/audit/audit.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { StaffModule } from './staff.module';
import { destroyTenant, makeTenant, makeUser, ownerPrisma } from '../../test/int-helpers';

/**
 * B1: the staff directory (`GET /staff`, `GET /staff/:id`) is HR data - contact
 * details, free-text notes, role, login activity. It must require `staff:manage`
 * (HOSPITAL_ADMIN / SUPER_ADMIN), enforced at the service boundary, not just the
 * UI. Cross-tenant lookups stay 404.
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

const ALLOWED = ['HOSPITAL_ADMIN', 'SUPER_ADMIN'];
const DENIED = ['DOCTOR', 'NURSE', 'RECEPTIONIST', 'PHARMACIST', 'LAB_STAFF', 'ACCOUNTANT'];

describe('Staff directory authorization (integration - HTTP)', () => {
  let app: INestApplication;
  let base: string;
  let prisma: PrismaService;

  let tenantA: string;
  const who: Record<string, Who> = {};

  let adminB: Who;
  let staffBId: string;

  const req = (method: string, path: string, w: Who) =>
    fetch(`${base}/api${path}`, { method, headers: { 'x-test-user': JSON.stringify(auth(w)) } });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, StaffModule],
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
    for (const role of [...ALLOWED, ...DENIED]) {
      who[role] = { tenantId: tenantA, userId: (await makeUser(tenantA, role)).id, role };
    }

    const tB = (await makeTenant()).id;
    adminB = { tenantId: tB, userId: (await makeUser(tB, 'HOSPITAL_ADMIN')).id, role: 'HOSPITAL_ADMIN' };
    staffBId = (await makeUser(tB, 'NURSE')).id;
  });

  afterAll(async () => {
    await app.close();
    await destroyTenant(tenantA);
    await destroyTenant(adminB.tenantId);
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  it('GET /staff: staff-management roles 200, every other authenticated role 403', async () => {
    for (const r of ALLOWED) {
      expect((await req('GET', '/staff', who[r])).status).toBe(200);
    }
    for (const r of DENIED) {
      expect((await req('GET', '/staff', who[r])).status).toBe(403);
    }
  });

  it('GET /staff/:id: staff-management roles 200, every other authenticated role 403', async () => {
    const target = who.DOCTOR.userId;
    for (const r of ALLOWED) {
      expect((await req('GET', `/staff/${target}`, who[r])).status).toBe(200);
    }
    for (const r of DENIED) {
      expect((await req('GET', `/staff/${target}`, who[r])).status).toBe(403);
    }
  });

  it('an admin only sees their own tenant\'s staff', async () => {
    const res = await req('GET', '/staff', adminB);
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids: string[] = body.staff.map((s: any) => s.id);
    expect(ids).toContain(staffBId);
    expect(ids).not.toContain(who.DOCTOR.userId); // tenant A user
  });

  it('cross-tenant GET /staff/:id is 404 (never another tenant\'s data, never 403)', async () => {
    const res = await req('GET', `/staff/${staffBId}`, who.HOSPITAL_ADMIN); // A admin, B staff id
    expect(res.status).toBe(404);
  });
});
