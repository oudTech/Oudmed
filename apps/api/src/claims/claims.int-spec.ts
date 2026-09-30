import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../common/audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { BillingModule } from '../billing/billing.module';
import { BillingService } from '../billing/billing.service';
import { ClaimsModule } from './claims.module';
import { ClaimsService } from './claims.service';
import {
  actorFor,
  destroyTenant,
  makePatient,
  makeTenant,
  makeUser,
  makeVisit,
  ownerPrisma,
} from '../../test/int-helpers';

describe('ClaimsService (integration - remittance reconciliation)', () => {
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
        data: { tenantId, name: 'Test HMO', kind: 'HMO', defaultCoPayPct: 10 },
      })
    ).id;
  });

  afterAll(async () => {
    await destroyTenant(tenantId);
    await prisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  async function claimableVisit() {
    const patient = await makePatient(tenantId, { hmoNumber: 'M-123', insuranceProviderId: providerId });
    const visit = await makeVisit(tenantId, patient.id, {
      payerType: 'HMO', hmoName: 'Test HMO', insuranceProviderId: providerId,
    });
    const { invoiceId } = await prisma.forTenant(tenantId, (tx) =>
      billing.postChargeToVisit(tx, {
        tenantId, userId, visitId: visit.id, patientId: patient.id,
        description: 'Consultation', quantity: 1, unitPrice: 10000, category: 'Consultation',
      }),
    );
    return { visit, invoiceId };
  }

  it('generate applies the co-pay split and mirrors the invoice lines', async () => {
    const { invoiceId } = await claimableVisit();
    const { created, skipped } = await claims.generate(actor, { invoiceIds: [invoiceId] });
    expect(skipped).toHaveLength(0);
    expect(created).toHaveLength(1);

    const c = await claims.getClaim(actor, created[0]);
    expect(c.status).toBe('DRAFT');
    expect(Number(c.claimedAmount)).toBe(9000); // 10000 less 10% co-pay
    expect(Number(c.patientResponsibility)).toBe(1000);
    expect(c.lines).toHaveLength(1);

    // re-running skips the already-claimed invoice
    const again = await claims.generate(actor, { invoiceIds: [invoiceId] });
    expect(again.created).toHaveLength(0);
    expect(again.skipped[0].reason).toMatch(/already exists/i);
  });

  it('remittance posts a payment on the invoice; reversal rolls it back', async () => {
    const { invoiceId: chargedInvoiceId } = await claimableVisit();
    const claimId = (await claims.generate(actor, { invoiceIds: [chargedInvoiceId] })).created[0];
    await claims.submitClaim(actor, claimId, {});

    const before = await claims.getClaim(actor, claimId);
    const invoiceId = before.invoiceId!;

    const rmt = await claims.createRemittance(actor, {
      providerId,
      receivedAmount: 8000,
      receivedAt: new Date().toISOString(),
      reference: 'RMT-TEST',
      allocations: [{ claimId, approvedAmount: 9000, paidAmount: 8000 }],
    } as any);

    const afterPay = await claims.getClaim(actor, claimId);
    expect(afterPay.status).toBe('PART_PAID');
    expect(Number(afterPay.paidAmount)).toBe(8000);

    let inv = await billing.getInvoice(tenantId, invoiceId);
    expect(inv.status).toBe('PARTIAL');
    expect(Number(inv.paidAmount)).toBe(8000);
    expect(inv.payments.some((p) => p.payerType === 'HMO' && Number(p.amount) === 8000)).toBe(true);

    await claims.reverseRemittance(actor, rmt.id, { reason: 'keyed wrong' } as any);

    const afterReverse = await claims.getClaim(actor, claimId);
    expect(afterReverse.status).toBe('SUBMITTED');
    expect(Number(afterReverse.paidAmount)).toBe(0);
    inv = await billing.getInvoice(tenantId, invoiceId);
    expect(inv.status).toBe('UNPAID');
    expect(Number(inv.paidAmount)).toBe(0);
  });

  it('write-off closes the claim and posts a negative adjustment line', async () => {
    const { invoiceId: chargedInvoiceId } = await claimableVisit();
    const claimId = (await claims.generate(actor, { invoiceIds: [chargedInvoiceId] })).created[0];
    await claims.submitClaim(actor, claimId, {});

    const c = await claims.getClaim(actor, claimId);
    const invoiceId = c.invoiceId!;
    const totalBefore = Number((await billing.getInvoice(tenantId, invoiceId)).totalAmount);

    await claims.writeOffClaim(actor, claimId, { reason: 'HMO out of contract' } as any);

    const after = await claims.getClaim(actor, claimId);
    expect(after.status).toBe('WRITTEN_OFF');
    expect(Number(after.outstanding)).toBe(0);

    const inv = await billing.getInvoice(tenantId, invoiceId);
    expect(Number(inv.totalAmount)).toBe(totalBefore - 9000);
    expect(inv.lines.some((l) => l.category === 'HMO Adjustment' && Number(l.lineTotal) === -9000)).toBe(true);
  });

  it('FUNC-2: receivables aging counts a supplementary invoice\'s claim separately, no double-count and none missed', async () => {
    const before = await claims.receivables(actor);
    const patient = await makePatient(tenantId, { hmoNumber: 'M-456', insuranceProviderId: providerId });
    const visit = await makeVisit(tenantId, patient.id, {
      payerType: 'HMO', hmoName: 'Test HMO', insuranceProviderId: providerId,
    });
    const { invoiceId: originalId } = await prisma.forTenant(tenantId, (tx) =>
      billing.postChargeToVisit(tx, {
        tenantId, userId, visitId: visit.id, patientId: patient.id,
        description: 'Consultation', quantity: 1, unitPrice: 10000, category: 'Consultation',
      }),
    );
    const originalClaimId = (await claims.generate(actor, { invoiceIds: [originalId] })).created[0];
    await claims.submitClaim(actor, originalClaimId, {});

    // lock the original with a claim already exists; a further charge must
    // land on a supplementary invoice, which can carry its own claim
    const { invoiceId: supplementId } = await prisma.forTenant(tenantId, (tx) =>
      billing.postChargeToVisit(tx, {
        tenantId, userId, visitId: visit.id, patientId: patient.id,
        description: 'Late lab order', quantity: 1, unitPrice: 5000, category: 'Laboratory',
      }),
    );
    expect(supplementId).not.toBe(originalId);
    const supplementClaimId = (await claims.generate(actor, { invoiceIds: [supplementId] })).created[0];
    await claims.submitClaim(actor, supplementClaimId, {});

    const originalClaim = await claims.getClaim(actor, originalClaimId);
    const supplementClaim = await claims.getClaim(actor, supplementClaimId);

    const after = await claims.receivables(actor);
    const delta = Number(after.totals.outstanding) - Number(before.totals.outstanding);
    const expectedDelta = Number(originalClaim.outstanding) + Number(supplementClaim.outstanding);
    expect(delta).toBeCloseTo(expectedDelta, 2);
    // sanity: both claims are genuinely distinct and both counted (not the same claim twice)
    expect(originalClaimId).not.toBe(supplementClaimId);
    expect(Number(originalClaim.outstanding)).toBeGreaterThan(0);
    expect(Number(supplementClaim.outstanding)).toBeGreaterThan(0);
  });
});
