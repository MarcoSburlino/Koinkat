import Big from 'big.js';
import { format, subDays, addDays, parseISO } from 'date-fns';
import { getDb, withTransaction } from '../db/database';
import { dec, qCent, qRate, tryConvert } from '../domain/money';
import * as ebService from './enable-banking-service';
import type { EnableBankingTransaction } from './enable-banking-service';
import { EBRateLimitError, EBApiError } from './enable-banking-service';
import { loadApiConfig } from './api-config-service';
import { getRatesForDate } from './exchange-rate-service';
import { requireActiveKoinkatAccountId } from '../lib/active-koinkat-account';
import { CONSENT_VALID_DAYS } from '../lib/constants';
import { normalizeMerchantName } from '../domain/merchant';
import { cleanImportDescription } from '../domain/import-description';
import { categorizer } from './categorization-service';
import { applyRecurringMatchOnImport } from './recurring-service';
import { applyAutoCaptureForTransaction } from './budget-service';
import {
  PENDING_WINDOW_DAYS,
  computePendingFingerprint,
  matchBookedToPending,
  pickFlipDate,
  directionFromIndicator,
  directionFromType,
  type BookedEntry,
  type PendingCandidate,
} from '../domain/pending-reconcile';
import type {
  BankConnectionRow,
  LinkedAccountRow,
  AccountRow,
  TransactionRow,
} from '../types/models';

// ── Date selection ──────────────────────────────────────────────────────

/**
 * Pick the date we store in `transactions.date` for a freshly-imported
 * row. Banks distinguish:
 *   - `transactionDate` (EB `transaction_date`, falling back to
 *     `value_date`): when the user actually transacted. What they think
 *     of as "the date of the purchase."
 *   - `bookingDate`: when the bank posted the entry to the account. Can
 *     lag the real transaction date by 1-3 days.
 *
 * Users mentally file purchases under their real date, so we prefer the
 * transaction date when present. `bookingDate` is the always-present
 * fallback. The original booking date is preserved separately in
 * `transactions.booking_date` (Fix 1, migration v9).
 */
export function pickTransactionDate(txn: EnableBankingTransaction): string {
  const picked = txn.transactionDate ?? txn.bookingDate;
  if (!picked) {
    // Per the EB API contract `bookingDate` is always present, but guard
    // anyway so a malformed mock fixture surfaces loudly instead of
    // silently inserting `undefined` into the DB.
    throw new Error(
      'Bank transaction missing both transactionDate and bookingDate',
    );
  }
  return picked;
}

// Categorization of imported transactions is handled by
// `categorization-service.ts` (Phase 5). The old keyword-based
// `autoTagByKeywords()` helper has been removed - the categorization
// engine runs in a post-import pass via `categorizeBatch()` with the
// merchant-name normalization + learning pipeline.

/**
 * Whether a bank-connection's `valid_until` (a YYYY-MM-DD string from the
 * Enable Banking API) has lapsed. Compared as end-of-day local time so a
 * session listed as valid through 2026-05-01 is treated as still valid
 * during the entire 2026-05-01 day in the user's timezone, rather than
 * expiring at UTC midnight (which is hours early for users east of UTC).
 */
function isConnectionExpired(validUntilDateStr: string): boolean {
  const validUntil = parseISO(`${validUntilDateStr}T23:59:59`);
  return validUntil < new Date();
}

// ── Auth callback handler ───────────────────────────────────────────────

export async function handleAuthCallback(
  authorizationId: string,
  code: string,
  /**
   * User-chosen floor for the initial transaction sync (ISO YYYY-MM-DD).
   * Written to every linked_accounts row created during this callback.
   * Null/undefined = use the 180-day default.
   */
  syncStartDate?: string | null,
): Promise<{ accountsCreated: number; transactionsImported: number }> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();

  // Create session from authorization + code
  const { sessionId, accounts } =
    await ebService.createSession(authorizationId, code);

  // Find the pending bank_connection with this authorization_id (scoped to profile)
  const connRows = await db.select<BankConnectionRow[]>(
    'SELECT * FROM bank_connections WHERE koinkat_account_id = ? AND authorization_id = ? AND status = ?',
    [koinkatAccountId, authorizationId, 'pending'],
  );

  if (connRows.length === 0) {
    throw new Error('No pending bank connection found for this authorization');
  }
  const conn = connRows[0];

  // Update connection with session info
  await db.execute(
    `UPDATE bank_connections
     SET session_id = ?, status = 'active',
         valid_until = ?, last_synced_at = datetime('now'),
         updated_at = datetime('now')
     WHERE id = ?`,
    [
      sessionId,
      format(addDays(new Date(), CONSENT_VALID_DAYS), 'yyyy-MM-dd'),
      conn.id,
    ],
  );

  // Create Koinkat accounts + linked_accounts for each bank account
  const COLORS = ['#2563eb', '#16a34a', '#7c3aed', '#e53935', '#f59e0b', '#06b6d4'];
  let colorIdx = 0;
  let totalImported = 0;
  let accountsCreatedOrRelinked = 0;

  console.log(`[bank-sync] createSession returned ${accounts.length} accounts`);

  for (const bankAcct of accounts) {

    // Re-link detection (Phase 2): if a prior linked_account exists for
    // this (koinkat_account, external_account_uid) pair, reuse its row
    // - preserve last_synced_at and sync_start_date so the next
    // syncTransactions naturally "continues from where it left off" via
    // the existing delta-window logic. This also avoids tripping the
    // UNIQUE(koinkat_account_id, external_account_uid) constraint.
    const existingLinked = await db.select<LinkedAccountRow[]>(
      `SELECT * FROM linked_accounts
        WHERE koinkat_account_id = ? AND external_account_uid = ?`,
      [koinkatAccountId, bankAcct.uid],
    );

    let linkedId: string;
    const acctName = bankAcct.name ?? bankAcct.iban ?? `Account ${bankAcct.uid.slice(0, 8)}`;

    if (existingLinked.length > 0) {
      // Re-link path: point the existing row at the new bank_connection.
      // Keep sync_start_date as the user's original choice unless the
      // current auth passed a different one explicitly.
      linkedId = existingLinked[0].id;
      const preservedStartDate =
        syncStartDate !== undefined && syncStartDate !== null
          ? syncStartDate
          : existingLinked[0].sync_start_date;
      await db.execute(
        `UPDATE linked_accounts
            SET bank_connection_id = ?,
                iban = ?,
                sync_start_date = ?,
                updated_at = datetime('now')
          WHERE id = ?`,
        [conn.id, bankAcct.iban ?? null, preservedStartDate, linkedId],
      );
      console.log(`[bank-sync] Re-linked existing linked_account ${linkedId}`);
    } else {
      // First-time link: create both the Koinkat account and the linked_accounts row.
      const accountId = crypto.randomUUID();
      linkedId = crypto.randomUUID();

      await db.execute(
        `INSERT INTO accounts (id, koinkat_account_id, name, currency, color, current_balance, is_pinned, is_manual)
         VALUES (?, ?, ?, ?, ?, '0.00', 0, 0)`,
        [accountId, koinkatAccountId, acctName, bankAcct.currency.toUpperCase(), COLORS[colorIdx % COLORS.length]],
      );
      colorIdx++;

      await db.execute(
        `INSERT INTO linked_accounts (id, koinkat_account_id, bank_connection_id, account_id, external_account_uid, iban, sync_start_date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [linkedId, koinkatAccountId, conn.id, accountId, bankAcct.uid, bankAcct.iban ?? null, syncStartDate ?? null],
      );
    }
    accountsCreatedOrRelinked++;

    // Set balance from bank (source of truth - no starting balance transaction)
    await syncBalance(linkedId);

    // Sync transactions. Per-account try/catch so one bank account's
    // failure (network blip, malformed entry) doesn't block the others
    // we just authorized.
    try {
      const result = await syncTransactions(linkedId);
      totalImported += result.imported;
      console.log(`[bank-sync] linked_account ${linkedId}: imported=${result.imported}, skipped=${result.skipped}`);
    } catch (err) {
      console.error(`[bank-sync] linked_account ${linkedId} failed initial sync:`, err);
    }
  }

  return { accountsCreated: accountsCreatedOrRelinked, transactionsImported: totalImported };
}

// ── Balance sync ────────────────────────────────────────────────────────

export async function syncBalance(linkedAccountId: string): Promise<void> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const linked = await db.select<LinkedAccountRow[]>(
    'SELECT * FROM linked_accounts WHERE id = ? AND koinkat_account_id = ?',
    [linkedAccountId, koinkatAccountId],
  );
  if (linked.length === 0) return;
  const la = linked[0];

  try {
    const balances = await ebService.getBalances(la.external_account_uid);

    // Prefer the bank's AVAILABLE balance so the figure the user sees
    // reflects pending spend (the bank already nets pending into it) - our
    // pending rows stay display-only and never touch this number.
    //
    // `balanceType` carries the raw ISO-20022 code from Enable Banking
    // (XPCD = expected/available, ITAV = interim available, CLBD = closing
    // booked), NOT the long camelCase names. Match those codes:
    //   XPCD (available) → ITAV (interim available) → CLBD (booked) → any.
    const balance =
      balances.find((b) => b.balanceType === 'XPCD') ??
      balances.find((b) => b.balanceType === 'ITAV') ??
      balances.find((b) => b.balanceType === 'CLBD') ??
      balances[0];

    if (balance) {
      const amt = qCent(dec(balance.amount)).toFixed(2);
      await db.execute(
        "UPDATE accounts SET current_balance = ?, updated_at = datetime('now') WHERE id = ? AND koinkat_account_id = ?",
        [amt, la.account_id, koinkatAccountId],
      );
    }

    // Intentionally do NOT touch linked_accounts.last_synced_at here -
    // that field tracks "up to when have we fetched transactions", which
    // is syncTransactions' concern. If we stamped it from here, the very
    // first syncTransactions call (triggered right after syncBalance in
    // handleAuthCallback) would compute its delta window off "just now"
    // and only fetch the last ~1 day instead of the intended 180 days.
    await db.execute(
      "UPDATE linked_accounts SET updated_at = datetime('now') WHERE id = ?",
      [linkedAccountId],
    );
  } catch (err) {
    if (err instanceof EBRateLimitError) {
      // Daily-multiplicity rate limit from Enable Banking. Protocol-level
      // signal, not a bug - the next normal sync cycle naturally retries.
      // Do NOT surface to the UI.
      console.log(
        `[sync] rate limit hit on balance for ${la.external_account_uid} - will retry on next sync cycle.`,
      );
      return;
    }
    console.error(`Failed to sync balance for ${linkedAccountId}:`, err);
  }
}

// ── Transaction sync ────────────────────────────────────────────────────

/**
 * Derived fields common to importing a bank entry as either a pending or
 * a booked row: type, cleaned note, normalized merchant, positive amount,
 * FX-converted account-currency amount, and the corrected date. Returns
 * null when no FX rate is available (caller skips the entry to avoid
 * writing a corrupt `amount_in_account_ccy`).
 */
interface ImportFields {
  type: 'income' | 'expense';
  sourceDescription: string | null;
  note: string | null;
  merchantRaw: string | null;
  merchantNormalized: string | null;
  amount: string;
  amountInAccountCcy: string;
  exchangeRate: string;
  effectiveDate: string;
  currency: string;
}

async function buildImportFields(
  txn: EnableBankingTransaction,
  accountCurrency: string,
): Promise<ImportFields | null> {
  const type = txn.creditDebitIndicator === 'CRDT' ? 'income' : 'expense';

  // Preserve the raw remittance text verbatim in `source_description` so
  // the cleaner can be re-run later without losing context.
  const sourceDescription = txn.remittanceInformation?.length
    ? txn.remittanceInformation.join(' | ')
    : null;

  // User-facing `note`: cleaned form first; fall back to creditor/debtor
  // name; finally a generic placeholder so the column is never empty.
  let note: string | null = cleanImportDescription(sourceDescription);
  if (!note) {
    if (type === 'expense' && txn.creditorName) note = txn.creditorName;
    else if (type === 'income' && txn.debtorName) note = txn.debtorName;
    else note = 'Bank transaction';
  }

  // Store the raw merchant name separately from `note` so merchant
  // normalization has a clean, stable input. Wrapped payments (e.g.
  // "APPLE PAY") that normalize to null fall back to remittance so rows
  // bucket by the real merchant.
  let merchantRaw: string | null =
    type === 'expense' ? (txn.creditorName ?? null) : (txn.debtorName ?? null);
  let merchantNormalized = normalizeMerchantName(merchantRaw);
  if (merchantNormalized === null && txn.remittanceInformation?.length) {
    const remittance = txn.remittanceInformation.join(' ');
    const fromRemittance = normalizeMerchantName(remittance);
    if (fromRemittance !== null) {
      merchantRaw = remittance;
      merchantNormalized = fromRemittance;
    }
  }

  // Amount always positive; foreign-currency charges convert to the
  // account's native currency at the corrected date's cached rate.
  const amtBig = qCent(dec(txn.amount).abs());
  const amount = amtBig.toFixed(2);
  const effectiveDate = pickTransactionDate(txn);

  let amountInAccountCcy: string;
  let exchangeRate: string;
  if (txn.currency.toLowerCase() === accountCurrency.toLowerCase()) {
    amountInAccountCcy = amount;
    exchangeRate = '1.0000';
  } else {
    const rates = await getRatesForDate(effectiveDate);
    const converted = tryConvert(amtBig, txn.currency, accountCurrency, rates);
    if (converted === null) {
      console.error(
        `[bank-sync] SKIPPED: No FX rate for ${txn.currency}→${accountCurrency} on ${effectiveDate}. Transaction not imported to prevent corrupt amount_in_account_ccy.`,
      );
      return null;
    }
    amountInAccountCcy = converted.toFixed(2);
    exchangeRate = amtBig.gt(new Big('0'))
      ? qRate(converted.div(amtBig)).toFixed(4)
      : '1.0000';
  }

  return {
    type,
    sourceDescription,
    note,
    merchantRaw,
    merchantNormalized,
    amount,
    amountInAccountCcy,
    exchangeRate,
    effectiveDate,
    currency: txn.currency,
  };
}

interface FetchPage {
  transactions: EnableBankingTransaction[];
  /**
   * True when pagination was cut short by the PSD2 rate limit, so the
   * returned set is INCOMPLETE - later pages were never fetched. Callers
   * must treat a rate-limited set as partial: do NOT run the pending
   * disappearance sweep against it (it would delete still-pending rows the
   * truncated fetch never re-saw) and do NOT advance the booked cursor (so
   * the next sync re-fetches the missing pages).
   */
  rateLimited: boolean;
  /**
   * True when the bank REJECTED the explicit `transaction_status=PDNG`
   * filter (an ASPSP-side 400 / ASPSP_ERROR) and we fell back to an
   * unfiltered fetch. The pending set is best-effort and possibly empty, so
   * - like a rate-limited set - it must NOT drive the disappearance sweep.
   * Only ever set on the pending path; the booked path leaves it false.
   */
  rejected: boolean;
}

/**
 * Whether an error from a `transaction_status`-filtered fetch is a bank-side
 * rejection of the filter - common for ASPSPs that don't support querying by
 * settlement status at all (they reject BOTH the PDNG and the BOOK form with
 * a generic 400 / ASPSP_ERROR). These are recoverable (we retry unfiltered)
 * and must NOT abort the whole sync. Auth (401/403), session (404) and
 * server (5xx) failures deliberately return false: those would break an
 * unfiltered fetch too and should hard-fail.
 *
 * (Named for the pending path where the pattern was first seen; the booked
 * path uses the same predicate via fetchBookedResilient.)
 */
export function isPendingFetchRejection(err: unknown): boolean {
  if (!(err instanceof EBApiError)) return false;
  if (err.code === 'ASPSP_ERROR') return true;
  return err.status === 400 || err.status === 422;
}

/**
 * Fetch every page of a single transaction_status set into one array.
 *
 * PSD2 caps unattended access at ~4 requests/account/day. When the limit is
 * hit mid-pagination we KEEP the pages already fetched and flag the set
 * incomplete, rather than discarding the partial progress and aborting the
 * whole sync (the old behaviour, which silently lost data and re-burned the
 * request budget from page 1 on the next attempt).
 */
async function fetchAllTransactions(
  uid: string,
  dateFrom: string,
  dateTo: string,
  /** Omit for an UNFILTERED fetch (used by the resilient fallbacks). */
  transactionStatus?: 'booked' | 'pending',
): Promise<FetchPage> {
  const out: EnableBankingTransaction[] = [];
  let continuationKey: string | undefined = undefined;
  let hasMore = true;
  const label = transactionStatus ?? 'unfiltered';
  while (hasMore) {
    let result;
    try {
      result = await ebService.getTransactions(uid, {
        continuationKey,
        dateFrom,
        dateTo,
        transactionStatus,
      });
    } catch (err) {
      if (err instanceof EBRateLimitError) {
        console.log(
          `[sync] rate limit during ${label} pagination for ${uid}; keeping ${out.length} fetched so far (set is incomplete).`,
        );
        return { transactions: out, rateLimited: true, rejected: false };
      }
      throw err;
    }
    out.push(...result.transactions);
    continuationKey = result.continuationKey;
    hasMore = !!result.continuationKey;
  }
  return { transactions: out, rateLimited: false, rejected: false };
}

/**
 * Fetch the pending set resiliently. Some ASPSPs reject the explicit
 * `transaction_status=PDNG` filter with a generic 400 / ASPSP_ERROR. Rather
 * than letting that abort the entire account sync (the booked fetch and
 * balance never run), we:
 *   1. try the normal filtered pending fetch, then
 *   2. on a recognised rejection, retry ONCE with an UNFILTERED fetch and
 *      harvest only the entries the bank itself tags `PDNG`. (Many banks
 *      return pending entries inline in the default response even when they
 *      reject the explicit filter; some return booked-only, in which case
 *      this legitimately yields zero pending - acceptable.)
 *
 * The fallback is intentionally single-page: pending windows are short (14
 * days) and pending counts small, and a second paginated sweep would risk
 * the PSD2 ~4-requests/account/day budget. A `rejected` (or rate-limited)
 * result is flagged incomplete so the caller skips the disappearance sweep.
 */
async function fetchPendingResilient(
  uid: string,
  pendingFrom: string,
  dateTo: string,
): Promise<FetchPage> {
  try {
    return await fetchAllTransactions(uid, pendingFrom, dateTo, 'pending');
  } catch (err) {
    if (err instanceof EBRateLimitError) {
      return { transactions: [], rateLimited: true, rejected: false };
    }
    if (!isPendingFetchRejection(err)) {
      throw err;
    }
    console.warn(
      `[sync] ASPSP rejected the pending (PDNG) filter for ${uid} (${
        err instanceof EBApiError ? err.code ?? err.status : 'unknown'
      }); retrying unfiltered to recover pending entries.`,
    );
    try {
      const res = await ebService.getTransactions(uid, {
        dateFrom: pendingFrom,
        dateTo,
      });
      const pendingOnly = res.transactions.filter((t) => t.status === 'PDNG');
      console.log(
        `[sync] unfiltered fallback for ${uid} recovered ${pendingOnly.length} pending entr${
          pendingOnly.length === 1 ? 'y' : 'ies'
        }.`,
      );
      return { transactions: pendingOnly, rateLimited: false, rejected: true };
    } catch (fallbackErr) {
      if (fallbackErr instanceof EBRateLimitError) {
        return { transactions: [], rateLimited: true, rejected: true };
      }
      console.warn(
        `[sync] unfiltered pending fallback also failed for ${uid}; continuing with booked only.`,
        fallbackErr,
      );
      return { transactions: [], rateLimited: false, rejected: true };
    }
  }
}

/**
 * Fetch the booked set resiliently. ASPSPs that reject the
 * `transaction_status` filter reject the BOOK form exactly like the PDNG
 * form (same generic 400 / ASPSP_ERROR) - so without this fallback the
 * pending path recovers and the sync then dies one call later on the booked
 * fetch, surfacing "Error interacting with ASPSP" on every boot sync.
 *
 * On a recognised rejection we retry the SAME window unfiltered, fully
 * paginated (unlike the pending fallback, booked windows can span months),
 * and keep only entries the bank does NOT tag PDNG: the default response is
 * the booked ledger for every known ASPSP, and pending entries - if a bank
 * returns them inline - belong to the pending path. A rate limit during the
 * fallback keeps the partial pages and flags the set incomplete, same as
 * the filtered path. Any other fallback failure is a real API problem and
 * hard-fails (surfaces in the sync-error banner).
 *
 * Exported for tests only - production callers go through syncTransactions.
 */
export async function fetchBookedResilient(
  uid: string,
  bookedFrom: string,
  dateTo: string,
  opts: {
    /**
     * The pending fetch already saw this bank reject the status filter this
     * sync - skip the doomed BOOK-filtered attempt and go straight to the
     * unfiltered form, saving one request of the ~4/account/day PSD2 budget.
     */
    statusFilterRejected?: boolean;
  } = {},
): Promise<FetchPage> {
  try {
    if (opts.statusFilterRejected) {
      console.log(
        `[sync] skipping the BOOK-filtered fetch for ${uid} - this bank rejected the status filter on the pending fetch.`,
      );
      const page = await fetchAllTransactions(uid, bookedFrom, dateTo);
      return {
        ...page,
        transactions: page.transactions.filter((t) => t.status !== 'PDNG'),
      };
    }
    return await fetchAllTransactions(uid, bookedFrom, dateTo, 'booked');
  } catch (err) {
    if (!isPendingFetchRejection(err)) {
      throw err;
    }
    console.warn(
      `[sync] ASPSP rejected the booked (BOOK) filter for ${uid} (${
        err instanceof EBApiError ? err.code ?? err.status : 'unknown'
      }); retrying unfiltered.`,
    );
    const page = await fetchAllTransactions(uid, bookedFrom, dateTo);
    const bookedOnly = page.transactions.filter((t) => t.status !== 'PDNG');
    console.log(
      `[sync] unfiltered booked fallback for ${uid} recovered ${bookedOnly.length} entr${
        bookedOnly.length === 1 ? 'y' : 'ies'
      } (${page.transactions.length - bookedOnly.length} pending dropped).`,
    );
    return { ...page, transactions: bookedOnly };
  }
}

/** Project a local pending row into the matcher's candidate shape. */
function rowToCandidate(r: TransactionRow): PendingCandidate {
  return {
    id: r.id,
    direction: directionFromType(r.type),
    currency: r.currency,
    amount: r.amount,
    date: r.date,
  };
}

export async function syncTransactions(
  linkedAccountId: string,
  opts: { ignoreFloor?: boolean } = {},
): Promise<{ imported: number; skipped: number; rateLimited: boolean }> {
  // Scope every read/write to the active workspace (invariant #2). The id is
  // internal today, but scoping the lookups keeps a stray cross-workspace id
  // from ever resolving.
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const linked = await db.select<LinkedAccountRow[]>(
    'SELECT * FROM linked_accounts WHERE id = ? AND koinkat_account_id = ?',
    [linkedAccountId, koinkatAccountId],
  );
  if (linked.length === 0) return { imported: 0, skipped: 0, rateLimited: false };
  const la = linked[0];

  const acctRows = await db.select<AccountRow[]>(
    'SELECT * FROM accounts WHERE id = ? AND koinkat_account_id = ?',
    [la.account_id, koinkatAccountId],
  );
  if (acctRows.length === 0) return { imported: 0, skipped: 0, rateLimited: false };

  const accountCurrency = acctRows[0].currency;
  let imported = 0;
  let skipped = 0;
  // Set true when either the pending or booked fetch was truncated by the
  // PSD2 rate limit. Hoisted so the post-try return can read it.
  let syncIncomplete = false;
  // Newly INSERTED rows (pending + new booked) get a categorization pass.
  // Flipped rows are intentionally excluded - they keep whatever category
  // the user already set while the row was pending.
  const newImportedIds: string[] = [];

  // Captured before any per-row work so the disappearance sweep can tell
  // "seen this sync" (last-seen stamped == this value) from "not re-seen"
  // (last-seen predates it). ISO so lexical compare == chronological.
  const syncStartedAt = new Date().toISOString();

  // Booked window (existing floor/delta logic).
  const today = new Date();
  const dateTo = format(today, 'yyyy-MM-dd');
  const effectiveFloor = opts.ignoreFloor
    ? format(subDays(today, 180), 'yyyy-MM-dd')
    : la.sync_start_date ?? format(subDays(today, 180), 'yyyy-MM-dd');
  const bookedFrom = la.last_synced_at
    ? format(subDays(parseISO(la.last_synced_at), 1), 'yyyy-MM-dd')
    : effectiveFloor;

  // Pending window: a fixed recent slice, independent of the booked floor,
  // because pending entries are short-lived. Also the strict scope for
  // auto-removal - a pending row outside it is never deleted.
  const pendingFrom = format(subDays(today, PENDING_WINDOW_DAYS), 'yyyy-MM-dd');

  try {
    // ── 1 + 2. Fetch pending and booked sets (3 of the 4 daily PSD2
    // requests/account, together with the balance call). ──
    // The pending fetch is resilient: a bank that rejects the PDNG filter
    // degrades to an unfiltered fallback (or empty) instead of aborting the
    // whole sync, so the booked fetch below always runs.
    const pendingPage = await fetchPendingResilient(
      la.external_account_uid,
      pendingFrom,
      dateTo,
    );
    // Booked is resilient too: a bank that rejects the status filter rejects
    // BOOK exactly like PDNG, and the whole point of surviving the pending
    // rejection is lost if the very next call aborts the account sync.
    const bookedPage = await fetchBookedResilient(
      la.external_account_uid,
      bookedFrom,
      dateTo,
      { statusFilterRejected: pendingPage.rejected },
    );
    const pendingEntries = pendingPage.transactions;
    const bookedEntries = bookedPage.transactions;
    // An incomplete set (rate-limited, OR a best-effort fallback after a
    // PDNG rejection) must not drive destructive cleanup - see the guard in
    // step 5. The booked cursor (step 6) keys only on the booked set, so a
    // pending rejection never strands the booked window. A pending-only
    // degradation is intentionally NOT counted in syncIncomplete: booked is
    // current and the balance is reconciled, so we don't raise the soft
    // "sync incomplete" banner for a bank that merely lacks pending support.
    const pendingComplete = !pendingPage.rateLimited && !pendingPage.rejected;
    const bookedComplete = !bookedPage.rateLimited;
    syncIncomplete = pendingPage.rateLimited || bookedPage.rateLimited;

    // Working pool of this account's local pending rows that a booked
    // entry may claim. A claimed row is spliced out so two booked entries
    // can't both flip it.
    let availablePending = await db.select<TransactionRow[]>(
      "SELECT * FROM transactions WHERE koinkat_account_id = ? AND account_id = ? AND status = 'pending'",
      [koinkatAccountId, la.account_id],
    );

    // ── 3. Process booked entries. ──
    for (const txn of bookedEntries) {
      // Defensive: ignore anything the bank didn't actually mark booked.
      if (txn.status === 'PDNG') {
        skipped++;
        continue;
      }

      // a. Dedup against an already-imported booked row.
      const externalRef = txn.entryReference ?? null;
      if (externalRef) {
        const existing = await db.select<{ id: string }[]>(
          'SELECT id FROM transactions WHERE koinkat_account_id = ? AND external_ref = ? AND account_id = ?',
          [koinkatAccountId, externalRef, la.account_id],
        );
        if (existing.length > 0) {
          skipped++;
          continue;
        }
      }

      const fields = await buildImportFields(txn, accountCurrency);
      if (!fields) {
        skipped++;
        continue;
      }
      const bankTxnId = txn.transactionId ?? txn.entryReference ?? null;

      // b. Try to claim a local pending row → flip it in place.
      const bookedEntry: BookedEntry = {
        direction: directionFromIndicator(txn.creditDebitIndicator),
        currency: txn.currency,
        amount: fields.amount,
        date: fields.effectiveDate,
      };
      const match = matchBookedToPending(
        bookedEntry,
        availablePending.map(rowToCandidate),
      );
      if (match) {
        const claimedRow = availablePending.find((r) => r.id === match.id)!;
        // Keep the earlier of the pending row's date and the booked entry's
        // date so the row stays filed under when the purchase happened, not
        // the later settlement/registration date. booking_date below still
        // records the bank's posting date.
        const flipDate = pickFlipDate(claimedRow.date, fields.effectiveDate);
        // Flip to booked with the authoritative booked values. Preserve
        // category_id, categorization_source, confirmed_at, needs_review,
        // note, budget_event_id, event_link_pinned - i.e. everything the
        // user touched while it was pending. No balance math: syncBalance
        // owns the account balance.
        await db.execute(
          `UPDATE transactions
              SET status = 'booked',
                  external_ref = ?,
                  bank_transaction_id = ?,
                  date = ?,
                  amount = ?,
                  exchange_rate = ?,
                  amount_in_account_ccy = ?,
                  source_description = ?,
                  booking_date = ?,
                  pending_fingerprint = NULL,
                  pending_last_seen_at = NULL,
                  updated_at = datetime('now')
            WHERE id = ? AND koinkat_account_id = ?`,
          [
            externalRef,
            bankTxnId,
            flipDate,
            fields.amount,
            fields.exchangeRate,
            fields.amountInAccountCcy,
            fields.sourceDescription,
            txn.bookingDate,
            match.id,
            koinkatAccountId,
          ],
        );
        availablePending = availablePending.filter((r) => r.id !== match.id);

        // Now that it's a real booked spend, auto-capture into a matching
        // budget event - unless the user pinned the link while pending.
        if (claimedRow.event_link_pinned !== 1) {
          try {
            await applyAutoCaptureForTransaction(match.id);
          } catch (err) {
            console.warn(
              `[bank-sync] applyAutoCaptureForTransaction failed on flip for ${match.id}:`,
              err,
            );
          }
        }
        continue;
      }

      // c. No pending row to claim → ordinary new booked insert.
      const txnId = crypto.randomUUID();
      await db.execute(
        `INSERT INTO transactions
           (id, koinkat_account_id, account_id, destination_account_id, related_transaction_id,
            type, amount, currency, exchange_rate, amount_in_account_ccy,
            amount_in_dest_ccy, category_id, note, date, is_budgeted, budget_event_id,
            external_ref, merchant_raw, merchant_normalized, needs_review,
            source_description, booking_date, event_link_pinned,
            status, bank_transaction_id,
            recorded_at, created_at, updated_at)
         VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, 1, NULL,
                 ?, ?, ?, 1,
                 ?, ?, 0,
                 'booked', ?,
                 datetime('now'), datetime('now'), datetime('now'))`,
        [
          txnId,
          koinkatAccountId,
          la.account_id,
          fields.type,
          fields.amount,
          fields.currency,
          fields.exchangeRate,
          fields.amountInAccountCcy,
          fields.note,
          fields.effectiveDate,
          externalRef,
          fields.merchantRaw,
          fields.merchantNormalized,
          fields.sourceDescription,
          txn.bookingDate,
          bankTxnId,
        ],
      );
      newImportedIds.push(txnId);
      imported++;

      try {
        await applyAutoCaptureForTransaction(txnId);
      } catch (err) {
        console.warn(
          `[bank-sync] applyAutoCaptureForTransaction failed for ${txnId}:`,
          err,
        );
      }
    }

    // ── 4. Process pending entries. Re-read live pending rows so any rows
    // just flipped in step 3 are excluded. ──
    const livePending = await db.select<TransactionRow[]>(
      "SELECT * FROM transactions WHERE koinkat_account_id = ? AND account_id = ? AND status = 'pending'",
      [koinkatAccountId, la.account_id],
    );
    for (const txn of pendingEntries) {
      // Defensive: some banks ignore the transaction_status filter and
      // return booked entries here too. Those are handled by the booked
      // loop - never import a settled entry as pending.
      if (txn.status === 'BOOK') continue;

      const fields = await buildImportFields(txn, accountCurrency);
      if (!fields) {
        skipped++;
        continue;
      }
      const bankTxnId = txn.transactionId ?? txn.entryReference ?? null;
      const fingerprint = computePendingFingerprint({
        accountId: la.account_id,
        direction: directionFromIndicator(txn.creditDebitIndicator),
        amount: fields.amount,
        currency: txn.currency,
        merchantNormalized: fields.merchantNormalized,
        transactionDate: fields.effectiveDate,
      });

      // Re-match by stable bank id first, then by fingerprint.
      let existing =
        bankTxnId != null
          ? livePending.find((r) => r.bank_transaction_id === bankTxnId)
          : undefined;
      if (!existing) {
        existing = livePending.find(
          (r) => r.pending_fingerprint === fingerprint,
        );
      }

      if (existing) {
        // Still pending → bump last-seen; refresh drifted amount/date and
        // recompute the fingerprint.
        await db.execute(
          `UPDATE transactions
              SET pending_last_seen_at = ?,
                  date = ?,
                  amount = ?,
                  exchange_rate = ?,
                  amount_in_account_ccy = ?,
                  pending_fingerprint = ?,
                  bank_transaction_id = COALESCE(?, bank_transaction_id),
                  updated_at = datetime('now')
            WHERE id = ? AND koinkat_account_id = ?`,
          [
            syncStartedAt,
            fields.effectiveDate,
            fields.amount,
            fields.exchangeRate,
            fields.amountInAccountCcy,
            fingerprint,
            bankTxnId,
            existing.id,
            koinkatAccountId,
          ],
        );
        existing.pending_last_seen_at = syncStartedAt;
        existing.pending_fingerprint = fingerprint;
        continue;
      }

      // New pending row: balance-neutral, in the review queue, no auto-
      // capture yet (that happens when it books). Pre-categorized so it's
      // ready the moment it settles.
      const txnId = crypto.randomUUID();
      await db.execute(
        `INSERT INTO transactions
           (id, koinkat_account_id, account_id, destination_account_id, related_transaction_id,
            type, amount, currency, exchange_rate, amount_in_account_ccy,
            amount_in_dest_ccy, category_id, note, date, is_budgeted, budget_event_id,
            external_ref, merchant_raw, merchant_normalized, needs_review,
            source_description, booking_date, event_link_pinned,
            status, bank_transaction_id, pending_last_seen_at, pending_fingerprint,
            recorded_at, created_at, updated_at)
         VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, 1, NULL,
                 ?, ?, ?, 1,
                 ?, ?, 0,
                 'pending', ?, ?, ?,
                 datetime('now'), datetime('now'), datetime('now'))`,
        [
          txnId,
          koinkatAccountId,
          la.account_id,
          fields.type,
          fields.amount,
          fields.currency,
          fields.exchangeRate,
          fields.amountInAccountCcy,
          fields.note,
          fields.effectiveDate,
          txn.entryReference ?? null,
          fields.merchantRaw,
          fields.merchantNormalized,
          fields.sourceDescription,
          txn.bookingDate ?? null,
          bankTxnId,
          syncStartedAt,
          fingerprint,
        ],
      );
      // Track in-memory so a duplicate pending entry in the same batch
      // re-matches instead of inserting twice.
      livePending.push({
        ...(claimableStub(txnId, la.account_id, fields)),
        bank_transaction_id: bankTxnId,
        pending_fingerprint: fingerprint,
        pending_last_seen_at: syncStartedAt,
      } as TransactionRow);
      newImportedIds.push(txnId);
      imported++;
    }

    // ── 5. Disappearance sweep: remove pending rows in the queried window
    // that were NOT re-seen this sync (and weren't claimed as booked).
    // Balance-neutral, so nothing to reverse. Only ever deletes pending
    // rows - never booked or manual.
    //
    // SKIPPED when the pending fetch was rate-limited: an incomplete pending
    // set would make still-pending rows look "disappeared" and wrongly
    // delete them. ──
    if (pendingComplete) {
      await db.execute(
        `DELETE FROM transactions
          WHERE koinkat_account_id = ?
            AND account_id = ?
            AND status = 'pending'
            AND date >= ?
            AND date <= ?
            AND (pending_last_seen_at IS NULL OR pending_last_seen_at < ?)`,
        [koinkatAccountId, la.account_id, pendingFrom, dateTo, syncStartedAt],
      );
    } else {
      console.log(
        `[sync] pending fetch incomplete for ${la.external_account_uid} - skipping disappearance sweep to avoid deleting unseen pending rows.`,
      );
    }

    // ── 6. Tail: stamp sync time, reconcile balance to the bank, and
    // categorize the freshly inserted rows.
    //
    // Only advance last_synced_at when the BOOKED set was complete. If it was
    // truncated by the rate limit, keep the old cursor so the next sync
    // re-fetches this same window and the dedupe picks up the missing pages
    // (rather than jumping the cursor forward and stranding them forever). ──
    // (sync_cursor is intentionally untouched here: the column was a
    // placeholder for cursor-based pagination that never landed, and the
    // old `sync_cursor = NULL` writes were dead - nothing ever set it.)
    if (bookedComplete) {
      await db.execute(
        "UPDATE linked_accounts SET last_synced_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
        [linkedAccountId],
      );
    } else {
      await db.execute(
        "UPDATE linked_accounts SET updated_at = datetime('now') WHERE id = ?",
        [linkedAccountId],
      );
    }

    await syncBalance(linkedAccountId);

    if (newImportedIds.length > 0) {
      try {
        await categorizer.categorizeBatch(newImportedIds);
      } catch (err) {
        console.warn(
          `[bank-sync] categorizeBatch failed for linked account ${linkedAccountId}:`,
          err,
        );
      }

      // Recurring auto-recognition runs after categorization so a confident
      // match can read (and clear) the just-assigned category. Guarded so a
      // matcher failure never fails the sync.
      // future: recurrence discovery could also pre-tick unflagged merchants
      // here, respecting recurring_dismissals.
      try {
        await applyRecurringMatchOnImport(newImportedIds);
      } catch (err) {
        console.warn(
          `[bank-sync] applyRecurringMatchOnImport failed for linked account ${linkedAccountId}:`,
          err,
        );
      }
    }
  } catch (err) {
    if (err instanceof EBRateLimitError) {
      console.log(
        `[sync] rate limit hit on transactions for ${la.external_account_uid} - will retry on next sync cycle. Imported=${imported}, skipped=${skipped} so far.`,
      );
      // A rate limit that escaped fetchAllTransactions (e.g. from a balance
      // call) still means this account's sync is incomplete.
      return { imported, skipped, rateLimited: true };
    }
    console.error(`Failed to sync transactions for ${linkedAccountId}:`, err);
    throw err;
  }

  return { imported, skipped, rateLimited: syncIncomplete };
}

/**
 * Minimal in-memory TransactionRow stand-in for a just-inserted pending
 * row, used only to re-match a duplicate pending entry within the same
 * sync batch. Only the fields the matcher / re-match logic reads are
 * meaningful; the rest are nulled defaults.
 */
function claimableStub(
  id: string,
  accountId: string,
  fields: ImportFields,
): TransactionRow {
  return {
    id,
    account_id: accountId,
    type: fields.type,
    amount: fields.amount,
    currency: fields.currency,
    date: fields.effectiveDate,
    status: 'pending',
  } as unknown as TransactionRow;
}

// ── Sync all ────────────────────────────────────────────────────────────

export async function syncAll(): Promise<{ incomplete: boolean }> {
  const config = await loadApiConfig();
  if (!config.isConfigured) return { incomplete: false };

  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const connections = await db.select<BankConnectionRow[]>(
    "SELECT * FROM bank_connections WHERE koinkat_account_id = ? AND status = 'active'",
    [koinkatAccountId],
  );

  const errors: string[] = [];
  let incomplete = false;
  for (const conn of connections) {
    if (conn.valid_until && isConnectionExpired(conn.valid_until)) {
      await db.execute(
        "UPDATE bank_connections SET status = 'expired', updated_at = datetime('now') WHERE id = ? AND koinkat_account_id = ?",
        [conn.id, koinkatAccountId],
      );
      continue;
    }

    const linkedAccounts = await db.select<LinkedAccountRow[]>(
      'SELECT * FROM linked_accounts WHERE bank_connection_id = ? AND koinkat_account_id = ?',
      [conn.id, koinkatAccountId],
    );

    for (const la of linkedAccounts) {
      try {
        const result = await syncTransactions(la.id);
        if (result.rateLimited) incomplete = true;
      } catch (err) {
        // Don't let one account's failure block the rest. Collect the
        // error and decide whether to surface it after the loop.
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`linked_account ${la.id}: ${msg}`);
      }
    }

    await db.execute(
      "UPDATE bank_connections SET last_synced_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND koinkat_account_id = ?",
      [conn.id, koinkatAccountId],
    );
  }

  if (errors.length > 0) {
    throw new Error(`Sync completed with errors:\n${errors.join('\n')}`);
  }
  return { incomplete };
}

// ── Full resync ─────────────────────────────────────────────────────────

/**
 * Force a full history re-fetch by clearing `last_synced_at` on every
 * linked account under the active koinkat account and then running
 * `syncAll()`. Without this, `syncTransactions` would take the delta
 * branch and only ask the bank for yesterday→today.
 *
 * Useful for recovering from earlier runs where the initial sync window
 * was wrongly narrowed (e.g. the syncBalance-stamps-last_synced_at bug).
 */
export async function resyncFullHistory(): Promise<{ incomplete: boolean }> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  await db.execute(
    `UPDATE linked_accounts
        SET last_synced_at = NULL,
            updated_at = datetime('now')
      WHERE koinkat_account_id = ?`,
    [koinkatAccountId],
  );
  return syncAll();
}

/**
 * Full-history override: resync every linked account in the active
 * koinkat account, IGNORING each account's stored `sync_start_date`.
 * Reaches back to the 180-day maximum (or as far as each bank allows).
 *
 * This is destructive for the Review queue: transactions already
 * categorized and confirmed will be re-imported with `needs_review = 1`
 * again (via the external_ref dedupe path). Warn the user with a
 * confirmation modal before calling this.
 */
export async function resyncFullHistoryOverride(): Promise<{ incomplete: boolean }> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  // Clear last_synced_at across the active workspace so every linked
  // account falls into the "initial sync" branch of syncTransactions.
  await db.execute(
    `UPDATE linked_accounts
        SET last_synced_at = NULL,
            updated_at = datetime('now')
      WHERE koinkat_account_id = ?`,
    [koinkatAccountId],
  );

  const config = await loadApiConfig();
  if (!config.isConfigured) return { incomplete: false };

  const connections = await db.select<BankConnectionRow[]>(
    "SELECT * FROM bank_connections WHERE koinkat_account_id = ? AND status = 'active'",
    [koinkatAccountId],
  );
  const errors: string[] = [];
  let incomplete = false;
  for (const conn of connections) {
    if (conn.valid_until && isConnectionExpired(conn.valid_until)) continue;
    const linkedAccounts = await db.select<LinkedAccountRow[]>(
      'SELECT * FROM linked_accounts WHERE bank_connection_id = ?',
      [conn.id],
    );
    for (const la of linkedAccounts) {
      try {
        const result = await syncTransactions(la.id, { ignoreFloor: true });
        if (result.rateLimited) incomplete = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`linked_account ${la.id}: ${msg}`);
      }
    }
    await db.execute(
      "UPDATE bank_connections SET last_synced_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      [conn.id],
    );
  }

  if (errors.length > 0) {
    throw new Error(`Resync completed with errors:\n${errors.join('\n')}`);
  }
  return { incomplete };
}

/**
 * Lower the floor on a single bank_connection's linked accounts and
 * trigger a delta fetch from the new floor. Used by the "Pull older
 * history" action in Settings.
 */
/**
 * Insert the 'pending' bank_connections row that anchors an in-flight OAuth
 * authorization. Extracted from BankLink so the page layer doesn't own SQL,
 * and so mock + real paths share one implementation.
 */
export async function createPendingBankConnection(params: {
  bankName: string;
  bankCountry: string;
  authorizationId: string;
}): Promise<string> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const connectionId = crypto.randomUUID();
  await db.execute(
    `INSERT INTO bank_connections (id, koinkat_account_id, aspsp_name, aspsp_country, authorization_id, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`,
    [connectionId, koinkatAccountId, params.bankName, params.bankCountry, params.authorizationId],
  );
  return connectionId;
}

/**
 * Remove a 'pending' connection row for an abandoned/failed OAuth attempt.
 * Only ever touches pending rows - an activated connection is never deleted
 * here. Without this cleanup, every canceled attempt left a dead
 * "Status: pending" row in Settings forever.
 */
export async function deletePendingBankConnection(
  authorizationId: string,
): Promise<void> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  await db.execute(
    `DELETE FROM bank_connections
      WHERE authorization_id = ? AND status = 'pending' AND koinkat_account_id = ?`,
    [authorizationId, koinkatAccountId],
  );
}

export async function pullOlderHistory(
  bankConnectionId: string,
  newFloor: string,
): Promise<{ imported: number; skipped: number; incomplete: boolean }> {
  // Settings stays mounted across workspace switches, so the connectionId
  // it passes can go stale - scope every statement to the active workspace.
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  // Update the floor on every linked account under this connection AND
  // clear last_synced_at so the next syncTransactions pulls from the floor.
  await db.execute(
    `UPDATE linked_accounts
        SET sync_start_date = ?,
            last_synced_at = NULL,
            updated_at = datetime('now')
      WHERE bank_connection_id = ? AND koinkat_account_id = ?`,
    [newFloor, bankConnectionId, koinkatAccountId],
  );

  const linkedAccounts = await db.select<LinkedAccountRow[]>(
    'SELECT * FROM linked_accounts WHERE bank_connection_id = ? AND koinkat_account_id = ?',
    [bankConnectionId, koinkatAccountId],
  );
  let imported = 0;
  let skipped = 0;
  let incomplete = false;
  const errors: string[] = [];
  for (const la of linkedAccounts) {
    try {
      const result = await syncTransactions(la.id);
      imported += result.imported;
      skipped += result.skipped;
      if (result.rateLimited) incomplete = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`linked_account ${la.id}: ${msg}`);
    }
  }
  await db.execute(
    "UPDATE bank_connections SET last_synced_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND koinkat_account_id = ?",
    [bankConnectionId, koinkatAccountId],
  );
  if (errors.length > 0) {
    throw new Error(`Pull older history completed with errors:\n${errors.join('\n')}`);
  }
  return { imported, skipped, incomplete };
}

/**
 * Returns a summary of the import floor currently in use on a bank
 * connection - aggregated across all its linked accounts.
 *
 * `floor` is the MIN(sync_start_date) across the connection's linked
 * accounts (so the earliest effective import date). Null when all
 * linked accounts have NULL sync_start_date, which means the 180-day
 * default is in effect.
 */
export async function getConnectionSyncFloor(
  bankConnectionId: string,
): Promise<{ floor: string | null }> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<{ min_floor: string | null }[]>(
    `SELECT MIN(sync_start_date) AS min_floor
       FROM linked_accounts
      WHERE bank_connection_id = ? AND koinkat_account_id = ?`,
    [bankConnectionId, koinkatAccountId],
  );
  return { floor: rows[0]?.min_floor ?? null };
}

// ── Re-clean imported notes ─────────────────────────────────────────────

/**
 * Re-runs `cleanImportDescription` over every bank-imported transaction
 * in the active workspace whose `note` is still the unmodified raw
 * remittance text. Manually edited notes are left alone (their `note`
 * no longer equals `source_description`).
 *
 * Useful after the cleaner is updated: a developer ships better strip
 * rules, and the user clicks "Re-clean notes" on the Review page to
 * apply them to historical rows.
 *
 * Limitations:
 *   - Rows imported BEFORE migration v9 have NULL source_description
 *     and are skipped (we don't have the raw text to re-clean).
 *   - We filter `categorization_source != 'user_manual'` as a defence
 *     in depth even though the manual-rows path doesn't populate
 *     source_description.
 *
 * Returns the count of rows whose `note` was actually changed.
 */
export async function recleanImportedNotes(): Promise<number> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();

  const rows = await db.select<
    { id: string; source_description: string; note: string | null }[]
  >(
    `SELECT id, source_description, note
       FROM transactions
      WHERE koinkat_account_id = ?
        AND source_description IS NOT NULL
        AND note = source_description
        AND (categorization_source IS NULL
             OR categorization_source != 'user_manual')`,
    [koinkatAccountId],
  );

  let updated = 0;
  for (const row of rows) {
    const cleaned = cleanImportDescription(row.source_description);
    const nextNote = cleaned ?? row.note ?? 'Bank transaction';
    if (nextNote === row.note) continue;
    await db.execute(
      `UPDATE transactions
          SET note = ?, updated_at = datetime('now')
        WHERE id = ? AND koinkat_account_id = ?`,
      [nextNote, row.id, koinkatAccountId],
    );
    updated++;
  }
  return updated;
}

// ── Disconnect bank ─────────────────────────────────────────────────────

export async function disconnectBank(connectionId: string): Promise<void> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const connRows = await db.select<BankConnectionRow[]>(
    'SELECT * FROM bank_connections WHERE id = ? AND koinkat_account_id = ?',
    [connectionId, koinkatAccountId],
  );
  if (connRows.length === 0) return;
  const conn = connRows[0];

  if (conn.session_id && !conn.is_demo) {
    try {
      await ebService.deleteSession(conn.session_id);
    } catch { /* session may already be expired */ }
  }

  // Convert linked accounts to manual (keep accounts + transactions), then
  // drop the link rows + connection - atomically, so a failure can't leave
  // a connection without linked accounts (or vice versa).
  // `connectionId` is already proven in-workspace by the gating query above;
  // the extra koinkat_account_id filters keep these consistent with invariant #2.
  await withTransaction(async (tx) => {
    const linkedAccounts = await tx.select<LinkedAccountRow[]>(
      'SELECT * FROM linked_accounts WHERE bank_connection_id = ? AND koinkat_account_id = ?',
      [connectionId, koinkatAccountId],
    );
    for (const la of linkedAccounts) {
      await tx.execute(
        "UPDATE accounts SET is_manual = 1, updated_at = datetime('now') WHERE id = ? AND koinkat_account_id = ?",
        [la.account_id, koinkatAccountId],
      );
    }

    await tx.execute(
      'DELETE FROM linked_accounts WHERE bank_connection_id = ? AND koinkat_account_id = ?',
      [connectionId, koinkatAccountId],
    );
    await tx.execute(
      'DELETE FROM bank_connections WHERE id = ? AND koinkat_account_id = ?',
      [connectionId, koinkatAccountId],
    );
  });
}
