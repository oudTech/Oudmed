import { startOfDayLagos, addDaysUtc } from '../common/lagos-time';

export type InpatientChargeRule = 'MIDNIGHT_CENSUS' | 'ROLLING_24H';
export type ShortStayChargeMode = 'NONE' | 'MINIMUM_FULL_DAY' | 'DAY_CASE_RATE';

export interface ChargeableUnit {
  /** Idempotency key for BedDayCharge.nightOf - unique per admission per unit. */
  nightOf: Date;
  /** The instant to look up which AdmissionWardStay was open (and therefore which ward's rate applies). */
  censusAt: Date;
}

export interface BedChargePlan {
  units: ChargeableUnit[];
  /** True only when `isFinal` and the whole admission never crossed a Lagos midnight. */
  shortStay: boolean;
}

/**
 * Pure day-charging logic (F1, section 6 of docs/features/F1-inpatient-billing.md),
 * deliberately separated from any DB access so every worked example in the
 * design doc can be tested directly against this function. The DB-aware
 * caller (AdmissionsService.postBedCharges) is responsible for: filtering out
 * units already recorded in BedDayCharge, resolving each unit's ward (via
 * AdmissionWardStay at `censusAt`) and that ward's CURRENT dailyRate, and
 * posting a charge (or leaving it un-marked to retry later if the rate is
 * still missing).
 *
 * "Short stay" (zero Lagos midnights crossed over the whole admission) can
 * only be known once the admission actually ends - a still-open admission
 * that has not yet crossed a midnight might still do so, so `isFinal` must
 * only be `true` at the discharge/reconciliation call, never the nightly
 * cron's routine call.
 */
export function planBedCharges(opts: {
  rule: InpatientChargeRule;
  admittedAt: Date;
  through: Date;
  isFinal: boolean;
}): BedChargePlan {
  const { rule, admittedAt, through, isFinal } = opts;
  const admittedDay = startOfDayLagos(admittedAt);
  const throughDay = startOfDayLagos(through);
  const midnightsCrossed = Math.round((throughDay.getTime() - admittedDay.getTime()) / 86_400_000);

  if (midnightsCrossed <= 0) {
    // Still within the Lagos calendar day the admission started on.
    return { units: [], shortStay: isFinal };
  }

  if (rule === 'MIDNIGHT_CENSUS') {
    const units: ChargeableUnit[] = [];
    for (let k = 1; k <= midnightsCrossed; k++) {
      const midnight = addDaysUtc(admittedDay, k);
      if (midnight > through) break;
      units.push({ nightOf: midnight, censusAt: midnight });
    }
    return { units, shortStay: false };
  }

  // ROLLING_24H: one full-or-partial 24h block from admittedAt, for every
  // block fully elapsed by `through`; at discharge (isFinal), the final,
  // still-forming partial block is charged too (it will never complete).
  const units: ChargeableUnit[] = [];
  let k = 1;
  for (;;) {
    const blockEnd = new Date(admittedAt.getTime() + k * 86_400_000);
    if (blockEnd > through) break;
    units.push({ nightOf: blockEnd, censusAt: blockEnd });
    k++;
  }
  if (isFinal) {
    const lastBlockEnd = new Date(admittedAt.getTime() + (k - 1) * 86_400_000);
    if (through.getTime() > lastBlockEnd.getTime()) {
      units.push({ nightOf: through, censusAt: through });
    }
  }
  return { units, shortStay: false };
}
