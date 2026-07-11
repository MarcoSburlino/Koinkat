-- Migration v10 — pending-transaction lifecycle.
--
-- Lets the bank importer ingest a charge the moment it shows up as
-- *pending*, flip the same row to *booked* in place when it settles
-- (preserving the user's category / notes / edits), and auto-remove a
-- pending row that never settles (auth hold released / declined /
-- reversed). All columns are additive with safe defaults so every
-- existing and manually-created row is unaffected.

-- ── transactions.status ───────────────────────────────────────────────
-- 'pending' | 'booked'. DEFAULT 'booked' so every existing row, every
-- manual row, and every settled bank row reads as booked. Pending rows
-- are balance-neutral and excluded from all aggregations until they book.
ALTER TABLE transactions
  ADD COLUMN status TEXT NOT NULL DEFAULT 'booked'
  CHECK (status IN ('pending', 'booked'));

-- ── transactions.bank_transaction_id ──────────────────────────────────
-- The bank's API transaction id for this entry. Stored to help re-match
-- a pending row to its later booked entry. Banks frequently change this
-- between pending and booked, so it is a hint, never a sole key.
ALTER TABLE transactions
  ADD COLUMN bank_transaction_id TEXT;

-- ── transactions.pending_last_seen_at ─────────────────────────────────
-- ISO timestamp bumped each sync the row is still present in the bank's
-- pending set. Drives disappearance detection: a pending row in the
-- queried window whose last-seen predates the current sync is removed.
ALTER TABLE transactions
  ADD COLUMN pending_last_seen_at TEXT;

-- ── transactions.pending_fingerprint ──────────────────────────────────
-- Deterministic hash used to re-match the *same* pending entry across
-- syncs when it lacks a stable bank id (pending entries often have no
-- entry_reference). Computed from
-- account_id | credit_debit_indicator | amount | currency |
-- merchant_normalized | transaction_date. Cleared when the row books.
ALTER TABLE transactions
  ADD COLUMN pending_fingerprint TEXT;

-- Speeds the per-account pending scans (claim candidates + disappearance
-- sweep) that run on every sync.
CREATE INDEX IF NOT EXISTS idx_transactions_pending
  ON transactions(koinkat_account_id, account_id, status);
