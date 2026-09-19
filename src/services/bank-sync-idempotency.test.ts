/**
 * Item E regressions: bank ingestion must be idempotent, and settlement
 * must be lossless.
 *
 * Three defects from the audit, all exercised end to end against a real
 * SQLite database with the real migrations:
 *
 *   1. A booked entry whose `entry_reference` matched a still-PENDING local
 *      row was treated as a duplicate and skipped. The pending row then fell
 *      to the disappearance sweep, so the transaction vanished entirely -
 *      along with whatever category or note the user had put on it.
 *   2. Entries the bank sends with no `entry_reference` had no dedup at all,
 *      so every repeat sync re-inserted them.
 *   3. The sweep's `pending_last_seen_at IS NULL` clause deleted pending
 *      rows created by any other path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDb, type Harness } from '../test/sqlite-harness';

const WS = 'ws-1';
const ACCT = 'acct-1';
const LINKED = 'linked-1';

let db: Harness;

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));

vi.mock('../db/database', () => ({
  getDb: vi.fn(async () => db),
  withTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => db.transaction(fn as never)),
}));

vi.mock('../lib/active-koinkat-account', () => ({
  requireActiveKoinkatAccountId: vi.fn(() => WS),
  getActiveKoinkatAccountId: vi.fn(() => WS),
  captureWorkspace: vi.fn(() => ({ id: WS, assertUnchanged: () => {} })),
}));

vi.mock('./exchange-rate-service', () => ({
  getRatesForDate: vi.fn(async () => ({ eur: '1' })),
  getLatestCachedRates: vi.fn(async () => ({ eur: '1' })),
}));

vi.mock('./api-config-service', () => ({
  loadApiConfig: vi.fn(async () => ({ environment: 'sandbox' })),
}));

// Post-import passes are irrelevant to identity and would drag in more IO.
vi.mock('./categorization-service', () => ({
  categorizer: { categorizeBatch: vi.fn(async () => undefined) },
}));
vi.mock('./recurring-service', () => ({
  applyRecurringMatchOnImport: vi.fn(async () => undefined),
}));
vi.mock('./budget-service', () => ({
  applyAutoCaptureForTransaction: vi.fn(async () => undefined),
}));

vi.mock('./enable-banking-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./enable-banking-service')>();
  return { ...actual, getTransactions: vi.fn() };
});

import { syncTransactions } from './bank-sync-service';
import * as ebService from './enable-banking-service';

const getTransactions = vi.mocked(ebService.getTransactions);

type EBTxn = Awaited<ReturnType<typeof ebService.getTransactions>>['transactions'][number];

function entry(opts: {
  status: 'BOOK' | 'PDNG';
  amount: string;
  ref?: string;
  txnId?: string;
  date?: string;
  merchant?: string;
}): EBTxn {
  return {
    status: opts.status,
    entryReference: opts.ref,
    transactionId: opts.txnId,
    creditDebitIndicator: 'DBIT',
    amount: opts.amount,
    currency: 'EUR',
    bookingDate: opts.date ?? '2026-03-10',
    transactionDate: opts.date ?? '2026-03-10',
    creditorName: opts.merchant ?? 'Corner Shop',
  } as unknown as EBTxn;
}

/**
 * Script one sync. The service asks for pending and booked separately, so
 * answer by the `status` argument rather than by call order.
 */
function scriptSync(pending: EBTxn[], booked: EBTxn[]) {
  getTransactions.mockImplementation(
    async (_uid: string, options?: { transactionStatus?: 'booked' | 'pending' }) => ({
      transactions: options?.transactionStatus === 'pending' ? pending : booked,
      continuationKey: undefined,
    }),
  );
}

async function seed() {
  await db.execute(
    `INSERT INTO accounts (id, koinkat_account_id, name, currency, current_balance, is_manual)
     VALUES (?, ?, 'Bank', 'EUR', '100.00', 0)`,
    [ACCT, WS],
  );
  await db.execute(
    `INSERT INTO bank_connections (id, koinkat_account_id, aspsp_name, aspsp_country, session_id, status, valid_until)
     VALUES ('conn-1', ?, 'TestBank', 'IT', 'sess-1', 'active', '2099-01-01')`,
    [WS],
  );
  await db.execute(
    `INSERT INTO linked_accounts
       (id, koinkat_account_id, bank_connection_id, account_id, external_account_uid, sync_start_date)
     VALUES (?, ?, 'conn-1', ?, 'uid-1', '2026-01-01')`,
    [LINKED, WS, ACCT],
  );
}

const allRows = () =>
  db.select<
    { id: string; status: string; amount: string; category_id: string | null; note: string | null }[]
  >('SELECT id, status, amount, category_id, note FROM transactions ORDER BY id', []);

beforeEach(async () => {
  db = createTestDb();
  await seed();
  getTransactions.mockReset();
  vi.clearAllMocks();
});

afterEach(() => db.close());

describe('pending settles into booked without loss', () => {
  it('promotes the pending row instead of dropping the booked entry', async () => {
    // Sync 1: the charge is pending.
    scriptSync([entry({ status: 'PDNG', amount: '10.00', ref: 'REF-1' })], []);
    await syncTransactions(LINKED, { ignoreFloor: true });

    let rows = await allRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');

    // The user categorises and annotates it while it is pending.
    await db.execute(
      `INSERT INTO categories (id, koinkat_account_id, name, type)
       VALUES ('cat-1', ?, 'Groceries', 'expense')`,
      [WS],
    );
    await db.execute("UPDATE transactions SET category_id = 'cat-1', note = 'weekly shop' WHERE id = ?", [
      rows[0].id,
    ]);

    // Sync 2: the same charge, now booked, same reference.
    scriptSync([], [entry({ status: 'BOOK', amount: '10.00', ref: 'REF-1' })]);
    await syncTransactions(LINKED, { ignoreFloor: true });

    rows = await allRows();
    // One row, booked, with the user's work intact - not zero rows, and not
    // two.
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('booked');
    expect(rows[0].category_id).toBe('cat-1');
    expect(rows[0].note).toBe('weekly shop');
  });

  it('does not sweep away a row it just promoted', async () => {
    scriptSync([entry({ status: 'PDNG', amount: '25.00', ref: 'REF-2' })], []);
    await syncTransactions(LINKED, { ignoreFloor: true });

    // Booked arrives while the pending list is now empty - the sweep runs.
    scriptSync([], [entry({ status: 'BOOK', amount: '25.00', ref: 'REF-2' })]);
    await syncTransactions(LINKED, { ignoreFloor: true });

    const rows = await allRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('booked');
  });
});

describe('repeated syncs do not duplicate rows', () => {
  it('re-importing the same referenced booked entry adds nothing', async () => {
    scriptSync([], [entry({ status: 'BOOK', amount: '10.00', ref: 'REF-3' })]);
    await syncTransactions(LINKED, { ignoreFloor: true });
    await syncTransactions(LINKED, { ignoreFloor: true });
    await syncTransactions(LINKED, { ignoreFloor: true });

    expect(await allRows()).toHaveLength(1);
  });

  it('re-importing an entry with NO entry_reference adds nothing', async () => {
    const noRef = entry({ status: 'BOOK', amount: '42.00' });
    scriptSync([], [noRef]);

    await syncTransactions(LINKED, { ignoreFloor: true });
    expect(await allRows()).toHaveLength(1);

    // The audit's case: with no reference there was no dedup at all, so
    // this second sync used to insert a second copy.
    await syncTransactions(LINKED, { ignoreFloor: true });
    expect(await allRows()).toHaveLength(1);

    await syncTransactions(LINKED, { ignoreFloor: true });
    expect(await allRows()).toHaveLength(1);
  });

  it('keeps two genuinely identical payments as two rows', async () => {
    // Same shop, same amount, same day, no references - both are real.
    const a = entry({ status: 'BOOK', amount: '7.50' });
    const b = entry({ status: 'BOOK', amount: '7.50' });
    scriptSync([], [a, b]);

    await syncTransactions(LINKED, { ignoreFloor: true });
    expect(await allRows()).toHaveLength(2);

    // And a repeat sync of the same pair still leaves exactly two.
    await syncTransactions(LINKED, { ignoreFloor: true });
    expect(await allRows()).toHaveLength(2);
  });

  it('imports the shortfall when a third identical payment appears', async () => {
    scriptSync([], [entry({ status: 'BOOK', amount: '7.50' }), entry({ status: 'BOOK', amount: '7.50' })]);
    await syncTransactions(LINKED, { ignoreFloor: true });
    expect(await allRows()).toHaveLength(2);

    scriptSync([], [
      entry({ status: 'BOOK', amount: '7.50' }),
      entry({ status: 'BOOK', amount: '7.50' }),
      entry({ status: 'BOOK', amount: '7.50' }),
    ]);
    await syncTransactions(LINKED, { ignoreFloor: true });
    expect(await allRows()).toHaveLength(3);
  });
});

describe('the disappearance sweep only touches rows it owns', () => {
  it('leaves a pending row that this importer never stamped', async () => {
    // A pending row with no pending_last_seen_at - e.g. created by another
    // path. The old predicate deleted it on the first complete sync.
    await db.execute(
      `INSERT INTO transactions
         (id, koinkat_account_id, account_id, type, amount, currency,
          exchange_rate, amount_in_account_ccy, date, status)
       VALUES ('foreign-1', ?, ?, 'expense', '5.00', 'EUR', '1.000000000000', '5.00', '2026-03-10', 'pending')`,
      [WS, ACCT],
    );

    scriptSync([], []);
    await syncTransactions(LINKED, { ignoreFloor: true });

    const rows = await allRows();
    expect(rows.map((r) => r.id)).toContain('foreign-1');
  });

  it('still removes a stamped pending row the bank stopped reporting', async () => {
    // Must sit inside the sweep's window (today - PENDING_WINDOW_DAYS).
    const recent = new Date().toISOString().slice(0, 10);
    scriptSync([entry({ status: 'PDNG', amount: '9.00', ref: 'REF-GONE', date: recent })], []);
    await syncTransactions(LINKED, { ignoreFloor: true });
    expect(await allRows()).toHaveLength(1);

    // The sweep compares `pending_last_seen_at < syncStartedAt`, and both
    // stamps are ISO millisecond strings. Two syncs in the same millisecond
    // are impossible in practice (real syncs are minutes apart) but trivial
    // in a test, so step the clock past the previous stamp.
    await new Promise((r) => setTimeout(r, 5));

    // Bank no longer reports it, and never booked it.
    scriptSync([], []);
    await syncTransactions(LINKED, { ignoreFloor: true });

    expect(await allRows()).toHaveLength(0);
  });
});
