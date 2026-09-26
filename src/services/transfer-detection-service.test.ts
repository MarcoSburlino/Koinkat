/**
 * Transfers between the user's own accounts, against the real schema.
 *
 * The complaint that started this: transfers between two accounts in
 * Koinkat were counted as income and spending. The totals already skip
 * rows with a `transfer_pair_id`; the defect was that almost nothing got
 * one. Detection looked at 90 days only, dropped pairs when exchange rates
 * were missing even in a single currency, ignored the other side's IBAN,
 * and a dismissal hid both rows for good. Confirming a pair also left both
 * rows in the Review queue.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDb, type Harness } from '../test/sqlite-harness';

const WS = 'ws-1';
const IBAN_MAIN = 'IT60X0542811101000000111222';
const IBAN_SAVINGS = 'IT60X0542811101000000333444';
const IBAN_STRANGER = 'DE89370400440532013000';

let db: Harness;

vi.mock('../db/database', () => ({
  getDb: vi.fn(async () => db),
  withTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => db.transaction(fn as never)),
}));

vi.mock('../lib/active-koinkat-account', () => ({
  requireActiveKoinkatAccountId: vi.fn(() => WS),
  getActiveKoinkatAccountId: vi.fn(() => WS),
  captureWorkspace: vi.fn(() => ({ id: WS, assertUnchanged: () => {} })),
}));

// Rates relative to USD. Tests that need "no rates cached" override this.
const RATES = { usd: '1', eur: '0.9', gbp: '0.8', dkk: '6.7' };
vi.mock('./exchange-rate-service', () => ({
  getLatestCachedRates: vi.fn(async () => RATES),
  getRatesForDate: vi.fn(async () => RATES),
}));

import {
  findCandidateTransfers,
  confirmTransferPair,
  dismissTransferPair,
  unpairTransfer,
  markAsTransferAlone,
  findCounterpartsFor,
  getTransferPartners,
} from './transfer-detection-service';
import { getLatestCachedRates } from './exchange-rate-service';

async function account(id: string, currency: string, iban: string | null) {
  await db.execute(
    `INSERT INTO accounts (id, koinkat_account_id, name, currency, current_balance)
     VALUES (?, ?, ?, ?, '0')`,
    [id, WS, `Account ${id}`, currency],
  );
  if (iban) {
    await db.execute(
      `INSERT INTO linked_accounts
         (id, koinkat_account_id, bank_connection_id, account_id, external_account_uid, iban)
       VALUES (?, ?, 'conn-1', ?, ?, ?)`,
      [`la-${id}`, WS, id, `uid-${id}`, iban],
    );
  }
}

async function txn(
  id: string,
  opts: {
    account: string;
    type: 'income' | 'expense';
    amount: string;
    date: string;
    currency?: string;
    counterpartyIban?: string | null;
    category?: string | null;
    needsReview?: 0 | 1;
    status?: 'booked' | 'pending';
  },
) {
  await db.execute(
    `INSERT INTO transactions
       (id, koinkat_account_id, account_id, type, amount, currency, exchange_rate,
        amount_in_account_ccy, category_id, date, status, needs_review,
        counterparty_iban, categorization_source)
     VALUES (?, ?, ?, ?, ?, ?, '1', ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      WS,
      opts.account,
      opts.type,
      opts.amount,
      opts.currency ?? 'EUR',
      opts.amount,
      opts.category ?? null,
      opts.date,
      opts.status ?? 'booked',
      opts.needsReview ?? 1,
      opts.counterpartyIban ?? null,
      opts.category ? 'rule_auto' : null,
    ],
  );
}

async function row(id: string) {
  const rows = await db.select<
    {
      transfer_pair_id: string | null;
      transfer_reviewed_at: string | null;
      needs_review: number;
      category_id: string | null;
      categorization_source: string | null;
    }[]
  >(
    `SELECT transfer_pair_id, transfer_reviewed_at, needs_review, category_id,
            categorization_source
       FROM transactions WHERE id = ?`,
    [id],
  );
  return rows[0];
}

const pairs = (cands: Awaited<ReturnType<typeof findCandidateTransfers>>) =>
  cands.map((c) => `${c.outflow.id}>${c.inflow.id}`);

beforeEach(async () => {
  db = createTestDb();
  vi.mocked(getLatestCachedRates).mockResolvedValue(RATES);
  await db.execute(
    `INSERT INTO bank_connections (id, koinkat_account_id, aspsp_name, aspsp_country, status)
     VALUES ('conn-1', ?, 'Bank', 'IT', 'active')`,
    [WS],
  );
  await db.execute(
    `INSERT INTO categories (id, koinkat_account_id, name, type) VALUES
       ('cat-misc', ?, 'Miscellaneous', 'expense'),
       ('cat-other', ?, 'Other Income', 'income')`,
    [WS, WS],
  );
  await account('main', 'EUR', IBAN_MAIN);
  await account('savings', 'EUR', IBAN_SAVINGS);
  await account('cash', 'EUR', null);
});

afterEach(() => db.close());

describe('findCandidateTransfers', () => {
  it('pairs an outflow with the matching inflow on another account', async () => {
    await txn('out', { account: 'main', type: 'expense', amount: '500.00', date: '2026-03-10' });
    await txn('in', { account: 'savings', type: 'income', amount: '500.00', date: '2026-03-11' });

    const found = await findCandidateTransfers('EUR');

    expect(pairs(found)).toEqual(['out>in']);
    expect(found[0].certain).toBe(false);
    expect(found[0].fee).toBe('0.00');
    expect(found[0].feeCurrency).toBe('EUR');
  });

  it('finds a same-currency pair even with no exchange rates cached', async () => {
    // Both sides in DKK, preferred currency EUR, rate cache empty. This pair
    // used to be dropped because neither side converted to EUR.
    await account('dk1', 'DKK', null);
    await account('dk2', 'DKK', null);
    await txn('out', { account: 'dk1', type: 'expense', amount: '1000.00', currency: 'DKK', date: '2026-03-10' });
    await txn('in', { account: 'dk2', type: 'income', amount: '1000.00', currency: 'DKK', date: '2026-03-10' });
    vi.mocked(getLatestCachedRates).mockResolvedValue(null);

    const found = await findCandidateTransfers('EUR');

    expect(pairs(found)).toEqual(['out>in']);
    expect(found[0].feeCurrency).toBe('DKK');
  });

  it('scans the whole history, not only the last 90 days', async () => {
    await txn('out', { account: 'main', type: 'expense', amount: '300.00', date: '2024-02-01' });
    await txn('in', { account: 'savings', type: 'income', amount: '300.00', date: '2024-02-02' });

    expect(pairs(await findCandidateTransfers('EUR'))).toEqual(['out>in']);
  });

  it('marks a pair certain when the bank names the other account, with a longer gap allowed', async () => {
    await txn('out', {
      account: 'main',
      type: 'expense',
      amount: '2000.00',
      date: '2026-03-01',
      counterpartyIban: IBAN_SAVINGS,
    });
    // 9 days later and 6% short: too far and too different for a guess.
    await txn('in', { account: 'savings', type: 'income', amount: '1880.00', date: '2026-03-10' });

    const found = await findCandidateTransfers('EUR');

    expect(pairs(found)).toEqual(['out>in']);
    expect(found[0].certain).toBe(true);
  });

  it('pairs two transfers to the same account each with its closest amount', async () => {
    await txn('out-a', { account: 'main', type: 'expense', amount: '100.00', date: '2026-03-01', counterpartyIban: IBAN_SAVINGS });
    await txn('out-b', { account: 'main', type: 'expense', amount: '105.00', date: '2026-03-03', counterpartyIban: IBAN_SAVINGS });
    await txn('in-b', { account: 'savings', type: 'income', amount: '105.00', date: '2026-03-03' });
    await txn('in-a', { account: 'savings', type: 'income', amount: '100.00', date: '2026-03-02' });

    expect(pairs(await findCandidateTransfers('EUR')).sort()).toEqual(['out-a>in-a', 'out-b>in-b']);
  });

  it('rejects a pair when the bank says the money went somewhere else', async () => {
    await txn('out', {
      account: 'main',
      type: 'expense',
      amount: '500.00',
      date: '2026-03-10',
      counterpartyIban: IBAN_STRANGER,
    });
    await txn('in', { account: 'savings', type: 'income', amount: '500.00', date: '2026-03-10' });

    expect(await findCandidateTransfers('EUR')).toEqual([]);
  });

  it('still guesses when the other account has no known IBAN', async () => {
    // A manual cash account: no IBAN to contradict, so amount and date decide.
    await txn('out', {
      account: 'main',
      type: 'expense',
      amount: '200.00',
      date: '2026-03-10',
      counterpartyIban: IBAN_STRANGER,
    });
    await txn('in', { account: 'cash', type: 'income', amount: '200.00', date: '2026-03-10' });

    expect(pairs(await findCandidateTransfers('EUR'))).toEqual(['out>in']);
  });

  it('never pairs rows on the same account or far apart in time', async () => {
    await txn('out', { account: 'main', type: 'expense', amount: '100.00', date: '2026-03-10' });
    await txn('same-acct', { account: 'main', type: 'income', amount: '100.00', date: '2026-03-10' });
    await txn('too-late', { account: 'savings', type: 'income', amount: '100.00', date: '2026-03-25' });

    expect(await findCandidateTransfers('EUR')).toEqual([]);
  });

  it('forgets only the dismissed PAIR, so each row can still meet its real partner', async () => {
    await txn('out', { account: 'main', type: 'expense', amount: '400.00', date: '2026-03-10' });
    await txn('wrong', { account: 'savings', type: 'income', amount: '400.00', date: '2026-03-10' });
    await txn('right', { account: 'cash', type: 'income', amount: '400.00', date: '2026-03-12' });

    expect(pairs(await findCandidateTransfers('EUR'))).toEqual(['out>wrong']);
    await dismissTransferPair('out', 'wrong');

    expect(pairs(await findCandidateTransfers('EUR'))).toEqual(['out>right']);
    expect((await row('out')).transfer_reviewed_at).toBeNull();
  });

  it('gives rows dismissed the old per-row way another chance', async () => {
    // Before v15 a dismissal stamped BOTH rows, hiding each row's real
    // partner too. Those rows are suggested again; a dismissal now sticks
    // to the pair.
    await txn('out', { account: 'main', type: 'expense', amount: '400.00', date: '2026-03-10' });
    await txn('in', { account: 'savings', type: 'income', amount: '400.00', date: '2026-03-10' });
    await db.execute("UPDATE transactions SET transfer_reviewed_at = '2026-03-11' WHERE id = 'out'");

    expect(pairs(await findCandidateTransfers('EUR'))).toEqual(['out>in']);
  });

  it('leaves pending rows out until they book', async () => {
    await txn('out', { account: 'main', type: 'expense', amount: '50.00', date: '2026-03-10', status: 'pending' });
    await txn('in', { account: 'savings', type: 'income', amount: '50.00', date: '2026-03-10' });

    expect(await findCandidateTransfers('EUR')).toEqual([]);
  });
});

describe('confirming and undoing a transfer', () => {
  beforeEach(async () => {
    await txn('out', {
      account: 'main',
      type: 'expense',
      amount: '500.00',
      date: '2026-03-10',
      category: 'cat-misc',
    });
    await txn('in', {
      account: 'savings',
      type: 'income',
      amount: '500.00',
      date: '2026-03-11',
      category: 'cat-other',
    });
  });

  it('takes both rows out of Review and clears their category', async () => {
    const pairId = await confirmTransferPair('out', 'in');

    for (const id of ['out', 'in']) {
      const r = await row(id);
      expect(r.transfer_pair_id).toBe(pairId);
      expect(r.needs_review).toBe(0);
      expect(r.category_id).toBeNull();
      expect(r.categorization_source).toBeNull();
    }
    expect(await findCandidateTransfers('EUR')).toEqual([]);
    expect((await getTransferPartners(pairId, 'out')).map((p) => p.id)).toEqual(['in']);
  });

  it('drops both rows from the income and expense totals', async () => {
    const { categoryBreakdown, monthlyCashflow } = await import('./reporting-service');
    expect((await categoryBreakdown({ year: 2026, type: 'expense', preferredCurrency: 'EUR' })).total).toBe('500.00');

    await confirmTransferPair('out', 'in');

    expect((await categoryBreakdown({ year: 2026, type: 'expense', preferredCurrency: 'EUR' })).total).toBe('0.00');
    expect((await categoryBreakdown({ year: 2026, type: 'income', preferredCurrency: 'EUR' })).total).toBe('0.00');
    const march = (await monthlyCashflow({ year: 2026, targetCurrency: 'EUR' })).rows.find((r) => r.month === 3)!;
    expect(march.income).toBe('0.00');
    expect(march.expense).toBe('0.00');
  });

  it('refuses rows that are already in a transfer, or a pair on one account', async () => {
    await confirmTransferPair('out', 'in');
    await expect(confirmTransferPair('out', 'in')).rejects.toThrow(/no longer be marked/);

    await txn('o2', { account: 'main', type: 'expense', amount: '10.00', date: '2026-03-10' });
    await txn('i2', { account: 'main', type: 'income', amount: '10.00', date: '2026-03-10' });
    await expect(confirmTransferPair('o2', 'i2')).rejects.toThrow(/same account/);
    expect((await row('o2')).transfer_pair_id).toBeNull();
  });

  it('undo sends both rows back to Review and does not suggest the pair again', async () => {
    const pairId = await confirmTransferPair('out', 'in');

    await unpairTransfer(pairId);

    for (const id of ['out', 'in']) {
      const r = await row(id);
      expect(r.transfer_pair_id).toBeNull();
      expect(r.needs_review).toBe(1);
    }
    expect(await findCandidateTransfers('EUR')).toEqual([]);
  });

  it('marks one row alone when the other account is not in Koinkat', async () => {
    const { categoryBreakdown } = await import('./reporting-service');
    const pairId = await markAsTransferAlone('out');

    expect((await row('out')).transfer_pair_id).toBe(pairId);
    expect((await row('out')).needs_review).toBe(0);
    expect(await getTransferPartners(pairId, 'out')).toEqual([]);
    expect((await categoryBreakdown({ year: 2026, type: 'expense', preferredCurrency: 'EUR' })).total).toBe('0.00');

    await unpairTransfer(pairId);
    expect((await row('out')).transfer_pair_id).toBeNull();
    expect((await row('out')).needs_review).toBe(1);
  });
});

describe('the Review queue', () => {
  it('never shows a row that is part of a transfer, including pairs confirmed before this fix', async () => {
    const { listTransactions } = await import('./transaction-service');
    const { getPendingReviewCount } = await import('./categorization-service');
    await txn('out', { account: 'main', type: 'expense', amount: '500.00', date: '2026-03-10' });
    await txn('in', { account: 'savings', type: 'income', amount: '500.00', date: '2026-03-10' });
    await txn('coffee', { account: 'main', type: 'expense', amount: '3.50', date: '2026-03-10' });
    // What the old confirm left behind: paired, but still flagged for review.
    await db.execute(
      "UPDATE transactions SET transfer_pair_id = 'legacy-pair' WHERE id IN ('out', 'in')",
    );

    const queue = await listTransactions({ needsReview: true });

    expect(queue.transactions.map((t) => t.id)).toEqual(['coffee']);
    expect(await getPendingReviewCount()).toBe(1);
  });
});

describe('findCounterpartsFor', () => {
  it('lists the other side first when the bank confirms it, then the closest amount', async () => {
    await txn('out', {
      account: 'main',
      type: 'expense',
      amount: '500.00',
      date: '2026-03-10',
      counterpartyIban: IBAN_SAVINGS,
    });
    await txn('close', { account: 'cash', type: 'income', amount: '499.00', date: '2026-03-10' });
    await txn('far', { account: 'cash', type: 'income', amount: '90.00', date: '2026-03-10' });
    await txn('bank', { account: 'savings', type: 'income', amount: '450.00', date: '2026-03-15' });
    // Same account the bank names, but nothing like the amount: not THE row.
    await txn('savings-other', { account: 'savings', type: 'income', amount: '95.00', date: '2026-03-10' });
    await txn('same-acct', { account: 'main', type: 'income', amount: '500.00', date: '2026-03-10' });
    await txn('old', { account: 'cash', type: 'income', amount: '500.00', date: '2026-01-10' });

    const found = await findCounterpartsFor('out', 'EUR');

    expect(found.map((c) => c.id)).toEqual(['bank', 'close', 'savings-other', 'far']);
    expect(found.map((c) => c.certain)).toEqual([true, false, false, false]);
    expect(found[0].dayGap).toBe(5);
  });
});
