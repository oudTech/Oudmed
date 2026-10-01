import { INestApplication, ValidationPipe, ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../common/audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { BillingModule } from '../billing/billing.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PatientsModule } from './patients.module';
import { EncountersModule } from '../encounters/encounters.module';
import { destroyTenant, makeTenant, makeUser } from '../../test/int-helpers';

/**
 * Known issue #2 retest: "Patient registration steps 1-2 show an error even
 * with valid input." No literal tester repro values were ever recorded - the
 * bug report was a one-line symptom - so this drives the real wizard sequence
 * (dedupe -> create "Personal" -> "Emergency" -> "Medical") through the actual
 * HTTP + global ValidationPipe stack, exactly as apps/web's wizard calls it,
 * with the string-typed numeric fields `numericText()` sends.
 *
 * The one concrete, reproducible bug found nearby was FUNC-4 (step 4,
 * "Medical information": heightCm/weightKg sent as strings, rejected by the
 * DTO with no coercion) - now fixed. No defect was found in steps 1-3; this
 * test's main job is to prove the whole sequence no longer breaks anywhere,
 * end to end, through the real pipe (not just an isolated DTO validate()).
 */
describe('Patient registration wizard (known issue #2 retest)', () => {
  let app: INestApplication;
  let base: string;
  let tenantId: string;
  let reception: { tenantId: string; userId: string; role: string };

  const req = (method: string, path: string, body?: unknown) =>
    fetch(`${base}/api${path}`, {
      method,
      headers: {
        'x-test-user': JSON.stringify({
          ...reception,
          tenantSlug: 't',
          email: 'reception@int.test',
          fullName: 'Reception',
        }),
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, StorageModule, BillingModule, PatientsModule, EncountersModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const r = ctx.switchToHttp().getRequest();
          const hdr = r.headers['x-test-user'];
          if (!hdr) return false;
          r.user = JSON.parse(Array.isArray(hdr) ? hdr[0] : hdr);
          return true;
        },
      })
      .compile();

    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    // Same config as apps/api/src/main.ts - deliberately without
    // enableImplicitConversion, which is exactly what made FUNC-4 possible.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.listen(0);
    base = await app.getUrl();

    tenantId = (await makeTenant()).id;
    reception = { tenantId, userId: (await makeUser(tenantId, 'RECEPTIONIST')).id, role: 'RECEPTIONIST' };
  });

  afterAll(async () => {
    await destroyTenant(tenantId);
    await app.close();
  });

  it('completes steps 1 (dedupe) through 4 (medical) with the wizard\'s real string-typed payloads', async () => {
    // Step 1: "Find existing" dedupe check - no record created yet.
    const dedupe = await req('POST', '/patients/check-duplicates', {
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '08012345678',
      dateOfBirth: '1990-05-14',
    });
    expect(dedupe.status).toBe(201);

    // Step 2: "Personal" - creates the record.
    const create = await req('POST', '/patients', {
      firstName: 'Ada',
      lastName: 'Lovelace',
      gender: 'Female',
      dateOfBirth: '1990-05-14',
      phone: '08012345678',
      email: 'ada@example.com',
      address: '1 Analytical Engine Way',
      city: 'Lagos',
      state: 'Lagos',
      country: 'NG',
    });
    expect(create.status).toBe(201);
    const patient = (await create.json()) as { id: string; patientNumber: string };
    expect(patient.patientNumber).toMatch(/^PT-\d{5}$/);

    // Step 3: "Emergency contact".
    const emergency = await req('PATCH', `/patients/${patient.id}`, {
      emergencyContactName: 'Lord Byron',
      emergencyContactRelationship: 'Father',
      emergencyContactPhone: '08099999999',
      reachedStep: 3,
    });
    expect(emergency.status).toBe(200);

    // Step 4: "Medical information" - heightCm/weightKg arrive as strings,
    // exactly as @oudhealth/validation's numericText() sends them.
    const medical = await req('PATCH', `/patients/${patient.id}`, {
      bloodGroup: 'O',
      rhFactor: 'POSITIVE',
      heightCm: '172',
      weightKg: '68.5',
      reachedStep: 4,
    });
    expect(medical.status).toBe(200);
    const updated = (await medical.json()) as { heightCm: number; weightKg: string };
    expect(updated.heightCm).toBe(172);
    expect(Number(updated.weightKg)).toBe(68.5);
  });

  it('a paediatric decimal weight ("3.4") also survives the real pipe end to end', async () => {
    const create = await req('POST', '/patients', { firstName: 'Baby', lastName: 'Lovelace' });
    const patient = (await create.json()) as { id: string };

    const medical = await req('PATCH', `/patients/${patient.id}`, {
      heightCm: '50',
      weightKg: '3.4',
      reachedStep: 4,
    });
    expect(medical.status).toBe(200);
    const updated = (await medical.json()) as { weightKg: string };
    expect(Number(updated.weightKg)).toBe(3.4);
  });
});
