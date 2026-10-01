import { BadRequestException } from '@nestjs/common';
import { resolveRange } from './reports.util';

describe('resolveRange (Item 8/12: Lagos boundaries + from <= to)', () => {
  it('rejects a custom range where "from" is after "to"', () => {
    expect(() => resolveRange(undefined, '2026-03-10', '2026-03-01')).toThrow(BadRequestException);
  });

  it('accepts "from" equal to "to" as a single-day range', () => {
    const r = resolveRange(undefined, '2026-03-10', '2026-03-10');
    expect(r.from.toISOString()).toBe('2026-03-09T23:00:00.000Z'); // 2026-03-10 00:00 Lagos
    expect(r.to.toISOString()).toBe('2026-03-10T23:00:00.000Z'); // exclusive end, next Lagos midnight
  });

  it('a custom range spans whole Lagos days regardless of the server-local timezone', () => {
    const r = resolveRange(undefined, '2026-03-01', '2026-03-05');
    expect(r.from.toISOString()).toBe('2026-02-28T23:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-03-05T23:00:00.000Z');
    expect(r.label).toBe('Custom range');
  });
});
