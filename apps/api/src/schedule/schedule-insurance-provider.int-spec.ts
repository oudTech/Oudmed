import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../common/audit/audit.module';
import { BillingModule } from '../billing/billing.module';
import { BillingService } from '../billing/billing.service';
import { ScheduleModule } from './schedule.module';
import { ScheduleService } from './schedule.service';
import { ClaimsModule } from '../claims/claims.module';
import { ClaimsService } from '../claims/claims.service';
import { StorageModule } from '../storage/storage.module';
import {
  actorFor,
  destroyTenant,
  makePatient,
  makeTenant,
  makeUser,
  ownerPrisma,
} from '../../test/int-helpers';

/**
 * Fix 1 of the "HMO claims not reflecting" investigation (2026-10-08,
 * docs/audit/phase1-status.md): ScheduleService.create/update never
 * populated Visit.insuranceProviderId, only the free-text payerType/
 * hmoName, which broke the claims-generation provider filter. Deliberately
 * goes through the real ScheduleService (not the makeVisit test fixture,
 * which sets the FK directly via Prisma and would hide this exact bug).
 */
describe('ScheduleService - insurance provider resolution (integration)', () => {
  let prisma: PrismaService;
  let schedule: ScheduleService;
  let claims: ClaimsService;
  let billing: BillingService;
  let tenantId: string;
  let actor: { tenantId: string; userId: string; role: string };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, StorageModule, BillingModule, ScheduleModule, ClaimsModule],
    }).compile();
    prisma = mod.get(PrismaService);
    schedule = mod.get(ScheduleService);
    claims = mod.get(ClaimsService);
    billing = mod.get(BillingService);

    const tenant = await makeTenant();
    tenantId = tenant.id;
    const userId = (await makeUser(tenantId)).id;
    actor = actorFor(tenantId, userId);
  });

  afterAll(async () => {
    await destroyTenant(tenantId);
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  it('resolves the patient\'s own linked provider onto the visit, and the claims provider filter then finds it', async () => {
    const provider = await ownerPrisma.insuranceProvider.create({
      data: { tenantId, name: 'Direct Link HMO', kind: 'HMO', defaultCoPayPct: 15 },
    });
    const patient = await makePatient(tenantId, { insuranceProviderId: provider.id, hmoName: 'Direct Link HMO' });

    const visit = await schedule.create(actor, {
      patientId: patient.id,
      startsAt: new Date().toISOString(),
      payerType: 'HMO' as any,
    } as any);

    expect(visit.insuranceProviderId).toBe(provider.id);

    // This is the exact symptom reported: filtering the "Generate claims"
    // picker by this specific provider must find the invoice. Before Fix 1,
    // Visit.insuranceProviderId was always null, so eligibleVisits'
    // providerId filter (applied against that column) excluded every real,
    // eligible invoice the moment a provider filter was used.
    const { invoiceId } = await prisma.forTenant(tenantId, (tx) =>
      billing.postChargeToVisit(tx, {
        tenantId, userId: actor.userId, visitId: visit.id, patientId: patient.id,
        description: 'Consultation', quantity: 1, unitPrice: 8000, category: 'Consultation',
      }),
    );
    await prisma.forTenant(tenantId, (tx) => tx.visit.update({ where: { id: visit.id }, data: { status: 'COMPLETED' } }));

    const eligible = await claims.eligibleVisits(actor, { providerId: provider.id } as any);
    expect(eligible.some((e: any) => e.invoiceId === invoiceId)).toBe(true);

    const unrelated = await claims.eligibleVisits(actor, {} as any);
    expect(unrelated.some((e: any) => e.invoiceId === invoiceId)).toBe(true);
  });

  it('resolves via a unique case-insensitive hmoName match when the patient has no direct link', async () => {
    const provider = await ownerPrisma.insuranceProvider.create({
      data: { tenantId, name: 'Name Match HMO', kind: 'HMO', defaultCoPayPct: 20 },
    });
    const patient = await makePatient(tenantId, { hmoName: 'name match hmo' }); // lower-case, no insuranceProviderId

    const visit = await schedule.create(actor, {
      patientId: patient.id,
      startsAt: new Date().toISOString(),
      payerType: 'HMO' as any,
      hmoName: 'name match hmo',
    } as any);

    expect(visit.insuranceProviderId).toBe(provider.id);
  });

  it('leaves insuranceProviderId null (never guesses) when the name matches more than one active provider', async () => {
    // (tenantId, name) is unique at the DB level, but only case-sensitively -
    // two providers differing only by case is exactly the realistic way an
    // ambiguous match happens (two staff members entering the same payer
    // independently), and the resolver matches case-insensitively.
    await ownerPrisma.insuranceProvider.create({ data: { tenantId, name: 'Dup HMO', kind: 'HMO', defaultCoPayPct: 10 } });
    await ownerPrisma.insuranceProvider.create({ data: { tenantId, name: 'DUP HMO', kind: 'HMO', defaultCoPayPct: 25 } });
    const patient = await makePatient(tenantId, { hmoName: 'Dup HMO' });

    const visit = await schedule.create(actor, {
      patientId: patient.id,
      startsAt: new Date().toISOString(),
      payerType: 'HMO' as any,
      hmoName: 'Dup HMO',
    } as any);

    expect(visit.insuranceProviderId).toBeNull();
  });

  it('leaves insuranceProviderId null when there is no match at all', async () => {
    const patient = await makePatient(tenantId, { hmoName: 'Totally Unknown HMO' });

    const visit = await schedule.create(actor, {
      patientId: patient.id,
      startsAt: new Date().toISOString(),
      payerType: 'HMO' as any,
      hmoName: 'Totally Unknown HMO',
    } as any);

    expect(visit.insuranceProviderId).toBeNull();
  });

  it('update() re-resolves the provider only when payerType/hmoName actually changes', async () => {
    const providerA = await ownerPrisma.insuranceProvider.create({
      data: { tenantId, name: 'Update HMO A', kind: 'HMO', defaultCoPayPct: 5 },
    });
    const providerB = await ownerPrisma.insuranceProvider.create({
      data: { tenantId, name: 'Update HMO B', kind: 'HMO', defaultCoPayPct: 8 },
    });
    // No direct patient link on purpose - the patient's own link always
    // wins over a name guess (tested above), so re-resolution-on-change is
    // only observable through the name-match path.
    const patient = await makePatient(tenantId, { hmoName: 'Update HMO A' });
    const visit = await schedule.create(actor, {
      patientId: patient.id, startsAt: new Date().toISOString(), payerType: 'HMO' as any, hmoName: 'Update HMO A',
    } as any);
    expect(visit.insuranceProviderId).toBe(providerA.id);

    // Unrelated edit - provider link must stay exactly as resolved.
    const afterUnrelatedEdit = await schedule.update(actor, visit.id, { reason: 'follow-up' } as any);
    expect(afterUnrelatedEdit.insuranceProviderId).toBe(providerA.id);

    // Switching the hmoName must re-resolve to the new provider.
    const afterHmoChange = await schedule.update(actor, visit.id, { hmoName: 'Update HMO B' } as any);
    expect(afterHmoChange.insuranceProviderId).toBe(providerB.id);
  });
});
