import { describe, it, expect } from 'vitest';
import {
  computePendingFingerprint,
  matchBookedToPending,
  isPendingDisappeared,
  pickFlipDate,
  directionFromIndicator,
  directionFromType,
  type FingerprintParts,
  type BookedEntry,
  type PendingCandidate,
} from './pending-reconcile';

const baseFingerprint: FingerprintParts = {
  accountId: 'acct-1',
  direction: 'out',
  amount: '12.50',
  currency: 'EUR',
  merchantNormalized: 'esselunga',
  transactionDate: '2026-06-01',
};

describe('direction mappers', () => {
  it('maps bank indicators to directions', () => {
    expect(directionFromIndicator('CRDT')).toBe('in');
    expect(directionFromIndicator('DBIT')).toBe('out');
  });
  it('maps local types to directions', () => {
    expect(directionFromType('income')).toBe('in');
    expect(directionFromType('expense')).toBe('out');
  });
});

describe('computePendingFingerprint', () => {
  it('is deterministic for identical inputs', () => {
    expect(computePendingFingerprint(baseFingerprint)).toBe(
      computePendingFingerprint({ ...baseFingerprint }),
    );
  });

  it('is stable to currency case and surrounding whitespace', () => {
    const a = computePendingFingerprint(baseFingerprint);
    const b = computePendingFingerprint({
      ...baseFingerprint,
      currency: ' eur ',
      merchantNormalized: ' Esselunga ',
    });
    expect(b).toBe(a);
  });

  it('changes when a salient field changes', () => {
    const a = computePendingFingerprint(baseFingerprint);
    expect(computePendingFingerprint({ ...baseFingerprint, amount: '12.51' })).not.toBe(a);
    expect(computePendingFingerprint({ ...baseFingerprint, direction: 'in' })).not.toBe(a);
    expect(computePendingFingerprint({ ...baseFingerprint, transactionDate: '2026-06-02' })).not.toBe(a);
    expect(computePendingFingerprint({ ...baseFingerprint, accountId: 'acct-2' })).not.toBe(a);
  });

  it('returns 8 hex chars', () => {
    expect(computePendingFingerprint(baseFingerprint)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('treats null merchant as empty (no throw)', () => {
    expect(() =>
      computePendingFingerprint({ ...baseFingerprint, merchantNormalized: null }),
    ).not.toThrow();
  });
});

describe('matchBookedToPending', () => {
  const booked: BookedEntry = {
    direction: 'out',
    currency: 'EUR',
    amount: '40.00',
    date: '2026-06-03',
  };

  it('flips a matching pending row (same dir/ccy/amount, within date window)', () => {
    const cands: PendingCandidate[] = [
      { id: 'p1', direction: 'out', currency: 'EUR', amount: '40.00', date: '2026-06-01' },
    ];
    expect(matchBookedToPending(booked, cands)?.id).toBe('p1');
  });

  it('returns null when there is no pending row (normal booked insert)', () => {
    expect(matchBookedToPending(booked, [])).toBeNull();
  });

  it('rejects a wrong-direction candidate', () => {
    const cands: PendingCandidate[] = [
      { id: 'p1', direction: 'in', currency: 'EUR', amount: '40.00', date: '2026-06-03' },
    ];
    expect(matchBookedToPending(booked, cands)).toBeNull();
  });

  it('rejects a different currency', () => {
    const cands: PendingCandidate[] = [
      { id: 'p1', direction: 'out', currency: 'USD', amount: '40.00', date: '2026-06-03' },
    ];
    expect(matchBookedToPending(booked, cands)).toBeNull();
  });

  it('rejects a non-exact amount by default (tolerance 0)', () => {
    const cands: PendingCandidate[] = [
      { id: 'p1', direction: 'out', currency: 'EUR', amount: '41.00', date: '2026-06-03' },
    ];
    expect(matchBookedToPending(booked, cands)).toBeNull();
  });

  it('accepts a near amount when tolerance is widened', () => {
    const cands: PendingCandidate[] = [
      { id: 'p1', direction: 'out', currency: 'EUR', amount: '41.00', date: '2026-06-03' },
    ];
    expect(
      matchBookedToPending(booked, cands, { amountTolerancePct: 0.05 })?.id,
    ).toBe('p1');
  });

  it('rejects a candidate outside the date window', () => {
    const cands: PendingCandidate[] = [
      { id: 'p1', direction: 'out', currency: 'EUR', amount: '40.00', date: '2026-05-20' },
    ];
    expect(matchBookedToPending(booked, cands)).toBeNull();
  });

  it('picks the closest by amount then date among multiple candidates', () => {
    const cands: PendingCandidate[] = [
      { id: 'far-date', direction: 'out', currency: 'EUR', amount: '40.00', date: '2026-05-30' },
      { id: 'near-date', direction: 'out', currency: 'EUR', amount: '40.00', date: '2026-06-02' },
    ];
    // exact amount on both -> date tiebreak picks the nearer date
    expect(matchBookedToPending(booked, cands)?.id).toBe('near-date');
  });
});

describe('pickFlipDate', () => {
  it('keeps the pending date when it is earlier (the common card case)', () => {
    // Purchase pending on the 1st, bank settles/values it on the 3rd → keep 1st.
    expect(pickFlipDate('2026-06-01', '2026-06-03')).toBe('2026-06-01');
  });

  it('keeps the booked date when it is earlier (value-dated back)', () => {
    expect(pickFlipDate('2026-06-03', '2026-06-01')).toBe('2026-06-01');
  });

  it('is idempotent when both dates are equal', () => {
    expect(pickFlipDate('2026-06-02', '2026-06-02')).toBe('2026-06-02');
  });

  it('handles a one-day gap in both directions', () => {
    expect(pickFlipDate('2026-06-02', '2026-06-03')).toBe('2026-06-02');
    expect(pickFlipDate('2026-06-03', '2026-06-02')).toBe('2026-06-02');
  });

  it('compares across month/year boundaries lexically', () => {
    expect(pickFlipDate('2025-12-31', '2026-01-02')).toBe('2025-12-31');
    expect(pickFlipDate('2026-01-01', '2025-12-30')).toBe('2025-12-30');
  });
});

describe('isPendingDisappeared', () => {
  const window = {
    windowFrom: '2026-05-22',
    windowTo: '2026-06-05',
    syncStartedAt: '2026-06-05T10:00:00.000Z',
  };

  it('removes an in-window pending row not re-seen this sync', () => {
    expect(
      isPendingDisappeared(
        { status: 'pending', date: '2026-06-01', pendingLastSeenAt: '2026-06-04T09:00:00.000Z' },
        window,
      ),
    ).toBe(true);
  });

  it('keeps a pending row re-sighted this sync', () => {
    expect(
      isPendingDisappeared(
        { status: 'pending', date: '2026-06-01', pendingLastSeenAt: '2026-06-05T10:00:00.000Z' },
        window,
      ),
    ).toBe(false);
  });

  it('keeps a pending row outside the queried window', () => {
    expect(
      isPendingDisappeared(
        { status: 'pending', date: '2026-04-01', pendingLastSeenAt: '2026-04-02T09:00:00.000Z' },
        window,
      ),
    ).toBe(false);
  });

  it('never removes a booked row', () => {
    expect(
      isPendingDisappeared(
        { status: 'booked', date: '2026-06-01', pendingLastSeenAt: null },
        window,
      ),
    ).toBe(false);
  });

  it('removes a pending row that was never stamped (null last-seen)', () => {
    expect(
      isPendingDisappeared(
        { status: 'pending', date: '2026-06-01', pendingLastSeenAt: null },
        window,
      ),
    ).toBe(true);
  });
});
