-- Migration v11 — recurring expense series (manual flag + auto-recognition).
--
-- Lets the user flag certain expenses as *recurring* (rent, transit pass,
-- streaming, subscriptions) as an attribute that sits on top of the
-- category, group those expenses on the Analysis and Budgets pages, and
-- have the importer recognize the same charge in future months without
-- re-asking. A recurring expense is modeled as a *series* (identity =
-- normalized merchant + cadence); the amount is a tracked attribute that
-- can change, never part of identity. All columns/tables are additive with
-- safe defaults so every existing and manually-created row is unaffected.

-- ── recurring_series ──────────────────────────────────────────────────
-- One row per recurring commitment, workspace-scoped. expected_amount is
-- the latest expected charge (money as TEXT, per the money rules);
-- interval_days is the learned/expected gap used by the timing window and
-- self-corrects once a second charge confirms the real cadence.
CREATE TABLE IF NOT EXISTS recurring_series (
    id                  TEXT PRIMARY KEY,
    koinkat_account_id  TEXT NOT NULL,
    merchant_normalized TEXT NOT NULL,
    display_name        TEXT NOT NULL,
    cadence             TEXT NOT NULL DEFAULT 'monthly'
                          CHECK (cadence IN ('weekly', 'monthly', 'yearly')),
    interval_days       INTEGER NOT NULL DEFAULT 30,
    category_id         TEXT REFERENCES categories(id) ON DELETE SET NULL,
    expected_amount     TEXT,
    currency            TEXT,
    status              TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'paused', 'ended')),
    last_charge_date    TEXT,
    next_expected_date  TEXT,
    match_count         INTEGER NOT NULL DEFAULT 0,
    last_matched_at     TEXT,
    source              TEXT NOT NULL DEFAULT 'user'
                          CHECK (source IN ('user', 'auto_suggested')),
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recurring_series_koinkat
  ON recurring_series(koinkat_account_id);
CREATE INDEX IF NOT EXISTS idx_recurring_series_merchant
  ON recurring_series(koinkat_account_id, merchant_normalized, status);

-- ── recurring_dismissals ──────────────────────────────────────────────
-- Remembers "this merchant is NOT a recurring series" so auto-recognition
-- (and any future discovery pass) stops nudging. Workspace-scoped, one row
-- per dismissed merchant.
CREATE TABLE IF NOT EXISTS recurring_dismissals (
    id                  TEXT PRIMARY KEY,
    koinkat_account_id  TEXT NOT NULL,
    merchant_normalized TEXT NOT NULL,
    dismissed_at        TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(koinkat_account_id, merchant_normalized)
);

-- ── transactions.recurring_series_id ──────────────────────────────────
-- Orthogonal to category_id: a row keeps its normal category AND links to
-- a series. ON DELETE SET NULL so deleting a series detaches its rows
-- without deleting the transactions.
ALTER TABLE transactions
  ADD COLUMN recurring_series_id TEXT
  REFERENCES recurring_series(id) ON DELETE SET NULL;

-- ── transactions.recurring_locked ─────────────────────────────────────
-- Set to 1 when the user manually sets or clears the series link, so
-- auto-matching never overrides their choice (mirrors event_link_pinned).
-- Clearing the link + locking is how "this specific charge is NOT part of
-- the series" is expressed (e.g. a one-off Amazon order vs monthly Prime).
ALTER TABLE transactions
  ADD COLUMN recurring_locked INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_transactions_recurring_series
  ON transactions(recurring_series_id);
