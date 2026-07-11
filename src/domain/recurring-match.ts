// Pure matcher + scorer for recurring expense series.
//
// This module is intentionally DB-free and side-effect-free so it can be
// unit-tested without mocks. It decides, for a single incoming expense and
// the workspace's active series for that merchant, whether the charge is a
// confident silent match, a doubtful one that must go to Review, or no
// match at all. The service layer (recurring-service.ts) owns the DB reads
// (locked rows, dismissed merchants, "already a charge this period") and
// applies the verdict.
//
// Decision rule (Balanced defaults, all tunable below):
//   - timing inside the cadence window  AND
//   - amount within the drift/abs band  AND
//   - exactly one active series for the merchant  AND
//   - same currency as the series
//     → 'silent' (attach + self-correct + categorize).
//   - amount jumped past the band, or timing outside the window, or >1
//     active series, or currency mismatch → 'review' (surface a pre-filled
//     suggestion; for an amount jump this doubles as the price-change alert).
//   - merchant has no active series → 'none'.
//
// Amount is NEVER a hard match gate: a small drift attaches silently, a big
// jump attaches but asks. That is the whole point - a price change must
// still resolve to the same series.

import Big from 'big.js';
import { dec } from './money';
import type { RecurrenceCadence } from '../types/enums';

// ── Tunable constants ───────────────────────────────────────────────────
// future: recurrence discovery may re-tune these per-cadence.

/** Timing tolerance (± days) by cadence for a silent attach. */
export const WINDOW_DAYS: Record<RecurrenceCadence, number> = {
  weekly: 3,
  monthly: 7,
  yearly: 14,
};

/** Silent-attach if |Δamount| / expected ≤ this fraction … */
export const AMOUNT_DRIFT = 0.15;

/** … or if the absolute difference ≤ this (covers tiny expected amounts). */
export const AMOUNT_ABS_BAND = '1.00';

/** A missed-charge notice fires this many days past next_expected_date. */
export const MISSED_GRACE_DAYS = 5;

/** Default expected gap per cadence; self-corrects after the 2nd charge. */
export const DEFAULT_INTERVAL_DAYS: Record<RecurrenceCadence, number> = {
  weekly: 7,
  monthly: 30,
  yearly: 365,
};

/** Default cadence for a freshly-flagged series. */
export const DEFAULT_CADENCE: RecurrenceCadence = 'monthly';

// ── Date helpers (UTC, deterministic) ───────────────────────────────────

/** Whole-day index of an ISO `YYYY-MM-DD` date in UTC. */
function toUtcDayIndex(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** Signed day count `a − b` for two ISO dates (positive when a is later). */
export function daysBetween(aIso: string, bIso: string): number {
  return toUtcDayIndex(aIso) - toUtcDayIndex(bIso);
}

/** Add `n` days to an ISO `YYYY-MM-DD` date, returning ISO `YYYY-MM-DD`. */
export function addDays(iso: string, n: number): string {
  const ms = (toUtcDayIndex(iso) + n) * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The next expected charge date after `chargeDate`, given an interval.
 * Used to seed/refresh `next_expected_date`.
 */
export function nextExpectedAfter(chargeDate: string, intervalDays: number): string {
  return addDays(chargeDate, Math.max(1, Math.round(intervalDays)));
}

// ── Types ───────────────────────────────────────────────────────────────

/** The subset of a series the pure matcher needs (no DB row coupling). */
export interface SeriesMatchInput {
  cadence: RecurrenceCadence;
  intervalDays: number;
  expectedAmount: string | null;
  currency: string | null;
  lastChargeDate: string | null;
  nextExpectedDate: string | null;
}

/** The subset of a transaction the pure matcher needs. */
export interface TxnMatchInput {
  /** ISO `YYYY-MM-DD`. */
  date: string;
  /** Money string (gross, in the transaction's own currency). */
  amount: string;
  currency: string;
}

export type MatchDecision = 'silent' | 'review' | 'none';

export type MatchReason =
  | 'match'
  | 'amount-jump'
  | 'timing-out-of-window'
  | 'currency-mismatch'
  | 'ambiguous-multiple-series'
  | 'no-series';

export interface MatchVerdict {
  decision: MatchDecision;
  reason: MatchReason;
  /** True when the amount is outside the drift band (price changed). */
  amountJumped: boolean;
  /** Timing offset in days from the expected reference, or null. */
  offsetDays: number | null;
}

// ── Amount assessment ───────────────────────────────────────────────────

interface AmountAssessment {
  within: boolean;
  jumped: boolean;
}

function assessAmount(txnAmount: string, expectedAmount: string | null): AmountAssessment {
  if (expectedAmount === null) {
    // No baseline yet - amount can't disqualify a match.
    return { within: true, jumped: false };
  }
  const txn = dec(txnAmount).abs();
  const expected = dec(expectedAmount).abs();
  const absDiff = txn.minus(expected).abs();

  if (absDiff.lte(dec(AMOUNT_ABS_BAND))) return { within: true, jumped: false };
  if (expected.lte(new Big('0'))) return { within: false, jumped: true };

  const driftOk = absDiff.div(expected).lte(new Big(String(AMOUNT_DRIFT)));
  return { within: driftOk, jumped: !driftOk };
}

// ── Timing assessment ───────────────────────────────────────────────────

/**
 * Distance in days between the charge date and the series' expected
 * timing. Prefers `next_expected_date`; falls back to
 * `|gap since last_charge_date − interval_days|`. Returns null when the
 * series has no temporal anchor yet.
 */
export function timingOffsetDays(txnDate: string, series: SeriesMatchInput): number | null {
  if (series.nextExpectedDate) {
    return Math.abs(daysBetween(txnDate, series.nextExpectedDate));
  }
  if (series.lastChargeDate) {
    const gap = daysBetween(txnDate, series.lastChargeDate);
    return Math.abs(gap - series.intervalDays);
  }
  return null;
}

// ── Single-candidate scoring ────────────────────────────────────────────

/**
 * Score one incoming charge against one candidate series. Pure. The caller
 * is responsible for only passing an *active*, non-dismissed series and an
 * *unlocked* transaction; this function judges timing/amount/currency.
 */
export function scoreMatch(txn: TxnMatchInput, series: SeriesMatchInput): MatchVerdict {
  if (
    series.currency &&
    txn.currency.toUpperCase() !== series.currency.toUpperCase()
  ) {
    return {
      decision: 'review',
      reason: 'currency-mismatch',
      amountJumped: false,
      offsetDays: null,
    };
  }

  const offsetDays = timingOffsetDays(txn.date, series);
  const amount = assessAmount(txn.amount, series.expectedAmount);
  const timingOk = offsetDays === null ? true : offsetDays <= WINDOW_DAYS[series.cadence];

  if (!timingOk) {
    return {
      decision: 'review',
      reason: 'timing-out-of-window',
      amountJumped: amount.jumped,
      offsetDays,
    };
  }

  if (amount.jumped) {
    // Timing matches but the price moved - attach, but ask the user.
    return {
      decision: 'review',
      reason: 'amount-jump',
      amountJumped: true,
      offsetDays,
    };
  }

  return { decision: 'silent', reason: 'match', amountJumped: false, offsetDays };
}

// ── Multi-candidate resolution ──────────────────────────────────────────

export interface PickResult<S extends SeriesMatchInput> {
  verdict: MatchVerdict;
  /** The series the charge resolves to, or null for 'none'/'ambiguous'. */
  series: S | null;
}

/**
 * Resolve an incoming charge against the active series for its merchant.
 *   - 0 active series → 'none'.
 *   - >1 active series → 'review' (ambiguous; the user picks which / none).
 *   - exactly 1 → delegate to scoreMatch.
 */
export function pickMatch<S extends SeriesMatchInput>(
  txn: TxnMatchInput,
  activeSeries: S[],
): PickResult<S> {
  if (activeSeries.length === 0) {
    return {
      verdict: { decision: 'none', reason: 'no-series', amountJumped: false, offsetDays: null },
      series: null,
    };
  }
  if (activeSeries.length > 1) {
    return {
      verdict: {
        decision: 'review',
        reason: 'ambiguous-multiple-series',
        amountJumped: false,
        offsetDays: null,
      },
      series: null,
    };
  }
  return { verdict: scoreMatch(txn, activeSeries[0]), series: activeSeries[0] };
}

// ── Self-correction ─────────────────────────────────────────────────────

/**
 * Blend the observed gap into the series' interval once a second charge
 * confirms the real cadence. Guards against outliers: a gap that is wildly
 * off (less than half or more than double the nominal cadence) is ignored
 * so a stray early/late charge can't poison the interval. Returns the new
 * interval in whole days.
 */
export function correctInterval(
  lastChargeDate: string,
  newChargeDate: string,
  currentInterval: number,
  cadence: RecurrenceCadence,
): number {
  const realGap = daysBetween(newChargeDate, lastChargeDate);
  const nominal = DEFAULT_INTERVAL_DAYS[cadence];
  if (realGap < nominal / 2 || realGap > nominal * 2) {
    return currentInterval;
  }
  return Math.max(1, Math.round((currentInterval + realGap) / 2));
}

// ── Missed-charge detection (pure predicate) ────────────────────────────

/**
 * Whether a series is overdue: its next expected date plus the grace
 * window has passed as of `today`. The service additionally confirms no
 * charge actually arrived before surfacing the quiet notice.
 */
export function isOverdue(
  series: Pick<SeriesMatchInput, 'nextExpectedDate'>,
  today: string,
  graceDays: number = MISSED_GRACE_DAYS,
): boolean {
  if (!series.nextExpectedDate) return false;
  return daysBetween(today, series.nextExpectedDate) > graceDays;
}
