import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../common/audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { BillingModule } from '../billing/billing.module';
import { BillingService } from '../billing/billing.service';
import { ScheduleModule } from '../schedule/schedule.module';
import { ScheduleService } from '../schedule/schedule.service';
import { ClaimsModule } from './claims.module';
import { ClaimsService } from './claims.service';
import {
  actorFor,
  destroyTenant,
  makePatient,
  makeTenant,
  makeUser,
  ownerPrisma,
} from '../../test/int-helpers';

/**
 * Fix 2 of the "HMO claims not reflecting" investigation (2026-10-08,
 * docs/audit/phase1-status.md): ClaimsService.generate() read coPayPct
 * only through visit.insuranceProvider (keyed off Visit.insuranceProviderId,
 * which was always null - see Fix 1), while providerId itself had a
 * separate, working fallback to the patient's own link. The result: a
 * correctly-identified provider's co-pay silently dropped to 0% - every
 * outpatient HMO claim billed 100% to the insurer. Deliberately goes
 * through the real ScheduleService (not the makeVisit fixture, which sets
 * Visit.insuranceProviderId directly and would hide this exact bug).
 */
describe('ClaimsService.generate - co-pay resolution for a real booking-flow visit (integration)', () => {
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

  it('applies the provider\'s real configured co-pay, not 0%, for a visit booked through the real flow', async () => {
    const provider = await ownerPrisma.insuranceProvider.create({
      data: { tenantId, name: 'Real Flow HMO', kind: 'HMO', defaultCoPayPct: 12 },
    });
    const patient = await makePatient(tenantId, { insuranceProviderId: provider.id, hmoName: 'Real Flow HMO' });

    const visit = await schedule.create(actor, {
      patientId: patient.id,
      startsAt: new Date().toISOString(),
      payerType: 'HMO' as any,
    } as any);
    // sanity: Fix 1 is what makes this possible at all
    expect(visit.insuranceProviderId).toBe(provider.id);

    const { invoiceId } = await prisma.forTenant(tenantId, (tx) =>
      billing.postChargeToVisit(tx, {
        tenantId, userId: actor.userId, visitId: visit.id, patientId: patient.id,
        description: 'Consultation', quantity: 1, unitPrice: 10000, category: 'Consultation',
      }),
    );
    await prisma.forTenant(tenantId, (tx) => tx.visit.update({ where: { id: visit.id }, data: { status: 'COMPLETED' } }));

    const { created, skipped } = await claims.generate(actor, { invoiceIds: [invoiceId] });
    expect(skipped).toHaveLength(0);
    expect(created).toHaveLength(1);

    const claim = await claims.getClaim(actor, created[0]);
    // 12% co-pay -> 88% claimed. Before the fix this was 10000/0 (100%/0%).
    expect(Number(claim.claimedAmount)).toBe(8800);
    expect(Number(claim.patientResponsibility)).toBe(1200);
  });

  it('a provider resolved only via a unique hmoName match also gets its real co-pay, not 0%', async () => {
    const provider = await ownerPrisma.insuranceProvider.create({
      data: { tenantId, name: 'Name Match Copay HMO', kind: 'HMO', defaultCoPayPct: 40 },
    });
    const patient = await makePatient(tenantId, { hmoName: 'Name Match Copay HMO' }); // no direct link

    const visit = await schedule.create(actor, {
      patientId: patient.id,
      startsAt: new Date().toISOString(),
      payerType: 'HMO' as any,
      hmoName: 'Name Match Copay HMO',
    } as any);
    expect(visit.insuranceProviderId).toBe(provider.id);

    const { invoiceId } = await prisma.forTenant(tenantId, (tx) =>
      billing.postChargeToVisit(tx, {
        tenantId, userId: actor.userId, visitId: visit.id, patientId: patient.id,
        description: 'Consultation', quantity: 1, unitPrice: 10000, category: 'Consultation',
      }),
    );
    await prisma.forTenant(tenantId, (tx) => tx.visit.update({ where: { id: visit.id }, data: { status: 'COMPLETED' } }));

    const { created } = await claims.generate(actor, { invoiceIds: [invoiceId] });
    const claim = await claims.getClaim(actor, created[0]);
    expect(Number(claim.claimedAmount)).toBe(6000); // 60% claimed, 40% co-pay
    expect(Number(claim.patientResponsibility)).toBe(4000);
  });
});
