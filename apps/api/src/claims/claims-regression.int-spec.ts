import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../common/audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { BillingModule } from '../billing/billing.module';
import { BillingService } from '../billing/billing.service';
import { ClaimsModule } from './claims.module';
import { ClaimsService } from './claims.service';
import { actorFor, destroyTenant, makePatient, makeTenant, makeUser, makeVisit, ownerPrisma } from '../../test/int-helpers';

/**
 * F1d: the full outpatient regression the brief asked for - claim generate
 * -> batch -> CSV -> remittance -> write-off -> aging - run once as an
 * uninterrupted chain and checked against values computed independently of
 * the F1d code path, so the generalised remittance/write-off logic
 * (resolveClaimInvoices/splitProportionally, built so F1d's admission claims
 * could span more than one invoice) is proven not to have changed a single
 * outpatient number along the way.
 */
describe('ClaimsService full outpatient regression (integration - F1d)', () => {
  let prisma: PrismaService;
  let claims: ClaimsService;
  let billing: BillingService;
  let tenantId: string;
  let userId: string;
  let actor: { tenantId: string; userId: string; role: string };
  let providerId: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, StorageModule, BillingModule, ClaimsModule],
    }).compile();
    prisma = mod.get(PrismaService);
    claims = mod.get(ClaimsService);
    billing = mod.get(BillingService);

    const tenant = await makeTenant();
    tenantId = tenant.id;
    userId = (await makeUser(tenantId)).id;
    actor = actorFor(tenantId, userId);
    providerId = (
      await ownerPrisma.insuranceProvider.create({
        data: { tenantId, name: 'Regression HMO', kind: 'HMO', defaultCoPayPct: 10 },
      })
    ).id;
  });

  afterAll(async () => {
    await destroyTenant(tenantId);
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  async function claimableVisit(amount: number, memberNumber: string) {
    const patient = await makePatient(tenantId, { hmoNumber: memberNumber, insuranceProviderId: providerId });
    const visit = await makeVisit(tenantId, patient.id, {
      payerType: 'HMO', hmoName: 'Regression HMO', insuranceProviderId: providerId,
    });
    const { invoiceId } = await prisma.forTenant(tenantId, (tx) =>
      billing.postChargeToVisit(tx, {
        tenantId, userId, visitId: visit.id, patientId: patient.id,
        description: 'Consultation', quantity: 1, unitPrice: amount, category: 'Consultation',
      }),
    );
    return { patient, visit, invoiceId };
  }

  it('generate -> batch -> CSV -> remittance -> write-off -> aging, chained, matches hand-computed expectations throughout', async () => {
    const agingBefore = await claims.receivables(actor);

    // ── 1. generate: two claims, 10% co-pay on each ──
    const claimA = await claimableVisit(10000, 'REG-A'); // claimed 9000, patient 1000
    const claimB = await claimableVisit(5000, 'REG-B'); // claimed 4500, patient 500
    const { created: createdA, skipped: skippedA } = await claims.generate(actor, { invoiceIds: [claimA.invoiceId] });
    const { created: createdB, skipped: skippedB } = await claims.generate(actor, { invoiceIds: [claimB.invoiceId] });
    expect(skippedA).toHaveLength(0);
    expect(skippedB).toHaveLength(0);
    const [claimAId] = createdA;
    const [claimBId] = createdB;

    const genA = await claims.getClaim(actor, claimAId);
    const genB = await claims.getClaim(actor, claimBId);
    expect(Number(genA.claimedAmount)).toBe(9000);
    expect(Number(genA.patientResponsibility)).toBe(1000);
    expect(Number(genB.claimedAmount)).toBe(4500);
    expect(Number(genB.patientResponsibility)).toBe(500);

    // ── 2. batch: both claims onto one batch for the provider ──
    const batch = await claims.createBatch(actor, {
      providerId,
      periodStart: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
      periodEnd: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      claimIds: [claimAId, claimBId],
    } as any);
    expect(batch.claimCount).toBe(2);
    expect(Number(batch.claimedTotal)).toBe(13500); // 9000 + 4500

    const submittedBatch = await claims.submitBatch(actor, batch.id, {} as any);
    expect(submittedBatch.status).toBe('SUBMITTED');
    const afterSubmitA = await claims.getClaim(actor, claimAId);
    const afterSubmitB = await claims.getClaim(actor, claimBId);
    expect(afterSubmitA.status).toBe('SUBMITTED');
    expect(afterSubmitB.status).toBe('SUBMITTED');

    // ── 3. CSV export: both claims present with their claimed amounts ──
    const csv = await claims.batchCsv(actor, batch.id);
    expect(csv).toContain('REG-A');
    expect(csv).toContain('REG-B');
    expect(csv).toContain('9000');
    expect(csv).toContain('4500');

    // ── 4. remittance: claim A paid in full ──
    const rmt = await claims.createRemittance(actor, {
      providerId,
      receivedAmount: 9000,
      receivedAt: new Date().toISOString(),
      reference: 'RMT-REGRESSION',
      allocations: [{ claimId: claimAId, approvedAmount: 9000, paidAmount: 9000 }],
    } as any);
    expect(Number(rmt.allocatedAmount)).toBe(9000);

    const paidA = await claims.getClaim(actor, claimAId);
    expect(paidA.status).toBe('PAID');
    expect(Number(paidA.paidAmount)).toBe(9000);
    expect(Number(paidA.outstanding)).toBe(0);
    const invA = await billing.getInvoice(tenantId, claimA.invoiceId);
    expect(invA.status).toBe('PARTIAL'); // the HMO's 9000 is paid; the patient's own 1000 co-pay is not
    expect(Number(invA.paidAmount)).toBe(9000);
    expect(invA.payments.some((p) => p.payerType === 'HMO' && Number(p.amount) === 9000)).toBe(true);

    // ── 5. write-off: claim B entirely (HMO out of contract) ──
    const invBBefore = await billing.getInvoice(tenantId, claimB.invoiceId);
    const totalBBefore = Number(invBBefore.totalAmount);
    await claims.writeOffClaim(actor, claimBId, { reason: 'HMO out of contract' } as any);

    const writtenOffB = await claims.getClaim(actor, claimBId);
    expect(writtenOffB.status).toBe('WRITTEN_OFF');
    expect(Number(writtenOffB.outstanding)).toBe(0);
    const invB = await billing.getInvoice(tenantId, claimB.invoiceId);
    expect(Number(invB.totalAmount)).toBe(totalBBefore - 4500);
    expect(invB.lines.some((l) => l.category === 'HMO Adjustment' && Number(l.lineTotal) === -4500)).toBe(true);

    // ── 6. aging: both claims now resolved, outstanding returns to baseline ──
    const agingAfter = await claims.receivables(actor);
    expect(Number(agingAfter.totals.outstanding)).toBeCloseTo(Number(agingBefore.totals.outstanding), 2);

    // ── independent cross-check: every number above by hand ──
    expect(Number(paidA.paidAmount) + Number(writtenOffB.writeOffAmount)).toBe(13500); // the whole claimed total resolved
  });
});
