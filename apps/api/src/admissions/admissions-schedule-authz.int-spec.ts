import { INestApplication, ValidationPipe, ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../common/audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdmissionsModule } from './admissions.module';
import { ScheduleModule } from '../schedule/schedule.module';
import {
  destroyTenant,
  makePatient,
  makeTenant,
  makeUser,
  makeVisit,
  ownerPrisma,
} from '../../test/int-helpers';

/**
 * Wave A: admission and schedule reads (inpatient + appointment PHI) require
 * patient:read, matching the patient-chart policy. PHARMACIST / LAB_STAFF /
 * ACCOUNTANT are excluded; cross-tenant identifiers return 404 (RLS).
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

describe('Admissions + Schedule authorization (integration - HTTP)', () => {
  let app: INestApplication;
  let base: string;
  let prisma: PrismaService;

  let tenantA: string;
  const who: Record<string, Who> = {};
  let admissionId: string;
  let visitId: string;

  let tenantB: string;
  let userB: Who;
  let admissionB: string;
  let visitB: string;

  const req = (method: string, path: string, w: Who) =>
    fetch(`${base}/api${path}`, { method, headers: { 'x-test-user': JSON.stringify(auth(w)) } });

  async function makeAdmission(tenantId: string, patientId: string) {
    const n = Math.random().toString(36).slice(2, 8);
    return ownerPrisma.admission.create({
      data: { tenantId, patientId, admissionNumber: `ADM-IT-${n}`, status: 'ADMITTED' },
    });
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, StorageModule, AdmissionsModule, ScheduleModule],
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
    for (const role of ['RECEPTIONIST', 'NURSE', 'DOCTOR', 'HOSPITAL_ADMIN', 'SUPER_ADMIN', 'PHARMACIST', 'LAB_STAFF', 'ACCOUNTANT']) {
      who[role] = { tenantId: tenantA, userId: (await makeUser(tenantA, role)).id, role };
    }
    const patientA = await makePatient(tenantA);
    admissionId = (await makeAdmission(tenantA, patientA.id)).id;
    visitId = (await makeVisit(tenantA, patientA.id)).id;

    tenantB = (await makeTenant()).id;
    userB = { tenantId: tenantB, userId: (await makeUser(tenantB, 'HOSPITAL_ADMIN')).id, role: 'HOSPITAL_ADMIN' };
    const patientB = await makePatient(tenantB);
    admissionB = (await makeAdmission(tenantB, patientB.id)).id;
    visitB = (await makeVisit(tenantB, patientB.id)).id;
  });

  afterAll(async () => {
    await app.close();
    await destroyTenant(tenantA);
    await destroyTenant(tenantB);
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  const paths = () => [
    'GET /admissions',
    `GET /admissions/${admissionId}`,
    'GET /schedule',
    `GET /schedule/${visitId}`,
  ];

  it.each(['RECEPTIONIST', 'NURSE', 'DOCTOR', 'HOSPITAL_ADMIN', 'SUPER_ADMIN'])('%s may read (200)', async (role) => {
    for (const p of paths()) {
      const [m, path] = p.split(' ');
      expect((await req(m, path, who[role])).status).toBe(200);
    }
  });

  it.each(['PHARMACIST', 'LAB_STAFF', 'ACCOUNTANT'])('%s is forbidden (403)', async (role) => {
    for (const p of paths()) {
      const [m, path] = p.split(' ');
      const res = await req(m, path, who[role]);
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('FORBIDDEN_ACTION');
    }
  });

  it('cross-tenant admission / visit reads return 404, never 403', async () => {
    expect((await req('GET', `/admissions/${admissionB}`, who.DOCTOR)).status).toBe(404);
    expect((await req('GET', `/schedule/${visitB}`, who.DOCTOR)).status).toBe(404);
    // and the other direction: tenant B admin cannot see tenant A rows
    expect((await req('GET', `/admissions/${admissionId}`, userB)).status).toBe(404);
  });
});
