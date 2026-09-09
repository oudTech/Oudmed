import { INestApplication, ValidationPipe, ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../common/audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PharmacyModule } from './pharmacy.module';
import { EncountersModule } from '../encounters/encounters.module';
import { destroyTenant, makeTenant, makeUser, ownerPrisma } from '../../test/int-helpers';

/**
 * Wave A: pharmacy + lab worklist authorization.
 *  - dispensing queue  -> prescription:dispense
 *  - drug inventory / stats / detail -> pharmacy:manage
 *  - drug search (formulary autocomplete) -> pharmacy:manage OR prescription:write
 *  - lab worklist -> order:result
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

describe('Pharmacy + Lab worklist authorization (integration - HTTP)', () => {
  let app: INestApplication;
  let base: string;
  let prisma: PrismaService;

  let tenantA: string;
  const who: Record<string, Who> = {};
  let drugId: string;

  let pharmB: Who;
  let drugB: string;

  const req = (method: string, path: string, w: Who) =>
    fetch(`${base}/api${path}`, { method, headers: { 'x-test-user': JSON.stringify(auth(w)) } });

  const mkDrug = (tenantId: string) =>
    ownerPrisma.drug.create({
      data: {
        tenantId, sku: `MED-${Math.random().toString(36).slice(2, 8)}`, name: 'Paracetamol',
        sellPrice: 100, quantityOnHand: 10,
      },
    });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, StorageModule, PharmacyModule, EncountersModule],
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
    for (const role of ['PHARMACIST', 'HOSPITAL_ADMIN', 'SUPER_ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST', 'LAB_STAFF', 'ACCOUNTANT']) {
      who[role] = { tenantId: tenantA, userId: (await makeUser(tenantA, role)).id, role };
    }
    drugId = (await mkDrug(tenantA)).id;

    const tB = (await makeTenant()).id;
    pharmB = { tenantId: tB, userId: (await makeUser(tB, 'PHARMACIST')).id, role: 'PHARMACIST' };
    drugB = (await mkDrug(tB)).id;
  });

  afterAll(async () => {
    await app.close();
    await destroyTenant(tenantA);
    await destroyTenant(pharmB.tenantId);
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  it('dispensing queue: pharmacist/admin 200, everyone else 403', async () => {
    expect((await req('GET', '/pharmacy/queue', who.PHARMACIST)).status).toBe(200);
    expect((await req('GET', '/pharmacy/queue', who.HOSPITAL_ADMIN)).status).toBe(200);
    for (const r of ['DOCTOR', 'NURSE', 'RECEPTIONIST', 'LAB_STAFF', 'ACCOUNTANT']) {
      expect((await req('GET', '/pharmacy/queue', who[r])).status).toBe(403);
    }
  });

  it('drug inventory / stats / detail: pharmacy:manage only', async () => {
    for (const path of ['/pharmacy/drugs', '/pharmacy/drugs/stats', `/pharmacy/drugs/${drugId}`]) {
      expect((await req('GET', path, who.PHARMACIST)).status).toBe(200);
      expect((await req('GET', path, who.DOCTOR)).status).toBe(403);
      expect((await req('GET', path, who.RECEPTIONIST)).status).toBe(403);
    }
  });

  it('drug search: pharmacist AND prescriber (doctor) allowed; nurse / accountant not', async () => {
    expect((await req('GET', '/pharmacy/drugs/search?q=para', who.PHARMACIST)).status).toBe(200);
    expect((await req('GET', '/pharmacy/drugs/search?q=para', who.DOCTOR)).status).toBe(200);
    expect((await req('GET', '/pharmacy/drugs/search?q=para', who.NURSE)).status).toBe(403);
    expect((await req('GET', '/pharmacy/drugs/search?q=para', who.ACCOUNTANT)).status).toBe(403);
  });

  it('lab worklist: order:result roles only', async () => {
    expect((await req('GET', '/lab/worklist', who.LAB_STAFF)).status).toBe(200);
    expect((await req('GET', '/lab/worklist', who.DOCTOR)).status).toBe(200);
    expect((await req('GET', '/lab/worklist', who.HOSPITAL_ADMIN)).status).toBe(200);
    expect((await req('GET', '/lab/worklist', who.NURSE)).status).toBe(403);
    expect((await req('GET', '/lab/worklist', who.PHARMACIST)).status).toBe(403);
    expect((await req('GET', '/lab/worklist', who.RECEPTIONIST)).status).toBe(403);
  });

  it('cross-tenant drug read returns 404, never 403', async () => {
    expect((await req('GET', `/pharmacy/drugs/${drugId}`, pharmB)).status).toBe(404);
    expect((await req('GET', `/pharmacy/drugs/${drugB}`, who.PHARMACIST)).status).toBe(404);
  });
});
