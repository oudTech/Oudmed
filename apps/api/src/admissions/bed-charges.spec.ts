import { planBedCharges } from './bed-charges';

// Lagos is UTC+1 with no DST - a literal 'Z' timestamp one hour before local
// midnight makes "local wall-clock time" easy to read in these fixtures.
// e.g. '2026-03-01T23:00:00Z' reads as 2026-03-02 00:00 in Lagos.
const d = (iso: string) => new Date(iso);

describe('planBedCharges (F1 section 6 worked examples)', () => {
  it('MIDNIGHT_CENSUS: admitted 23:00, discharged 08:00 next day - 1 night, normal rule applies', () => {
    const admittedAt = d('2026-03-01T22:00:00Z'); // 2026-03-01 23:00 Lagos
    const dischargedAt = d('2026-03-02T07:00:00Z'); // 2026-03-02 08:00 Lagos
    const plan = planBedCharges({ rule: 'MIDNIGHT_CENSUS', admittedAt, through: dischargedAt, isFinal: true });
    expect(plan.shortStay).toBe(false);
    expect(plan.units).toHaveLength(1);
  });

  it('ROLLING_24H: admitted 23:00, discharged 08:00 next day - 1 day, partial block rounds up', () => {
    const admittedAt = d('2026-03-01T22:00:00Z');
    const dischargedAt = d('2026-03-02T07:00:00Z');
    const plan = planBedCharges({ rule: 'ROLLING_24H', admittedAt, through: dischargedAt, isFinal: true });
    expect(plan.shortStay).toBe(false);
    expect(plan.units).toHaveLength(1);
  });

  it('MIDNIGHT_CENSUS: admitted 09:00, discharged 17:00 same day - short stay, shortStayChargeMode decides', () => {
    const admittedAt = d('2026-03-01T08:00:00Z'); // 09:00 Lagos
    const dischargedAt = d('2026-03-01T16:00:00Z'); // 17:00 Lagos
    const plan = planBedCharges({ rule: 'MIDNIGHT_CENSUS', admittedAt, through: dischargedAt, isFinal: true });
    expect(plan.shortStay).toBe(true);
    expect(plan.units).toHaveLength(0);
  });

  it('ROLLING_24H: admitted 09:00, discharged 17:00 same day - identical short-stay outcome to MIDNIGHT_CENSUS', () => {
    const admittedAt = d('2026-03-01T08:00:00Z');
    const dischargedAt = d('2026-03-01T16:00:00Z');
    const plan = planBedCharges({ rule: 'ROLLING_24H', admittedAt, through: dischargedAt, isFinal: true });
    expect(plan.shortStay).toBe(true);
    expect(plan.units).toHaveLength(0);
  });

  it('a same-day stay is not yet flagged short-stay while still admitted (unknowable until it ends)', () => {
    const admittedAt = d('2026-03-01T08:00:00Z');
    const stillOpenNow = d('2026-03-01T12:00:00Z');
    const plan = planBedCharges({ rule: 'MIDNIGHT_CENSUS', admittedAt, through: stillOpenNow, isFinal: false });
    expect(plan.shortStay).toBe(false);
    expect(plan.units).toHaveLength(0);
  });

  it('MIDNIGHT_CENSUS: a multi-night stay charges one unit per Lagos midnight crossed', () => {
    const admittedAt = d('2026-03-01T09:00:00Z'); // Mar 1, 10:00 Lagos
    const through = d('2026-03-04T09:00:00Z'); // Mar 4, 10:00 Lagos - 3 midnights crossed (2,3,4)
    const plan = planBedCharges({ rule: 'MIDNIGHT_CENSUS', admittedAt, through, isFinal: false });
    expect(plan.units).toHaveLength(3);
  });

  it('ROLLING_24H: the nightly cron does not charge a block that has not fully elapsed yet', () => {
    const admittedAt = d('2026-03-01T22:00:00Z'); // 23:00 Lagos
    const justAfterMidnight = d('2026-03-01T23:10:00Z'); // 2026-03-02 00:10 Lagos - 1 midnight crossed, but <1h into the stay
    const plan = planBedCharges({ rule: 'ROLLING_24H', admittedAt, through: justAfterMidnight, isFinal: false });
    expect(plan.units).toHaveLength(0); // first 24h block (ending 2026-03-02 23:00 Lagos) has not elapsed
  });

  it('is idempotent in shape: calling again with a later `through` only ever extends the unit list', () => {
    const admittedAt = d('2026-03-01T09:00:00Z');
    const first = planBedCharges({ rule: 'MIDNIGHT_CENSUS', admittedAt, through: d('2026-03-02T09:00:00Z'), isFinal: false });
    const second = planBedCharges({ rule: 'MIDNIGHT_CENSUS', admittedAt, through: d('2026-03-03T09:00:00Z'), isFinal: false });
    expect(first.units).toHaveLength(1);
    expect(second.units).toHaveLength(2);
    expect(second.units[0].nightOf.getTime()).toBe(first.units[0].nightOf.getTime());
  });
});
