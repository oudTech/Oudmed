import type { ReportGranularity } from '@oudhealth/contracts';

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

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Monday as the first day of the week. */
function startOfWeek(d: Date) {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfYear(d: Date) {
  return new Date(d.getFullYear(), 0, 1);
}

function truncate(d: Date, unit: BucketUnit) {
  if (unit === 'day') return startOfDay(d);
  if (unit === 'week') return startOfWeek(d);
  if (unit === 'month') return startOfMonth(d);
  return startOfYear(d);
}

function advance(d: Date, unit: BucketUnit) {
  const x = new Date(d);
  if (unit === 'day') x.setDate(x.getDate() + 1);
  else if (unit === 'week') x.setDate(x.getDate() + 7);
  else if (unit === 'month') x.setMonth(x.getMonth() + 1);
  else x.setFullYear(x.getFullYear() + 1);
  return x;
}

function labelFor(d: Date, unit: BucketUnit) {
  if (unit === 'year') return String(d.getFullYear());
  if (unit === 'month') return MONTHS[d.getMonth()];
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
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
    const from = startOfDay(now);
    from.setDate(from.getDate() - 29);
    return { from, unit: 'day' };
  }
  if (granularity === 'weekly') {
    const from = startOfWeek(now);
    from.setDate(from.getDate() - 7 * 11);
    return { from, unit: 'week' };
  }
  if (granularity === 'yearly') {
    return { from: new Date(now.getFullYear() - 4, 0, 1), unit: 'year' };
  }
  return { from: new Date(now.getFullYear(), now.getMonth() - 11, 1), unit: 'month' };
}

export function resolveRange(preset?: string, from?: string, to?: string): ResolvedRange {
  const now = new Date();
  if (from && to) {
    const f = startOfDay(new Date(from));
    const t = startOfDay(new Date(to));
    t.setDate(t.getDate() + 1); // make `to` exclusive of the whole day
    return { from: f, to: t, label: 'Custom range' };
  }
  switch (preset) {
    case 'last_month': {
      const f = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const t = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: f, to: t, label: 'Last month' };
    }
    case 'last_30': {
      const f = startOfDay(now);
      f.setDate(f.getDate() - 29);
      return { from: f, to: now, label: 'Last 30 days' };
    }
    case 'last_90': {
      const f = startOfDay(now);
      f.setDate(f.getDate() - 89);
      return { from: f, to: now, label: 'Last 90 days' };
    }
    case 'this_year': {
      return { from: startOfYear(now), to: now, label: 'This year' };
    }
    case 'this_month':
    default: {
      return { from: startOfMonth(now), to: now, label: 'This month' };
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
