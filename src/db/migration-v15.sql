-- Migration v15 - transfer detection between the user's own accounts.
--
-- `transactions.counterparty_iban` is the IBAN of the OTHER side of a bank
-- entry: the creditor's account for money going out, the debtor's account
-- for money coming in. Enable Banking sends it as `creditor_account.iban` /
-- `debtor_account.iban`, but the import used to drop it. When it equals the
-- IBAN of another linked account in the same workspace, the entry is a
-- transfer between the user's own accounts, and the transfer detector can
-- say so with certainty instead of guessing from amount and date alone.
-- Stored normalized (no spaces, upper case). Existing rows keep NULL until a
-- later sync sees the same entry again and fills it in.
--
-- `transfer_pair_dismissals` remembers "these two rows are NOT a transfer"
-- per PAIR. Dismissing a suggestion used to stamp `transfer_reviewed_at` on
-- both rows, which removed each of them from detection for good - so a
-- wrong suggestion also hid the row's real partner forever. A dismissal now
-- rules out only that one pairing.

ALTER TABLE transactions ADD COLUMN counterparty_iban TEXT;

CREATE TABLE IF NOT EXISTS transfer_pair_dismissals (
    koinkat_account_id TEXT NOT NULL,
    outflow_id         TEXT NOT NULL,
    inflow_id          TEXT NOT NULL,
    dismissed_at       TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (outflow_id, inflow_id)
);

CREATE INDEX IF NOT EXISTS idx_transfer_pair_dismissals_workspace
    ON transfer_pair_dismissals(koinkat_account_id);
