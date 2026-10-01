import {
  startOfDayLagos,
  startOfWeekLagos,
  startOfMonthLagos,
  startOfYearLagos,
  addDaysUtc,
  addMonthsLagos,
  addYearsLagos,
} from './lagos-time';

/**
 * PROD-4: "today" must mean today in Lagos (UTC+1, no DST), not the server
 * process's own local timezone. These instants are chosen either side of
 * the Lagos midnight boundary, which sits at 23:00 UTC the previous day -
 * not at 00:00 UTC, which is where a naive UTC-based "start of day" would
 * put it.
 */
describe('lagos-time', () => {
  it('startOfDayLagos puts the boundary at 23:00 UTC the previous day', () => {
    // 2026-01-13T23:30:00Z = 2026-01-14T00:30 in Lagos -> already the 14th there.
    const justAfter = new Date('2026-01-13T23:30:00Z');
    expect(startOfDayLagos(justAfter).toISOString()).toBe('2026-01-13T23:00:00.000Z');

    // 2026-01-13T22:30:00Z = 2026-01-13T23:30 in Lagos -> still the 13th there.
    const justBefore = new Date('2026-01-13T22:30:00Z');
    expect(startOfDayLagos(justBefore).toISOString()).toBe('2026-01-12T23:00:00.000Z');
  });

  it('startOfWeekLagos lands on Monday 00:00 Lagos', () => {
    // 2026-01-14 is a Wednesday in Lagos.
    const wed = new Date('2026-01-14T10:00:00Z');
    const monday = startOfWeekLagos(wed);
    expect(monday.toISOString()).toBe('2026-01-11T23:00:00.000Z'); // Mon 2026-01-12 00:00 Lagos
  });

  it('startOfMonthLagos and startOfYearLagos use the Lagos calendar date, not the UTC one', () => {
    // 2026-01-31T23:30:00Z is already 2026-02-01T00:30 in Lagos -> February there,
    // even though the UTC calendar date is still January 31st.
    const edge = new Date('2026-01-31T23:30:00Z');
    expect(startOfMonthLagos(edge).toISOString()).toBe('2026-01-31T23:00:00.000Z'); // Feb 1 00:00 Lagos

    // 2025-12-31T23:30:00Z is already 2026-01-01T00:30 in Lagos -> next year there.
    const yearEdge = new Date('2025-12-31T23:30:00Z');
    expect(startOfYearLagos(yearEdge).toISOString()).toBe('2025-12-31T23:00:00.000Z'); // Jan 1 2026 00:00 Lagos
  });

  it('addMonthsLagos and addYearsLagos cross year boundaries correctly', () => {
    const dec1 = startOfMonthLagos(new Date('2025-12-15T12:00:00Z'));
    expect(addMonthsLagos(dec1, 1).toISOString()).toBe(startOfMonthLagos(new Date('2026-01-15T12:00:00Z')).toISOString());
    expect(addYearsLagos(dec1, 1).toISOString()).toBe(startOfMonthLagos(new Date('2026-12-15T12:00:00Z')).toISOString());
  });

  it('addDaysUtc is plain 24h arithmetic (safe because Lagos has no DST)', () => {
    const d = new Date('2026-01-13T23:00:00.000Z');
    expect(addDaysUtc(d, 1).toISOString()).toBe('2026-01-14T23:00:00.000Z');
    expect(addDaysUtc(d, -1).toISOString()).toBe('2026-01-12T23:00:00.000Z');
  });
});
