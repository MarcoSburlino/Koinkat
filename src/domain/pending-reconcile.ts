// Pure reconciliation predicates for the pending-transaction lifecycle.
//
// These functions have NO database or network access so they can be unit
// tested in isolation. bank-sync-service.ts is the orchestrator that pulls
// rows out of SQLite, calls these to decide what to flip / insert / delete,
// and writes the results back.
//
//   - computePendingFingerprint: deterministic re-match key for a pending
//     entry that lacks a stable bank id.
//   - matchBookedToPending: fuzzy claim of a booked entry onto a local
//     pending row (the pending -> booked flip).
//   - isPendingDisappeared: whether a local pending row was NOT re-seen in
//     the current sync and should be auto-removed.

import Big from 'big.js';
import { differenceInCalendarDays, parseISO } from 'date-fns';

// ── Tunable constants ───────────────────────────────────────────────────

/**
 * Lookback window (days) for the `transaction_status=pending` fetch and
 * the disappearance sweep. Pending entries are short-lived, so we only
 * ever query / reconcile this recent slice. Also the strict scope for
 * auto-removal - a pending row outside this window is never deleted.
 */
export const PENDING_WINDOW_DAYS = 14;

/**
 * Max |date difference| (days) for a booked entry to claim a local
 * pending row. Pre-auth date and final booking date can differ by a few
 * days; 5 covers weekends + slow settlement without over-reaching.
 */
export const PENDING_MATCH_DATE_WINDOW_DAYS = 5;

/**
 * Amount tolerance as a fraction of the larger amount. `0` = exact match
 * only (current default). Bump to e.g. `0.05` to let fuel/tip pre-auths
 * (which book at a different final amount) still claim their pending row
 * and keep the user's category / notes.
 */
export const PENDING_MATCH_AMOUNT_TOLERANCE_PCT = 0;

/**
 * Disappearance grace. Default: delete a pending row on the first sync it
 * is confirmed absent from the (re-queried) window. There is no extra
 * grace period - see isPendingDisappeared.
 */
export const PENDING_DELETE_GRACE = null;

// ── Shared shapes ───────────────────────────────────────────────────────

/** Money-movement direction, normalized away from bank/local vocab. */
export type Direction = 'in' | 'out';

/** A bank credit (`CRDT`) is money in; a debit (`DBIT`) is money out. */
export function directionFromIndicator(cdi: 'CRDT' | 'DBIT'): Direction {
  return cdi === 'CRDT' ? 'in' : 'out';
}

/** A local row's type maps to the same two directions ('transfer' n/a here). */
export function directionFromType(type: string): Direction {
  return type === 'income' ? 'in' : 'out';
}

export interface FingerprintParts {
  accountId: string;
  direction: Direction;
  /** Positive decimal string in the entry's own currency. */
  amount: string;
  currency: string;
  merchantNormalized: string | null;
  /** Corrected (value/transaction) date, YYYY-MM-DD. */
  transactionDate: string;
}

export interface BookedEntry {
  direction: Direction;
  currency: string;
  /** Positive decimal string in the entry's own currency. */
  amount: string;
  /** Corrected (value/transaction) date, YYYY-MM-DD. */
  date: string;
}

export interface PendingCandidate {
  id: string;
  direction: Direction;
  currency: string;
  /** Positive decimal string in the row's own currency. */
  amount: string;
  /** Stored transaction date, YYYY-MM-DD. */
  date: string;
}

export interface MatchConstants {
  dateWindowDays?: number;
  amountTolerancePct?: number;
}

// ── Fingerprint ─────────────────────────────────────────────────────────

/**
 * 32-bit FNV-1a hash, returned as 8 lowercase hex chars. Pure and stable
 * across runs (no Date / random), which is exactly what we need to
 * re-identify the same pending entry on a later sync.
 */
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Deterministic fingerprint for a pending entry. Built from the fields
 * that stay stable between the pending sighting and (usually) the booked
 * entry, so the same charge re-matches across syncs even when the bank
 * omits / rotates `entry_reference` on pending rows.
 */
export function computePendingFingerprint(parts: FingerprintParts): string {
  const canonical = [
    parts.accountId,
    parts.direction,
    parts.amount.trim(),
    parts.currency.trim().toLowerCase(),
    (parts.merchantNormalized ?? '').trim().toLowerCase(),
    parts.transactionDate.trim(),
  ].join('|');
  return fnv1a(canonical);
}

// ── Booked -> pending fuzzy match ───────────────────────────────────────

function amountsWithinTolerance(a: string, b: string, tolerancePct: number): boolean {
  const ba = new Big(a);
  const bb = new Big(b);
  if (ba.eq(bb)) return true;
  if (tolerancePct <= 0) return false;
  const diff = ba.minus(bb).abs();
  const larger = ba.gt(bb) ? ba : bb;
  if (larger.eq(0)) return diff.eq(0);
  // diff / larger <= tolerancePct
  return diff.div(larger).lte(new Big(tolerancePct));
}

/**
 * Try to claim a booked entry onto one of the account's local pending
 * rows. Returns the best-matching candidate (so the caller flips it in
 * place) or null (so the caller inserts a fresh booked row).
 *
 * A candidate matches when, for the same account: same direction, same
 * currency, amount within tolerance (default exact), and dates within
 * PENDING_MATCH_DATE_WINDOW_DAYS. Among matches, the closest by amount
 * then by date wins.
 */
export function matchBookedToPending(
  booked: BookedEntry,
  candidates: readonly PendingCandidate[],
  consts: MatchConstants = {},
): PendingCandidate | null {
  const dateWindow = consts.dateWindowDays ?? PENDING_MATCH_DATE_WINDOW_DAYS;
  const tolerancePct = consts.amountTolerancePct ?? PENDING_MATCH_AMOUNT_TOLERANCE_PCT;
  const bookedDate = parseISO(booked.date);

  let best: PendingCandidate | null = null;
  let bestAmountDiff = new Big(0);
  let bestDateDiff = Infinity;

  for (const cand of candidates) {
    if (cand.direction !== booked.direction) continue;
    if (cand.currency.toLowerCase() !== booked.currency.toLowerCase()) continue;
    if (!amountsWithinTolerance(booked.amount, cand.amount, tolerancePct)) continue;
    const dateDiff = Math.abs(
      differenceInCalendarDays(bookedDate, parseISO(cand.date)),
    );
    if (dateDiff > dateWindow) continue;

    const amountDiff = new Big(booked.amount).minus(cand.amount).abs();
    if (
      best === null ||
      amountDiff.lt(bestAmountDiff) ||
      (amountDiff.eq(bestAmountDiff) && dateDiff < bestDateDiff)
    ) {
      best = cand;
      bestAmountDiff = amountDiff;
      bestDateDiff = dateDiff;
    }
  }

  return best;
}

// ── Flip date ───────────────────────────────────────────────────────────

/**
 * Pick the date to keep when a pending row flips to booked. We keep the
 * EARLIER of the two so the transaction stays filed under when the purchase
 * actually happened, not when the bank later posted (registered) it.
 *
 * Rationale: a pending entry usually carries the real purchase/value date,
 * while the settling booked entry's value_date can be the later settlement
 * date. Overwriting with the booked date would make the row jump forward in
 * the timeline. The bank's booking date is preserved separately in
 * `transactions.booking_date`.
 *
 * Lexical comparison is valid because both are zero-padded `YYYY-MM-DD`
 * (same assumption isPendingDisappeared relies on).
 */
export function pickFlipDate(
  pendingDate: string,
  bookedEffectiveDate: string,
): string {
  return pendingDate <= bookedEffectiveDate ? pendingDate : bookedEffectiveDate;
}

// ── Disappearance (auto-removal) ────────────────────────────────────────

export interface DisappearanceRow {
  status: string;
  /** Stored transaction date, YYYY-MM-DD. */
  date: string;
  /** ISO timestamp of the last sync this row was seen pending, or null. */
  pendingLastSeenAt: string | null;
}

export interface DisappearanceWindow {
  /** Inclusive lower bound of the queried pending window, YYYY-MM-DD. */
  windowFrom: string;
  /** Inclusive upper bound of the queried pending window, YYYY-MM-DD. */
  windowTo: string;
  /** ISO timestamp captured at the start of the current sync. */
  syncStartedAt: string;
}

/**
 * Whether a local pending row should be auto-removed: it is still
 * 'pending', its date falls inside the window we actually re-queried, and
 * it was NOT re-seen this sync (its last-seen stamp predates the sync
 * start). Rows outside the window - which we never re-queried - are never
 * deleted, guarding against bank flakiness.
 *
 * The service performs the real deletion in SQL; this mirrors that
 * predicate for unit testing. Both rely on `pendingLastSeenAt` and
 * `syncStartedAt` being ISO-8601 strings so lexical comparison matches
 * chronological order.
 */
export function isPendingDisappeared(
  row: DisappearanceRow,
  window: DisappearanceWindow,
): boolean {
  if (row.status !== 'pending') return false;
  if (row.date < window.windowFrom || row.date > window.windowTo) return false;
  if (row.pendingLastSeenAt === null) return true;
  return row.pendingLastSeenAt < window.syncStartedAt;
}
