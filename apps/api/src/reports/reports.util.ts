import { BadRequestException } from '@nestjs/common';
import type { ReportGranularity } from '@oudhealth/contracts';
import {
  startOfDayLagos,
  startOfWeekLagos,
  startOfMonthLagos,
  startOfYearLagos,
  addDaysUtc,
  addMonthsLagos,
  addYearsLagos,
  lagosYear,
  lagosMonth,
  lagosDate,
} from '../common/lagos-time';

export type BucketUnit = 'day' | 'week' | 'month' | 'year';

export interface RangeBucket {
  start: Date;
  end: Date;
  label: string;
}

export interface ResolvedRange {
  from: Date;
  to: Date;
  label: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// All boundary math below is in Africa/Lagos wall-clock terms (PROD-4),
// not the server process's own local timezone. See common/lagos-time.ts.

function truncate(d: Date, unit: BucketUnit) {
  if (unit === 'day') return startOfDayLagos(d);
  if (unit === 'week') return startOfWeekLagos(d);
  if (unit === 'month') return startOfMonthLagos(d);
  return startOfYearLagos(d);
}

function advance(d: Date, unit: BucketUnit) {
  if (unit === 'day') return addDaysUtc(d, 1);
  if (unit === 'week') return addDaysUtc(d, 7);
  if (unit === 'month') return addMonthsLagos(d, 1);
  return addYearsLagos(d, 1);
}

function labelFor(d: Date, unit: BucketUnit) {
  if (unit === 'year') return String(lagosYear(d));
  if (unit === 'month') return MONTHS[lagosMonth(d)];
  return `${lagosDate(d)} ${MONTHS[lagosMonth(d)]}`;
}

/** The natural bucket size for a [from, to) span shown as a time series. */
export function autoUnit(from: Date, to: Date): BucketUnit {
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  if (days <= 62) return 'day';
  if (days <= 420) return 'week';
  return 'month';
}

export function buildBuckets(from: Date, to: Date, unit: BucketUnit): RangeBucket[] {
  const out: RangeBucket[] = [];
  let cur = truncate(from, unit);
  let guard = 0;
  while (cur < to && guard++ < 1000) {
    const end = advance(cur, unit);
    out.push({ start: cur, end, label: labelFor(cur, unit) });
    cur = end;
  }
  return out;
}

/** Sum a list of dated amounts into the given buckets. */
export function fillBuckets<T>(
  rows: T[],
  buckets: RangeBucket[],
  getDate: (row: T) => Date,
  getValue: (row: T) => number,
): { date: string; label: string; value: number }[] {
  const totals = new Array(buckets.length).fill(0);
  for (const row of rows) {
    const t = getDate(row).getTime();
    for (let i = 0; i < buckets.length; i++) {
      if (t >= buckets[i].start.getTime() && t < buckets[i].end.getTime()) {
        totals[i] += getValue(row);
        break;
      }
    }
  }
  return buckets.map((b, i) => ({ date: b.start.toISOString(), label: b.label, value: totals[i] }));
}

/** Trailing window + bucket unit for the patient-trend granularity toggle. */
export function trendWindow(granularity: ReportGranularity): { from: Date; unit: BucketUnit } {
  const now = new Date();
  if (granularity === 'daily') {
    return { from: addDaysUtc(startOfDayLagos(now), -29), unit: 'day' };
  }
  if (granularity === 'weekly') {
    return { from: addDaysUtc(startOfWeekLagos(now), -7 * 11), unit: 'week' };
  }
  if (granularity === 'yearly') {
    return { from: addYearsLagos(startOfYearLagos(now), -4), unit: 'year' };
  }
  return { from: addMonthsLagos(startOfMonthLagos(now), -11), unit: 'month' };
}

export function resolveRange(preset?: string, from?: string, to?: string): ResolvedRange {
  const now = new Date();
  if (from && to) {
    const f = startOfDayLagos(new Date(from));
    const tStart = startOfDayLagos(new Date(to));
    if (f.getTime() > tStart.getTime()) {
      throw new BadRequestException('"from" date must be on or before "to" date');
    }
    const t = addDaysUtc(tStart, 1); // make `to` exclusive of the whole Lagos day
    return { from: f, to: t, label: 'Custom range' };
  }
  switch (preset) {
    case 'last_month': {
      const thisMonth = startOfMonthLagos(now);
      return { from: addMonthsLagos(thisMonth, -1), to: thisMonth, label: 'Last month' };
    }
    case 'last_30': {
      return { from: addDaysUtc(startOfDayLagos(now), -29), to: now, label: 'Last 30 days' };
    }
    case 'last_90': {
      return { from: addDaysUtc(startOfDayLagos(now), -89), to: now, label: 'Last 90 days' };
    }
    case 'this_year': {
      return { from: startOfYearLagos(now), to: now, label: 'This year' };
    }
    case 'this_month':
    default: {
      return { from: startOfMonthLagos(now), to: now, label: 'This month' };
    }
  }
}

export function deltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function ageFrom(dob: Date | null | undefined, at: Date): number | null {
  if (!dob) return null;
  let age = at.getFullYear() - dob.getFullYear();
  const m = at.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < dob.getDate())) age--;
  return age;
}

export const PAYER_LABEL: Record<string, string> = {
  CASH: 'Patient',
  HMO: 'HMO',
  NHIS: 'NHIS',
  RETAINER: 'Company',
};
