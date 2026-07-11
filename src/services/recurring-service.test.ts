import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks ────────────────────────────────────────────────────
// recurring-service depends on Tauri's sql plugin, the workspace id
// (localStorage), and the FX cache. All are stubbed so tests run in a
// vanilla Node + vitest env. The fake DB dispatches by SQL substring
// (not strict call order) so the multi-query matcher loop is easy to
// drive.

vi.mock('../lib/active-koinkat-account', () => ({
  requireActiveKoinkatAccountId: vi.fn(() => 'ws-1'),
  getActiveKoinkatAccountId: vi.fn(() => 'ws-1'),
  setActiveKoinkatAccountId: vi.fn(),
  clearActiveKoinkatAccountId: vi.fn(),
}));

vi.mock('./exchange-rate-service', () => ({
  getLatestCachedRates: vi.fn(async () => ({ eur: '1', usd: '1.1' })),
  getRatesForDate: vi.fn(async () => ({ eur: '1', usd: '1.1' })),
}));

interface Handler {
  match: string;
  rows: (params: unknown[]) => unknown[];
}

interface FakeDb {
  handlers: Handler[];
  executes: Array<{ sql: string; params: unknown[] }>;
  select: (sql: string, params?: unknown[]) => Promise<unknown>;
  execute: (sql: string, params?: unknown[]) => Promise<{ rowsAffected: number; lastInsertId: number }>;
}

let db: FakeDb;

function makeDb(handlers: Handler[]): FakeDb {
  return {
    handlers,
    executes: [],
    async select(sql: string, params: unknown[] = []) {
      for (const h of this.handlers) {
        if (sql.includes(h.match)) return h.rows(params);
      }
      throw new Error(`Unhandled select: ${sql.replace(/\s+/g, ' ').slice(0, 90)}`);
    },
    async execute(sql: string, params: unknown[] = []) {
      this.executes.push({ sql, params });
      return { rowsAffected: 1, lastInsertId: 0 };
    },
  };
}

vi.mock('../db/database', () => ({
  getDb: vi.fn(async () => db),
  withTransaction: vi.fn(async <T,>(fn: (tx: unknown) => Promise<T>) => fn(db)),
}));

import {
  applyRecurringMatchOnImport,
  recurringBreakdown,
} from './recurring-service';

// ── Row factories ───────────────────────────────────────────────────

function txnRow(over: Record<string, unknown> = {}) {
  return {
    id: 'tx-1',
    koinkat_account_id: 'ws-1',
    type: 'expense',
    amount_in_account_ccy: '13.99',
    account_currency: 'EUR',
    date: '2026-02-05',
    category_id: null,
    merchant_normalized: 'NETFLIX',
    recurring_series_id: null,
    recurring_locked: 0,
    note: null,
    merchant_raw: 'NETFLIX',
    ...over,
  };
}

function seriesRow(over: Record<string, unknown> = {}) {
  return {
    id: 'series-netflix',
    koinkat_account_id: 'ws-1',
    merchant_normalized: 'NETFLIX',
    display_name: 'Netflix',
    cadence: 'monthly',
    interval_days: 30,
    category_id: 'cat-streaming',
    expected_amount: '13.99',
    currency: 'EUR',
    status: 'active',
    last_charge_date: '2026-01-05',
    next_expected_date: '2026-02-05',
    match_count: 1,
    last_matched_at: '',
    source: 'user',
    created_at: '',
    updated_at: '',
    ...over,
  };
}

const TXN_SQL = 'a.currency AS account_currency';
const DISMISS_SQL = 'FROM recurring_dismissals';
const SERIES_SQL = 'FROM recurring_series';
const DUP_SQL = 'COUNT(*) AS cnt';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('applyRecurringMatchOnImport', () => {
  it('silently attaches a confident match and applies the series category', async () => {
    db = makeDb([
      { match: TXN_SQL, rows: () => [txnRow()] },
      { match: DISMISS_SQL, rows: () => [] },
      { match: SERIES_SQL, rows: () => [seriesRow()] },
      { match: DUP_SQL, rows: () => [{ cnt: 0 }] },
    ]);

    const res = await applyRecurringMatchOnImport(['tx-1']);
    expect(res).toEqual({ attached: 1, flaggedForReview: 0 });

    const txnUpdate = db.executes.find((e) => e.sql.includes('UPDATE transactions'));
    expect(txnUpdate?.sql).toContain('recurring_series_id');
    expect(txnUpdate?.sql).toContain("categorization_source = 'rule_auto'");
    expect(txnUpdate?.sql).toContain('needs_review = 0');
    expect(txnUpdate?.params).toContain('series-netflix');
  });

  it('routes a big amount jump to Review but still attaches the link', async () => {
    db = makeDb([
      { match: TXN_SQL, rows: () => [txnRow({ amount_in_account_ccy: '19.99' })] },
      { match: DISMISS_SQL, rows: () => [] },
      { match: SERIES_SQL, rows: () => [seriesRow()] },
      { match: DUP_SQL, rows: () => [{ cnt: 0 }] },
    ]);

    const res = await applyRecurringMatchOnImport(['tx-1']);
    expect(res).toEqual({ attached: 0, flaggedForReview: 1 });

    const txnUpdate = db.executes.find((e) => e.sql.includes('UPDATE transactions'));
    expect(txnUpdate?.sql).toContain('needs_review = 1');
    expect(txnUpdate?.params).toContain('series-netflix');
  });

  it('does nothing when the merchant has no active series', async () => {
    db = makeDb([
      { match: TXN_SQL, rows: () => [txnRow({ merchant_normalized: 'UNKNOWN' })] },
      { match: DISMISS_SQL, rows: () => [] },
      { match: SERIES_SQL, rows: () => [] },
    ]);

    const res = await applyRecurringMatchOnImport(['tx-1']);
    expect(res).toEqual({ attached: 0, flaggedForReview: 0 });
    expect(db.executes).toHaveLength(0);
  });

  it('is idempotent - a row already linked to a series is skipped', async () => {
    db = makeDb([
      { match: TXN_SQL, rows: () => [txnRow({ recurring_series_id: 'series-netflix' })] },
    ]);
    const res = await applyRecurringMatchOnImport(['tx-1']);
    expect(res).toEqual({ attached: 0, flaggedForReview: 0 });
    expect(db.executes).toHaveLength(0);
  });

  it('never auto-flags a dismissed merchant', async () => {
    db = makeDb([
      { match: TXN_SQL, rows: () => [txnRow()] },
      { match: DISMISS_SQL, rows: () => [{ id: 'd-1' }] },
    ]);
    const res = await applyRecurringMatchOnImport(['tx-1']);
    expect(res).toEqual({ attached: 0, flaggedForReview: 0 });
    expect(db.executes).toHaveLength(0);
  });

  it('routes to Review when a charge already exists in the same period (no double-attach)', async () => {
    db = makeDb([
      { match: TXN_SQL, rows: () => [txnRow()] },
      { match: DISMISS_SQL, rows: () => [] },
      { match: SERIES_SQL, rows: () => [seriesRow()] },
      { match: DUP_SQL, rows: () => [{ cnt: 1 }] },
    ]);
    const res = await applyRecurringMatchOnImport(['tx-1']);
    expect(res).toEqual({ attached: 0, flaggedForReview: 1 });
    const txnUpdate = db.executes.find((e) => e.sql.includes('UPDATE transactions'));
    expect(txnUpdate?.sql).toContain('needs_review = 1');
    expect(txnUpdate?.sql).not.toContain('recurring_series_id');
  });
});

describe('recurringBreakdown - grouping + fixed/variable (no double count)', () => {
  it('groups recurring spend per series and splits fixed vs variable', async () => {
    // Three EUR expenses: two linked to the Netflix series, one unlinked.
    db = makeDb([
      {
        match: 'FROM transactions t',
        rows: () => [
          {
            amount_in_account_ccy: '13.99',
            recurring_series_id: 'series-netflix',
            display_name: 'Netflix',
            cadence: 'monthly',
            account_currency: 'EUR',
          },
          {
            amount_in_account_ccy: '13.99',
            recurring_series_id: 'series-netflix',
            display_name: 'Netflix',
            cadence: 'monthly',
            account_currency: 'EUR',
          },
          {
            amount_in_account_ccy: '40.00',
            recurring_series_id: null,
            display_name: null,
            cadence: null,
            account_currency: 'EUR',
          },
        ],
      },
    ]);

    const res = await recurringBreakdown({ year: 2026, month: 2, preferredCurrency: 'EUR' });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      seriesId: 'series-netflix',
      displayName: 'Netflix',
      amount: '27.98',
      count: 2,
    });
    expect(res.fixedTotal).toBe('27.98');
    expect(res.variableTotal).toBe('40.00');
    // The lens never invents spend: fixed + variable = the period expense total.
    expect(
      (Number(res.fixedTotal) + Number(res.variableTotal)).toFixed(2),
    ).toBe('67.98');
  });
});
