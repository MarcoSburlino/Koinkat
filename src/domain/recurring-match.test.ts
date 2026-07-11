import { describe, it, expect } from 'vitest';
import {
  scoreMatch,
  pickMatch,
  timingOffsetDays,
  daysBetween,
  addDays,
  nextExpectedAfter,
  correctInterval,
  isOverdue,
  WINDOW_DAYS,
  type SeriesMatchInput,
  type TxnMatchInput,
} from './recurring-match';

// A clean monthly Netflix-style series anchored on the 5th, €13.99.
function monthlySeries(over: Partial<SeriesMatchInput> = {}): SeriesMatchInput {
  return {
    cadence: 'monthly',
    intervalDays: 30,
    expectedAmount: '13.99',
    currency: 'EUR',
    lastChargeDate: '2026-01-05',
    nextExpectedDate: '2026-02-05',
    ...over,
  };
}

function txn(over: Partial<TxnMatchInput> = {}): TxnMatchInput {
  return { date: '2026-02-05', amount: '13.99', currency: 'EUR', ...over };
}

describe('date helpers', () => {
  it('daysBetween is signed and UTC-stable across DST', () => {
    expect(daysBetween('2026-02-05', '2026-01-05')).toBe(31);
    expect(daysBetween('2026-01-05', '2026-02-05')).toBe(-31);
    expect(daysBetween('2026-03-29', '2026-03-28')).toBe(1); // EU DST night
  });

  it('addDays / nextExpectedAfter round-trip', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(nextExpectedAfter('2026-01-05', 30)).toBe('2026-02-04');
    expect(nextExpectedAfter('2026-01-05', 30.4)).toBe('2026-02-04'); // rounds interval
  });
});

describe('timingOffsetDays', () => {
  it('prefers next_expected_date', () => {
    expect(timingOffsetDays('2026-02-07', monthlySeries())).toBe(2);
  });

  it('falls back to |gap − interval| when no next_expected_date', () => {
    const s = monthlySeries({ nextExpectedDate: null, lastChargeDate: '2026-01-05', intervalDays: 30 });
    // gap 2026-02-08 → 34 days; |34 − 30| = 4
    expect(timingOffsetDays('2026-02-08', s)).toBe(4);
  });

  it('returns null with no temporal anchor', () => {
    const s = monthlySeries({ nextExpectedDate: null, lastChargeDate: null });
    expect(timingOffsetDays('2026-02-05', s)).toBeNull();
  });
});

describe('scoreMatch - silent vs review', () => {
  it('attaches silently on an in-window, same-amount charge', () => {
    const v = scoreMatch(txn(), monthlySeries());
    expect(v.decision).toBe('silent');
    expect(v.amountJumped).toBe(false);
  });

  it('still silent at the edge of the monthly window (±7d) and small drift', () => {
    const v = scoreMatch(txn({ date: '2026-02-12', amount: '14.50' }), monthlySeries());
    expect(WINDOW_DAYS.monthly).toBe(7);
    expect(v.decision).toBe('silent');
  });

  it('absolute €1 band keeps a tiny change silent even past 15%', () => {
    // expected 5.00, txn 5.90 → 18% drift but ≤ €1 absolute → silent
    const v = scoreMatch(txn({ amount: '5.90' }), monthlySeries({ expectedAmount: '5.00' }));
    expect(v.decision).toBe('silent');
  });

  it('sends a big amount jump to review but flags amountJumped (attach + ask)', () => {
    const v = scoreMatch(txn({ amount: '19.99' }), monthlySeries());
    expect(v.decision).toBe('review');
    expect(v.reason).toBe('amount-jump');
    expect(v.amountJumped).toBe(true);
  });

  it('sends an out-of-window charge to review', () => {
    const v = scoreMatch(txn({ date: '2026-02-20' }), monthlySeries());
    expect(v.decision).toBe('review');
    expect(v.reason).toBe('timing-out-of-window');
  });

  it('reviews a currency mismatch rather than guessing', () => {
    const v = scoreMatch(txn({ currency: 'USD' }), monthlySeries());
    expect(v.decision).toBe('review');
    expect(v.reason).toBe('currency-mismatch');
  });

  it('treats a null expected amount as non-disqualifying', () => {
    const v = scoreMatch(txn({ amount: '999.00' }), monthlySeries({ expectedAmount: null }));
    expect(v.decision).toBe('silent');
  });
});

describe('pickMatch - multi-candidate resolution', () => {
  it('no active series → none', () => {
    expect(pickMatch(txn(), []).verdict.decision).toBe('none');
  });

  it('one active series → delegates to scoreMatch', () => {
    const r = pickMatch(txn(), [monthlySeries()]);
    expect(r.verdict.decision).toBe('silent');
    expect(r.series).not.toBeNull();
  });

  it('multiple active series → review (ambiguous), no auto-pick', () => {
    const r = pickMatch(txn(), [monthlySeries(), monthlySeries({ cadence: 'yearly' })]);
    expect(r.verdict.decision).toBe('review');
    expect(r.verdict.reason).toBe('ambiguous-multiple-series');
    expect(r.series).toBeNull();
  });
});

describe('correctInterval - self-correction with outlier guard', () => {
  it('blends the observed gap toward the real cadence', () => {
    // current 30, observed 28 → round((30+28)/2) = 29
    expect(correctInterval('2026-01-05', '2026-02-02', 30, 'monthly')).toBe(29);
  });

  it('ignores an implausible gap (stray early/late charge)', () => {
    // 90-day gap > 2× nominal 30 → keep current
    expect(correctInterval('2026-01-05', '2026-04-05', 30, 'monthly')).toBe(30);
  });
});

describe('isOverdue - missed-charge predicate', () => {
  it('false before grace expires', () => {
    expect(isOverdue({ nextExpectedDate: '2026-02-05' }, '2026-02-08')).toBe(false);
  });

  it('true once grace (5d) has passed', () => {
    expect(isOverdue({ nextExpectedDate: '2026-02-05' }, '2026-02-11')).toBe(true);
  });

  it('false when the series has no next expected date', () => {
    expect(isOverdue({ nextExpectedDate: null }, '2026-12-31')).toBe(false);
  });
});
