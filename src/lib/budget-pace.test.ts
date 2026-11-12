import { describe, it, expect } from 'vitest';
import { projectMonthEnd, localIsoDate } from './budget-pace';

/** Build a 30-day April series from per-day spends (strings). */
const series = (spends: string[]) => {
  let run = 0n;
  return spends.map((sp, i) => {
    // cents as BigInt so the fixture itself never uses float math
    run += BigInt(Math.round(Number(sp) * 100));
    const c = (run < 0n ? '-' : '') + (run < 0n ? -run : run).toString().padStart(3, '0');
    return {
      date: `2026-04-${String(i + 1).padStart(2, '0')}`,
      spent: sp,
      cumulative: `${c.slice(0, -2)}.${c.slice(-2)}`,
    };
  });
};
const month = (first: string[]) =>
  series([...first, ...Array.from({ length: 30 - first.length }, () => '0.00')]);

describe('projectMonthEnd', () => {
  it('adds a typical day for each remaining day', () => {
    // 10 days of 20.00 -> 200.00 so far; 20 days left at 20.00 -> 600.00
    const d = month(Array.from({ length: 10 }, () => '20.00'));
    expect(projectMonthEnd(d, '2026-04-10')).toEqual({
      total: '600.00',
      typicalDay: '20.00',
      todayIndex: 9,
    });
  });

  it('does not replay a one-off spike such as rent', () => {
    // Rent 950 on day 2, then 20.00 a day: the median day is 20.00, so the
    // projection is 950 + 30 x 20 - 20 (day 2 had rent, not 20) = 1530.00.
    const first = Array.from({ length: 10 }, (_, i) => (i === 1 ? '950.00' : '20.00'));
    const p = projectMonthEnd(month(first), '2026-04-10');
    expect(p?.typicalDay).toBe('20.00');
    expect(p?.total).toBe('1530.00');
  });

  it('counts quiet days, so sparse spending projects low', () => {
    // 3 spending days out of 10: median day is 0.00 -> no growth.
    const first = ['0.00', '50.00', '0.00', '0.00', '30.00', '0.00', '0.00', '0.00', '10.00', '0.00'];
    expect(projectMonthEnd(month(first), '2026-04-10')?.total).toBe('90.00');
  });

  it('averages the two middle days for an even count', () => {
    const first = ['10.00', '20.00', '30.00', '40.00'];
    // median 25.00; 100.00 so far + 26 x 25.00 = 750.00
    expect(projectMonthEnd(month(first), '2026-04-04')?.total).toBe('750.00');
  });

  it('returns null when today is outside the month', () => {
    expect(projectMonthEnd(month([]), '2026-05-01')).toBeNull();
  });
});

describe('localIsoDate', () => {
  it('formats the local calendar day', () => {
    expect(localIsoDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});
