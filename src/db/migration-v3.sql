-- Migration v3 — transfer-pair detection columns.
--
-- Adds two nullable columns to the transactions table so we can detect
-- bank-imported transactions that are actually transfers between two of
-- the user's own accounts (an outflow on account A matched with an
-- inflow on account B), and let the user confirm or dismiss them.
--
--   transfer_pair_id     TEXT NULL  — UUID linking the two rows of a
--                                    confirmed transfer pair. Two rows
--                                    sharing the same value are one
--                                    transfer. Rows with this column set
--                                    are EXCLUDED from income/expense
--                                    aggregations everywhere.
--   transfer_reviewed_at TEXT NULL  — Timestamp the user took action on
--                                    a transfer-detection suggestion
--                                    (confirm OR dismiss). Detection
--                                    only suggests pairs where both
--                                    rows are still NULL here, so a
--                                    dismissed pair never re-appears.
--
-- This migration is purely additive — existing rows get NULL for both
-- columns, which means "not paired, never reviewed" — the correct
-- default for legacy transactions.

ALTER TABLE transactions ADD COLUMN transfer_pair_id TEXT;
ALTER TABLE transactions ADD COLUMN transfer_reviewed_at TEXT;

-- Helps the aggregation queries that filter out paired rows; small
-- table cardinality so it's not strictly required, but cheap and keeps
-- the EXPLAIN plan honest.
CREATE INDEX IF NOT EXISTS idx_transactions_transfer_pair
  ON transactions(transfer_pair_id);
