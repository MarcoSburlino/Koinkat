-- Migration v2 — drop v1 profile-aware tables before schema-v2 runs.
--
-- This is a destructive migration: any data that lived in the v1 schema
-- (profiles + per-profile domain tables) is lost. This is acceptable for
-- the current dev-stage of Koinkat; the v1 → v2 split of identity from
-- workspace is not data-preserving.
--
-- The schema-v2 CREATE statements are concatenated after this file at
-- compile time from Rust (see src-tauri/src/lib.rs).

DROP INDEX IF EXISTS idx_exchange_rates_date;
DROP INDEX IF EXISTS idx_linked_accounts_account;
DROP INDEX IF EXISTS idx_linked_accounts_connection;
DROP INDEX IF EXISTS idx_linked_accounts_profile;
DROP INDEX IF EXISTS idx_bank_connections_profile;
DROP INDEX IF EXISTS idx_budget_periods_profile;
DROP INDEX IF EXISTS idx_recurring_budgets_profile;
DROP INDEX IF EXISTS idx_transactions_external_ref;
DROP INDEX IF EXISTS idx_transactions_type;
DROP INDEX IF EXISTS idx_transactions_related;
DROP INDEX IF EXISTS idx_transactions_tag;
DROP INDEX IF EXISTS idx_transactions_date;
DROP INDEX IF EXISTS idx_transactions_dest_account;
DROP INDEX IF EXISTS idx_transactions_account;
DROP INDEX IF EXISTS idx_transactions_profile;
DROP INDEX IF EXISTS idx_budget_events_profile;
DROP INDEX IF EXISTS idx_tags_profile;
DROP INDEX IF EXISTS idx_accounts_profile;

DROP TABLE IF EXISTS api_configs;
DROP TABLE IF EXISTS linked_accounts;
DROP TABLE IF EXISTS bank_connections;
DROP TABLE IF EXISTS budget_periods;
DROP TABLE IF EXISTS recurring_budgets;
DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS budget_events;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS accounts;
DROP TABLE IF EXISTS profiles;
DROP TABLE IF EXISTS exchange_rates;
