/**
 * Backfill Visit.insuranceProviderId for existing visits where it's null
 * but the visit is HMO/NHIS/RETAINER - see the "HMO claims not reflecting"
 * investigation (2026-10-08, docs/audit/phase1-status.md). Before this,
 * ScheduleService.create/update never populated the FK at all, which broke
 * the "Generate claims" provider filter and (via a separate, now-fixed
 * resolution bug) silently dropped every outpatient claim's patient co-pay
 * to zero.
 *
 * Uses the exact same resolution rules production code now uses
 * (src/common/insurance-provider-resolver.ts): prefer the patient's own
 * linked provider, then an exact case-insensitive name match ONLY if it
 * matches exactly one active provider in the same tenant. Never guesses
 * beyond that - an ambiguous or unmatched visit is left null and reported,
 * not forced.
 *
 * Connects as the superuser (DATABASE_URL, bypasses RLS) to scan every
 * tenant in one pass; the resolver itself still filters every query by
 * tenantId explicitly, so this can never cross-match one tenant's visit to
 * another tenant's provider.
 *
 * Usage (from apps/api):
 *   pnpm backfill-visit-insurance-provider              - dry run (default), report only, no writes
 *   pnpm backfill-visit-insurance-provider --apply       - perform the writes reported by the dry run
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { resolveInsuranceProvider } from '../src/common/insurance-provider-resolver';

const APPLY = process.argv.includes('--apply');

interface TenantStats {
  total: number;
  viaPatient: number;
  viaName: number;
  ambiguous: number;
  unmatched: number;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const visits = await prisma.visit.findMany({
      where: { insuranceProviderId: null, payerType: { in: ['HMO', 'NHIS', 'RETAINER'] } },
      select: {
        id: true,
        tenantId: true,
        hmoName: true,
        payerType: true,
        createdAt: true,
        patient: {
          select: { id: true, patientNumber: true, insuranceProviderId: true, hmoName: true, insuranceProvider: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    console.log(
      `Scanning ${visits.length} visit(s) with payerType in HMO/NHIS/RETAINER and insuranceProviderId = null...\n`,
    );

    let viaPatient = 0;
    let viaName = 0;
    let ambiguous = 0;
    let unmatched = 0;
    const byTenant = new Map<string, TenantStats>();
    const toApply: { visitId: string; providerId: string }[] = [];
    const ambiguousRows: { visitId: string; tenantId: string; patientNumber: string; nameGuess: string }[] = [];
    const unmatchedRows: { visitId: string; tenantId: string; patientNumber: string; nameGuess: string | null }[] = [];

    for (const v of visits) {
      const stats = byTenant.get(v.tenantId) ?? { total: 0, viaPatient: 0, viaName: 0, ambiguous: 0, unmatched: 0 };
      stats.total += 1;

      const nameGuess = v.hmoName ?? v.patient.hmoName ?? v.patient.insuranceProvider;

      const resolved = await resolveInsuranceProvider(prisma as unknown as Prisma.TransactionClient, {
        tenantId: v.tenantId,
        patientProviderId: v.patient.insuranceProviderId,
        nameGuess,
        context: `backfill visit ${v.id}`,
      });

      if (resolved) {
        if (v.patient.insuranceProviderId === resolved.providerId) {
          viaPatient += 1;
          stats.viaPatient += 1;
        } else {
          viaName += 1;
          stats.viaName += 1;
        }
        toApply.push({ visitId: v.id, providerId: resolved.providerId });
      } else if (nameGuess) {
        // resolveInsuranceProvider already logged why; re-run just the
        // match count here (read-only) so the report can tell "ambiguous"
        // apart from "no match at all" without changing that function's
        // return shape for its four production callers.
        const matches = await prisma.insuranceProvider.findMany({
          where: { tenantId: v.tenantId, name: { equals: nameGuess, mode: 'insensitive' }, isActive: true },
          select: { id: true },
        });
        if (matches.length > 1) {
          ambiguous += 1;
          stats.ambiguous += 1;
          ambiguousRows.push({ visitId: v.id, tenantId: v.tenantId, patientNumber: v.patient.patientNumber, nameGuess });
        } else {
          unmatched += 1;
          stats.unmatched += 1;
          unmatchedRows.push({ visitId: v.id, tenantId: v.tenantId, patientNumber: v.patient.patientNumber, nameGuess });
        }
      } else {
        unmatched += 1;
        stats.unmatched += 1;
        unmatchedRows.push({ visitId: v.id, tenantId: v.tenantId, patientNumber: v.patient.patientNumber, nameGuess: null });
      }

      byTenant.set(v.tenantId, stats);
    }

    console.log('=== Summary ===');
    console.log(`Total visits scanned:                  ${visits.length}`);
    console.log(`Would resolve via the patient's link:  ${viaPatient}`);
    console.log(`Would resolve via a unique name match:  ${viaName}`);
    console.log(`Ambiguous (name matches >1 provider), left null: ${ambiguous}`);
    console.log(`Unmatched (no link, no name match), left null:   ${unmatched}`);
    console.log();

    console.log('=== By tenant ===');
    for (const [tenantId, s] of byTenant) {
      console.log(
        `  ${tenantId}: total ${s.total}, via patient ${s.viaPatient}, via name ${s.viaName}, ` +
          `ambiguous ${s.ambiguous}, unmatched ${s.unmatched}`,
      );
    }
    console.log();

    if (ambiguousRows.length) {
      console.log('=== Ambiguous - manual review needed, nothing will be written for these ===');
      for (const r of ambiguousRows) {
        console.log(`  visit ${r.visitId} (tenant ${r.tenantId}, patient ${r.patientNumber}): "${r.nameGuess}" matches more than one active provider`);
      }
      console.log();
    }
    if (unmatchedRows.length) {
      console.log('=== Unmatched - no provider link possible from the data on record ===');
      for (const r of unmatchedRows) {
        console.log(
          `  visit ${r.visitId} (tenant ${r.tenantId}, patient ${r.patientNumber}): ` +
            (r.nameGuess ? `"${r.nameGuess}" matches no active provider` : 'no hmoName/insuranceProvider text to guess from'),
        );
      }
      console.log();
    }

    if (!APPLY) {
      console.log(`Dry run only - no writes made. Re-run with --apply to update the ${toApply.length} visit(s) that resolved.`);
      return;
    }

    console.log(`Applying: updating ${toApply.length} visit(s)...`);
    let done = 0;
    for (const { visitId, providerId } of toApply) {
      await prisma.visit.update({ where: { id: visitId }, data: { insuranceProviderId: providerId } });
      done += 1;
    }
    console.log(`Done. Updated ${done} visit(s). ${ambiguous + unmatched} remain null (ambiguous/unmatched, listed above).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
