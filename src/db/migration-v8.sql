-- Migration v8 — External (untracked) repayments for split expenses.
--
-- Some repayments arrive via rails the user doesn't track as Koinkat
-- accounts (PayPal, MobilePay, cash-in-hand). They still reduce the
-- user's net share for budget/category purposes but have no balance
-- effect anywhere. Storing them in the main `transactions` table would
-- require account_id to be nullable, which is a bigger refactor than
-- justified — so we use a dedicated side-table instead.
--
-- The table mirrors the important denormalized pieces of a transaction
-- repayment (amount, currency, date, exchange_rate, amount_in_parent_ccy)
-- so `recomputeSplitNet` can sum them into the parent's net without
-- having to re-convert at query time.

CREATE TABLE IF NOT EXISTS split_external_reimbursements (
    id                      TEXT PRIMARY KEY,
    koinkat_account_id      TEXT NOT NULL,
    parent_transaction_id   TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    amount                  TEXT NOT NULL,
    currency                TEXT NOT NULL,
    amount_in_parent_ccy    TEXT NOT NULL,
    exchange_rate           TEXT NOT NULL,
    date                    TEXT NOT NULL,
    source                  TEXT,
    note                    TEXT,
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (amount > 0),
    CHECK (exchange_rate > 0)
);

CREATE INDEX IF NOT EXISTS idx_split_ext_parent
  ON split_external_reimbursements(parent_transaction_id);

CREATE INDEX IF NOT EXISTS idx_split_ext_koinkat_account
  ON split_external_reimbursements(koinkat_account_id);
