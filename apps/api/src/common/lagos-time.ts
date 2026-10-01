/**
 * Africa/Lagos day-boundary helpers (PROD-4).
 *
 * Nigeria has used a single fixed UTC+1 offset with no daylight saving since
 * 1919 - so "today in Lagos" can be computed with plain +1-hour arithmetic
 * instead of pulling in an IANA timezone library (none is installed; see
 * apps/api/package.json). This must NOT be reused as a template for a
 * DST-observing timezone, where a calendar day is not always exactly 24h.
 *
 * Without this, "today" / "this month" boundaries were computed from the
 * server process's own local timezone (native Date.setHours/getMonth/etc),
 * which is wrong whenever the server does not happen to run in UTC+1 -
 * reports and schedule queries would be a bucket or a day off from what the
 * hospital actually means by "today."
 */

const LAGOS_OFFSET_MS = 60 * 60 * 1000; // UTC+1, no DST

/** The Y/M/D/weekday a UTC instant reads as on a Lagos wall clock. */
function lagosParts(d: Date) {
  const shifted = new Date(d.getTime() + LAGOS_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(), // 0-11
    date: shifted.getUTCDate(),
    day: shifted.getUTCDay(), // 0 = Sunday
  };
}

/** The UTC instant of Lagos midnight for a given Lagos Y/M/D. */
function lagosMidnightUtc(year: number, month: number, date: number): Date {
  return new Date(Date.UTC(year, month, date) - LAGOS_OFFSET_MS);
}

export function addDaysUtc(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

/** Start of "today" in Lagos, as a UTC instant, for the given instant. */
export function startOfDayLagos(d: Date): Date {
  const { year, month, date } = lagosParts(d);
  return lagosMidnightUtc(year, month, date);
}

/** Start of "this week" (Monday) in Lagos. */
export function startOfWeekLagos(d: Date): Date {
  const start = startOfDayLagos(d);
  const dow = (lagosParts(start).day + 6) % 7; // Monday = 0
  return addDaysUtc(start, -dow);
}

/** Start of "this calendar month" in Lagos. */
export function startOfMonthLagos(d: Date): Date {
  const { year, month } = lagosParts(d);
  return lagosMidnightUtc(year, month, 1);
}

/** Start of "this calendar year" in Lagos. */
export function startOfYearLagos(d: Date): Date {
  const { year } = lagosParts(d);
  return lagosMidnightUtc(year, 0, 1);
}

/** Add whole calendar months in Lagos wall-clock terms (day-of-month clamped by Date.UTC normalization). */
export function addMonthsLagos(d: Date, months: number): Date {
  const { year, month, date } = lagosParts(d);
  return lagosMidnightUtc(year, month + months, date);
}

/** Add whole calendar years in Lagos wall-clock terms. */
export function addYearsLagos(d: Date, years: number): Date {
  const { year, month, date } = lagosParts(d);
  return lagosMidnightUtc(year + years, month, date);
}

export function lagosYear(d: Date): number {
  return lagosParts(d).year;
}

export function lagosMonth(d: Date): number {
  return lagosParts(d).month;
}

export function lagosDate(d: Date): number {
  return lagosParts(d).date;
}
