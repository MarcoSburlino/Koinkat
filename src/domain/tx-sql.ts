/**
 * Shared SQL fragments for transaction-aggregation queries.
 *
 * CLAUDE.md hard invariants #3/#6 require that EVERY query summing
 * income/expense across categories or periods:
 *   - exclude repayment rows,
 *   - exclude bank-pending rows (only count `status = 'booked'`), and
 *   - use the split-net effective amount (parents contribute their net
 *     share, plain rows their gross).
 *
 * Inlining these as raw strings in every query is how one of them
 * silently diverges - e.g. `netProfitSinceYear` once selected the gross
 * `amount_in_account_ccy` while every sibling used the COALESCE net,
 * corrupting the Summary starting balance whenever a split existed.
 * Centralizing the fragments here makes that class of bug a single point
 * of truth.
 *
 * All fragments assume the `transactions` table is aliased `t`. They are
 * constant literals - never interpolate user input through this module.
 */

/** Exclude repayment rows from an aggregation. */
export const TX_EXCLUDE_REPAYMENT =
  "(t.relation_kind IS NULL OR t.relation_kind != 'repayment')";

/** Count only settled (booked) rows; bank-pending rows are excluded. */
export const TX_BOOKED_ONLY = "t.status = 'booked'";

/**
 * Effective signed amount in the account's currency: split parents
 * contribute their net share (gross − repayments), all other rows their
 * gross. Aliased back to `amount_in_account_ccy` so callers read a
 * single column name.
 */
export const TX_NET_AMOUNT_AS =
  'COALESCE(t.net_spent_in_account_ccy, t.amount_in_account_ccy) AS amount_in_account_ccy';
