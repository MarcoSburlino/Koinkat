-- Migration v6 — Split expense reconciliation.
--
-- Adds three purely additive columns to transactions:
--
--   split_status              TEXT NULL   — 'open' | 'settled' | NULL.
--                                           Non-null only on parent split
--                                           expense rows (type='expense',
--                                           related_transaction_id IS NULL).
--   relation_kind             TEXT NULL   — 'fee' | 'repayment' | NULL.
--                                           Discriminator on the
--                                           related_transaction_id link,
--                                           so fees and repayments can
--                                           coexist without polluting
--                                           each other's lifecycles.
--   net_spent_in_account_ccy  TEXT NULL   — Derived: parent's
--                                           amount_in_account_ccy minus
--                                           sum(repayments converted to
--                                           parent account currency).
--                                           Maintained by the service
--                                           layer (recomputeSplitNet) on
--                                           every repayment mutation.
--                                           Non-null iff split_status is
--                                           non-null. Aggregation queries
--                                           COALESCE it against
--                                           amount_in_account_ccy, so
--                                           legacy rows (all NULL) behave
--                                           identically to today.
--
-- NOTE: SQLite ALTER TABLE cannot add CHECK constraints. The invariants
-- described above are enforced in TypeScript at the service layer
-- (src/services/transaction-service.ts).

ALTER TABLE transactions ADD COLUMN split_status TEXT;
ALTER TABLE transactions ADD COLUMN relation_kind TEXT;
ALTER TABLE transactions ADD COLUMN net_spent_in_account_ccy TEXT;

-- Index supporting "open splits" lookups (Phase 2 Dashboard callout).
CREATE INDEX IF NOT EXISTS idx_transactions_split_status
  ON transactions(split_status);

-- Index supporting repayment-row exclusion in aggregation queries and
-- quickly fetching a parent's repayment children on the split detail page.
CREATE INDEX IF NOT EXISTS idx_transactions_relation_kind
  ON transactions(relation_kind);
