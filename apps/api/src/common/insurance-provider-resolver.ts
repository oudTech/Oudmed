import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const logger = new Logger('InsuranceProviderResolver');

export interface ResolvedProvider {
  providerId: string;
  /** The provider's current defaultCoPayPct, as a plain number (0 when unset). */
  coPayPct: number;
}

/**
 * Resolves which InsuranceProvider a visit/admission/prescription belongs
 * to, and that provider's current co-pay percentage. Used everywhere a
 * claim, a pay-before-dispense gate, or a deposit co-pay estimate needs
 * "which HMO, and what share is the patient's" - kept in one place after
 * the same resolution logic was found hand-copied, and drifted, across
 * four call sites (ClaimsService.generate, ClaimsService.generateForAdmission,
 * PharmacyService.resolveCoPay, AdmissionsService.patientPayableBalance).
 *
 * Resolution order, and this order only - never guess beyond it:
 *   1. `ownProviderId` - an already-resolved FK on the record itself (e.g.
 *      Visit.insuranceProviderId). Omit this entirely for a model with no
 *      such column (Admission has none).
 *   2. `patientProviderId` - the patient's own linked InsuranceProvider.
 *   3. `nameGuess` - a case-insensitive exact name match against active
 *      providers, but ONLY when it matches exactly one. Two or more matches
 *      is ambiguous and gets logged, not guessed; zero matches is logged
 *      too. This is the fallback of last resort for data entered as free
 *      text (hmoName) before a real provider link existed.
 *
 * Returns null if nothing resolves - each caller decides what "no
 * provider" means in its own context (a claim skips the invoice; the
 * pay-before-dispense gate treats it as 100% patient-payable, same as
 * cash).
 */
export async function resolveInsuranceProvider(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    ownProviderId?: string | null;
    patientProviderId?: string | null;
    nameGuess?: string | null;
    /** Free-text label for the log line only - which record this lookup was for. */
    context?: string;
  },
): Promise<ResolvedProvider | null> {
  // tenantId is filtered explicitly rather than relied on via RLS alone -
  // this function is also called from the standalone backfill script,
  // which connects as the superuser (bypasses RLS) to scan every tenant.
  const directId = params.ownProviderId ?? params.patientProviderId ?? null;
  if (directId) {
    const provider = await tx.insuranceProvider.findFirst({
      where: { id: directId, tenantId: params.tenantId },
      select: { defaultCoPayPct: true },
    });
    if (provider) {
      return { providerId: directId, coPayPct: Number(provider.defaultCoPayPct ?? 0) };
    }
    logger.warn(
      `${params.context ?? 'resolveInsuranceProvider'}: linked provider ${directId} no longer exists ` +
        `(tenant ${params.tenantId}) - falling back to a name match.`,
    );
  }

  if (params.nameGuess) {
    const matches = await tx.insuranceProvider.findMany({
      where: { tenantId: params.tenantId, name: { equals: params.nameGuess, mode: 'insensitive' }, isActive: true },
      select: { id: true, defaultCoPayPct: true },
    });
    if (matches.length === 1) {
      return { providerId: matches[0].id, coPayPct: Number(matches[0].defaultCoPayPct ?? 0) };
    }
    if (matches.length > 1) {
      logger.warn(
        `${params.context ?? 'resolveInsuranceProvider'}: "${params.nameGuess}" matches ${matches.length} ` +
          `active providers in tenant ${params.tenantId} - ambiguous, leaving unresolved rather than guessing.`,
      );
    } else {
      logger.warn(
        `${params.context ?? 'resolveInsuranceProvider'}: "${params.nameGuess}" matches no active provider ` +
          `in tenant ${params.tenantId} - leaving unresolved.`,
      );
    }
  }

  return null;
}
