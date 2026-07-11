// src/mocks/mock-enable-banking-service.ts
import { format, subDays } from 'date-fns';
import fixtures from './eb_mock_fixtures.json';

// Mirrors the real enable-banking-service.ts public API exactly.
// bank-sync-service.ts calls these; swap this file in via the flag below.

export async function listBanks(country: string) {
  return [
    { name: 'FinecoBank', country: 'IT', auth_methods: [{ name: 'redirect', environment: 'PRODUCTION' }] },
    { name: 'Nordea',     country: 'DK', auth_methods: [{ name: 'redirect', environment: 'PRODUCTION' }] },
    { name: 'Barclays',   country: 'GB', auth_methods: [{ name: 'redirect', environment: 'PRODUCTION' }] },
  ].filter(b => !country || b.country === country);
}

export async function startAuth(aspspName: string, _aspspCountry: string, _redirectUrl: string) {
  // Return a fake authorization_id + redirect URL. The user never actually
  // opens a browser - the mock handleAuthCallback accepts any code.
  return {
    url: 'https://mock.enablebanking.test/auth?mock=1',
    authorization_id: `mock-auth-${aspspName.toLowerCase()}-${Date.now()}`,
    psu_id_hash: 'mockhash123',
  };
}

export async function createSession(code: string) {
  // Map the fake code to the right fixture session.
  // Codes are produced by the mock bank-link page (see Step 4).
  const sessionMap: Record<string, any> = {
    'mock-code-eur': fixtures.sessions.fineco_eur,
    'mock-code-dkk': fixtures.sessions.nordea_dkk,
    'mock-code-gbp': fixtures.sessions.barclays_gbp,
  };
  const session = sessionMap[code];
  if (!session) throw new Error(`Mock: unknown code "${code}"`);
  return session;
}

export async function getSessionStatus(_sessionId: string) {
  return { status: 'AUTHORIZED' };
}

export async function deleteSession(_sessionId: string) {
  return {};
}

export async function getBalances(accountUid: string) {
  const result = (fixtures.balances as any)[accountUid];
  if (!result) throw new Error(`Mock: no balance for uid "${accountUid}"`);
  return result;
}

// In-memory per-account pointer into the scripted pending lifecycle (see
// `transaction_lifecycle` in eb_mock_fixtures.json). Advanced once per sync
// - on the booked fetch, which is the last `getTransactions` call of a sync
// (the reconciler fetches pending first, booked second). The pending fetch
// reads the same round without advancing, so pending + booked within one
// sync stay aligned. Resets on app reload, so each launch restarts the
// walkthrough from round 0.
const lifecycleRound = new Map<string, number>();

function matchesStatus(
  rawStatus: string | undefined,
  want?: 'booked' | 'pending',
): boolean {
  if (!want) return true;
  const s = rawStatus ?? 'BOOK';
  return want === 'pending' ? s === 'PDNG' : s === 'BOOK';
}

// Resolve a lifecycle entry's relative `*_day_offset` (days before "today",
// given as a non-negative or negative int) into concrete dates against the
// real clock, so scripted rows always land inside the sync windows
// regardless of the dev machine's date.
function resolveLifecycleEntry(entry: any) {
  const today = new Date();
  const bookingOffset = Math.abs(entry.booking_day_offset ?? 0);
  const txnOffset = Math.abs(
    entry.transaction_day_offset ?? entry.booking_day_offset ?? 0,
  );
  return {
    ...entry,
    booking_date: format(subDays(today, bookingOffset), 'yyyy-MM-dd'),
    transaction_date: format(subDays(today, txnOffset), 'yyyy-MM-dd'),
  };
}

function getLifecycleTransactions(
  uid: string,
  lifecycle: any,
  dateFrom: string,
  dateTo: string,
  status?: 'booked' | 'pending',
) {
  const rounds: any[] = lifecycle.rounds ?? [];
  const idx = lifecycleRound.get(uid) ?? 0;
  const round = rounds[idx] ?? { pending: [], booked: [] };

  // status==='pending' -> the round's pending set; 'booked' or undefined ->
  // its booked set (undefined keeps the legacy booked-only contract).
  const pick: any[] =
    status === 'pending' ? round.pending ?? [] : round.booked ?? [];

  if (status === 'booked') lifecycleRound.set(uid, idx + 1);

  const transactions = pick
    .map(resolveLifecycleEntry)
    .filter(
      (t: any) =>
        (t.booking_date >= dateFrom && t.booking_date <= dateTo) ||
        (t.transaction_date >= dateFrom && t.transaction_date <= dateTo),
    );
  return { transactions, continuation_key: null };
}

export async function getTransactions(
  accountUid: string,
  dateFrom: string,
  dateTo: string,
  status?: 'booked' | 'pending',
  _continuationKey?: string,
) {
  // Lifecycle-scripted account: drive the pending -> book -> vanish demo
  // across successive syncs.
  const lifecycle = (fixtures as any).transaction_lifecycle?.[accountUid];
  if (lifecycle) {
    return getLifecycleTransactions(accountUid, lifecycle, dateFrom, dateTo, status);
  }

  const result = (fixtures.transactions as any)[accountUid];
  if (!result) throw new Error(`Mock: no transactions for uid "${accountUid}"`);
  // Filter by date range so incremental sync behaves correctly, and honor
  // the transaction_status filter (static fixtures are all BOOK, so they
  // only surface on booked fetches).
  const filtered = result.transactions.filter(
    (t: any) =>
      t.booking_date >= dateFrom &&
      t.booking_date <= dateTo &&
      matchesStatus(t.status, status),
  );
  return { transactions: filtered, continuation_key: null };
}

// ── Metadata for the Flag & link split wizard (Review page) ─────────────
//
// The fixture imports two expense rows whose `note` columns carry the
// sentinel strings 'SPLIT_DINNER_1_PARENT' and 'SPLIT_AIRBNB_PARENT',
// plus matching 'SPLIT_DINNER_1_REPAY_*' / 'SPLIT_AIRBNB_REPAY_*' income
// rows that represent repayments from friends. The Review mock banner
// hardcodes its hint copy; grep the fixtures JSON for the sentinels if
// tooling ever needs the structured metadata (a `getMockSplitHints()`
// helper used to live here but had no callers).