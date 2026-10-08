/**
 * Read-only impact report for the "HMO claims not reflecting" investigation
 * (2026-10-08, docs/audit/phase1-status.md). Makes NO data changes - report
 * only, so the user can decide what to do with each row.
 *
 * Two independent findings, both caused by the same root defect
 * (Visit.insuranceProviderId never populated by the live app, only by
 * prisma/seed.ts's direct writes):
 *
 *   A. Outpatient claims (ClaimsService.generate(), invoiceId-based) whose
 *      coPayPct silently resolved to 0% instead of the provider's real
 *      configured rate - claimed 100% to the insurer, 0% to the patient.
 *      Admission claims (generateForAdmission) never had this bug - their
 *      coPayPct resolution was independent and correct from the start, so
 *      they're excluded here on purpose, not missed.
 *
 *   B. Pharmacy dispenses (PharmacyService.prepare(), pay-before-dispense)
 *      with the identical coPayPct resolution bug - a patient's co-pay
 *      share dispensed immediately instead of being gated.
 *
 * Detection method and its one real caveat (read before trusting a row):
 * a claim/item is flagged when it was generated from a visit whose
 * Visit.insuranceProviderId is still null (payerType HMO/NHIS/RETAINER -
 * the exact set prisma/backfill-visit-insurance-provider.ts also finds)
 * AND the provider that *would* now resolve for it has a non-zero
 * defaultCoPayPct today. There is no historical record of what a
 * provider's co-pay was at the moment a given claim was generated (no
 * audit trail existed before Fix 3), so this compares against the
 * provider's CURRENT configured rate. A provider that was genuinely 0%
 * co-pay back then and has only just been configured non-zero (Fix 3 is
 * what first made that configurable for a non-seeded provider) would also
 * surface here, indistinguishable from a real bug instance - each flagged
 * row needs a human look, not an automatic correction.
 *
 * Usage (from apps/api):
 *   pnpm ts-node prisma/impact-report-copay-bug.ts
 */
import { PrismaClient, Prisma, ClaimStatus } from '@prisma/client';
import { resolveInsuranceProvider } from '../src/common/insurance-provider-resolver';

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function claimRecommendation(status: ClaimStatus): string {
  switch (status) {
    case 'DRAFT':
      return 'Not submitted yet - safe to cancel and regenerate once Fix 1/2 and the backfill are applied.';
    case 'SUBMITTED':
      return 'Already sent to the HMO at the wrong amount - flag for manual correction with the HMO; bill the patient the missed co-pay share.';
    case 'PART_PAID':
    case 'PAID':
      return 'Money has already moved - most urgent. Reconcile with the HMO (likely overpaid relative to the real co-pay split) and collect the missed co-pay from the patient.';
    case 'REJECTED':
      return 'Already rejected by the HMO (for whatever reason) - correct the amount before any resubmission.';
    case 'WRITTEN_OFF':
    case 'CANCELLED':
      return 'No live financial exposure - informational only.';
    default:
      return 'Review manually.';
  }
}

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('=== A. Outpatient claims where co-pay should have applied but did not ===\n');

    const claims = await prisma.insuranceClaim.findMany({
      where: { invoiceId: { not: null }, patientResponsibility: { equals: new Prisma.Decimal(0) } },
      include: {
        provider: { select: { id: true, name: true, defaultCoPayPct: true } },
        patient: { select: { firstName: true, lastName: true, patientNumber: true } },
      },
      orderBy: [{ tenantId: 'asc' }, { createdAt: 'asc' }],
    });

    let claimRowsFlagged = 0;
    const totalsByProvider = new Map<string, { tenantId: string; providerName: string; count: number; totalDifference: number }>();

    for (const c of claims) {
      const coPayPct = Number(c.provider?.defaultCoPayPct ?? 0);
      if (coPayPct <= 0) continue; // a genuinely 0%-co-pay provider is not a bug instance

      const gross = Number(c.claimedAmount) + Number(c.patientResponsibility);
      const expectedClaimed = round2(gross * (1 - coPayPct / 100));
      const expectedPatientResponsibility = round2(gross - expectedClaimed);
      const actualClaimed = Number(c.claimedAmount);
      const difference = round2(actualClaimed - expectedClaimed);
      if (difference <= 0) continue;

      claimRowsFlagged += 1;
      const patientName = c.patient ? `${c.patient.firstName} ${c.patient.lastName}`.trim() : c.memberName;
      console.log(
        `  [${c.tenantId}] ${c.claimNumber} (${c.status}) - ${patientName} / ${c.provider?.name ?? 'unknown provider'}\n` +
          `    claimed ${actualClaimed.toFixed(2)} (should have been ${expectedClaimed.toFixed(2)}, ` +
          `patient share should have been ${expectedPatientResponsibility.toFixed(2)}) - difference ${difference.toFixed(2)}\n` +
          `    -> ${claimRecommendation(c.status)}`,
      );

      const key = `${c.tenantId}:${c.providerId}`;
      const t = totalsByProvider.get(key) ?? { tenantId: c.tenantId, providerName: c.provider?.name ?? 'unknown', count: 0, totalDifference: 0 };
      t.count += 1;
      t.totalDifference = round2(t.totalDifference + difference);
      totalsByProvider.set(key, t);
    }

    console.log(`\n${claimRowsFlagged} claim(s) flagged out of ${claims.length} zero-patient-responsibility outpatient claim(s) scanned.\n`);

    console.log('=== Totals per provider (claims) ===\n');
    for (const t of totalsByProvider.values()) {
      console.log(`  [${t.tenantId}] ${t.providerName}: ${t.count} claim(s), total difference ${t.totalDifference.toFixed(2)}`);
    }

    console.log('\n=== B. Pharmacy dispenses where co-pay should have applied but did not ===\n');

    const items = await prisma.prescriptionItem.findMany({
      where: {
        dispensedQty: { gt: 0 },
        preparedQty: 0, // nothing was ever gated for this item
        prescription: {
          visitId: { not: null },
          admissionId: null, // admissions are exempt from the gate by design, not a bug
        },
      },
      include: {
        prescription: {
          select: {
            id: true,
            patientId: true,
            visitId: true,
            tenantId: true,
            patient: { select: { firstName: true, lastName: true, patientNumber: true } },
          },
        },
      },
    });

    let pharmacyRowsFlagged = 0;
    const tenantSettingCache = new Map<string, boolean>();

    for (const item of items) {
      const rx = item.prescription;
      if (!rx.visitId) continue;

      let gateWasOn = tenantSettingCache.get(rx.tenantId);
      if (gateWasOn === undefined) {
        const tenant = await prisma.tenant.findUnique({ where: { id: rx.tenantId }, select: { requirePaymentBeforeDispense: true } });
        gateWasOn = !!tenant?.requirePaymentBeforeDispense;
        tenantSettingCache.set(rx.tenantId, gateWasOn);
      }
      if (!gateWasOn) continue; // the gate (and therefore the co-pay split) was never active for this tenant

      const visit = await prisma.visit.findUnique({
        where: { id: rx.visitId },
        select: { insuranceProviderId: true, hmoName: true, payerType: true, patientId: true },
      });
      if (!visit || visit.insuranceProviderId) continue; // already has a provider link - not an affected visit
      if (!['HMO', 'NHIS', 'RETAINER'].includes(visit.payerType)) continue;

      const patient = await prisma.patient.findUnique({
        where: { id: visit.patientId },
        select: { insuranceProviderId: true, hmoName: true, insuranceProvider: true },
      });

      const resolved = await resolveInsuranceProvider(prisma as unknown as Prisma.TransactionClient, {
        tenantId: rx.tenantId,
        patientProviderId: patient?.insuranceProviderId ?? null,
        nameGuess: visit.hmoName ?? patient?.hmoName ?? patient?.insuranceProvider,
        context: `impact report prescription-item ${item.id}`,
      });
      if (!resolved || resolved.coPayPct <= 0) continue;

      pharmacyRowsFlagged += 1;
      const patientName = rx.patient ? `${rx.patient.firstName} ${rx.patient.lastName}`.trim() : rx.patient;
      console.log(
        `  [${rx.tenantId}] prescription ${rx.id}, item ${item.id} - ${patientName} (${rx.patient?.patientNumber ?? '?'})\n` +
          `    ${item.drugName ?? 'item'} x${item.dispensedQty}, provider co-pay ${resolved.coPayPct}% - ` +
          `dispensed in full immediately, nothing was gated for the patient's share`,
      );
    }

    console.log(`\n${pharmacyRowsFlagged} pharmacy item(s) flagged out of ${items.length} candidate(s) scanned.\n`);

    console.log('=== No data was changed by this report. ===');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
