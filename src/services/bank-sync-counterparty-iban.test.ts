/**
 * The IBAN of the other side of a bank entry reaches the database.
 *
 * Enable Banking reports `creditor_account.iban` / `debtor_account.iban`;
 * the import used to drop them. Transfer detection now reads the stored
 * value to recognise money moved between the user's own accounts, so every
 * import path must keep it: booked inserts, pending inserts, the
 * pending-to-booked flip, and rows imported before the column existed.
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
  ref: string;
  direction?: 'DBIT' | 'CRDT';
  creditorIban?: string;
  debtorIban?: string;
}): EBTxn {
  return {
    status: opts.status,
    entryReference: opts.ref,
    creditDebitIndicator: opts.direction ?? 'DBIT',
    amount: '250.00',
    currency: 'EUR',
    bookingDate: '2026-03-10',
    transactionDate: '2026-03-10',
    creditorName: 'Marco Rossi',
    debtorName: 'Marco Rossi',
    creditorIban: opts.creditorIban,
    debtorIban: opts.debtorIban,
  } as unknown as EBTxn;
}

function scriptSync(pending: EBTxn[], booked: EBTxn[]) {
  getTransactions.mockImplementation(
    async (_uid: string, options?: { transactionStatus?: 'booked' | 'pending' }) => ({
      transactions: options?.transactionStatus === 'pending' ? pending : booked,
      continuationKey: undefined,
    }),
  );
}

const ibans = async () =>
  (
    await db.select<{ external_ref: string; counterparty_iban: string | null }[]>(
      'SELECT external_ref, counterparty_iban FROM transactions ORDER BY external_ref',
      [],
    )
  ).map((r) => [r.external_ref, r.counterparty_iban]);

beforeEach(async () => {
  db = createTestDb();
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
  getTransactions.mockReset();
  vi.clearAllMocks();
});

afterEach(() => db.close());

describe('counterparty IBAN on import', () => {
  it('stores the creditor for money out and the debtor for money in, normalized', async () => {
    scriptSync(
      [],
      [
        entry({ status: 'BOOK', ref: 'OUT', creditorIban: 'it60 x054 2811 1010 0000 0111 222', debtorIban: 'IGNORED' }),
        entry({ status: 'BOOK', ref: 'IN', direction: 'CRDT', debtorIban: 'GB82BARC20000055779911', creditorIban: 'IGNORED' }),
        entry({ status: 'BOOK', ref: 'NONE' }),
      ],
    );

    await syncTransactions(LINKED, { ignoreFloor: true });

    expect(await ibans()).toEqual([
      ['IN', 'GB82BARC20000055779911'],
      ['NONE', null],
      ['OUT', 'IT60X0542811101000000111222'],
    ]);
  });

  it('keeps it through the pending-to-booked flip', async () => {
    scriptSync([entry({ status: 'PDNG', ref: 'R1', creditorIban: 'IT60X0542811101000000111222' })], []);
    await syncTransactions(LINKED, { ignoreFloor: true });
    expect(await ibans()).toEqual([['R1', 'IT60X0542811101000000111222']]);

    // The booked entry arrives without the IBAN: the pending sighting's
    // value must survive.
    scriptSync([], [entry({ status: 'BOOK', ref: 'R1' })]);
    await syncTransactions(LINKED, { ignoreFloor: true });

    const rows = await db.select<{ status: string; counterparty_iban: string | null }[]>(
      'SELECT status, counterparty_iban FROM transactions',
      [],
    );
    expect(rows).toEqual([{ status: 'booked', counterparty_iban: 'IT60X0542811101000000111222' }]);
  });

  it('fills it in on a row imported before it was stored, without overwriting a known one', async () => {
    scriptSync([], [entry({ status: 'BOOK', ref: 'OLD' })]);
    await syncTransactions(LINKED, { ignoreFloor: true });
    expect(await ibans()).toEqual([['OLD', null]]);

    // A later sync (e.g. "Resync history") sees the same entry again.
    scriptSync([], [entry({ status: 'BOOK', ref: 'OLD', creditorIban: 'IT60X0542811101000000111222' })]);
    await syncTransactions(LINKED, { ignoreFloor: true });
    expect(await ibans()).toEqual([['OLD', 'IT60X0542811101000000111222']]);

    scriptSync([], [entry({ status: 'BOOK', ref: 'OLD', creditorIban: 'DE89370400440532013000' })]);
    await syncTransactions(LINKED, { ignoreFloor: true });
    expect(await ibans()).toEqual([['OLD', 'IT60X0542811101000000111222']]);
  });
});
