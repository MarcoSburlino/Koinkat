-- Koinkat schema v2 — three-level hierarchy
--
--   User  ──▶ KoinkatAccount  ──▶ Account (bank account)  ──▶ Transaction
--
-- A user holds only identity (name + email). Each user owns one or more
-- koinkat accounts — workspaces that carry preferences (theme, currency,
-- decimal separator) and a connection type (manual, sandbox, linked).
--
-- Every domain table is scoped to a koinkat_account_id. Cascading deletes
-- for a koinkat account — and deeper, for a user — are performed at the
-- application layer (koinkat-account-service / user-service).

-- ── Users (identity) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Koinkat accounts (workspaces) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS koinkat_accounts (
    id                 TEXT PRIMARY KEY,
    user_id            TEXT NOT NULL,
    name               TEXT NOT NULL,
    connection_type    TEXT NOT NULL
                       CHECK (connection_type IN ('manual', 'sandbox', 'linked')),
    preferred_currency TEXT NOT NULL DEFAULT 'EUR',
    decimal_separator  TEXT NOT NULL DEFAULT ','
                       CHECK (decimal_separator IN ('.', ',')),
    theme              TEXT NOT NULL DEFAULT 'dark'
                       CHECK (theme IN ('light', 'dark', 'light-alt', 'dark-alt')),
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_koinkat_accounts_user ON koinkat_accounts(user_id);

-- ── Accounts (bank accounts — manual or linked) ──────────────────────
CREATE TABLE IF NOT EXISTS accounts (
    id                 TEXT PRIMARY KEY,
    koinkat_account_id TEXT NOT NULL,
    name               TEXT NOT NULL,
    currency           TEXT NOT NULL,
    color              TEXT NOT NULL DEFAULT '#2563eb',
    current_balance    TEXT NOT NULL DEFAULT '0',
    is_pinned          INTEGER NOT NULL DEFAULT 0,
    is_manual          INTEGER NOT NULL DEFAULT 1,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_accounts_koinkat_account ON accounts(koinkat_account_id);

-- ── Tags ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tags (
    id                 TEXT PRIMARY KEY,
    koinkat_account_id TEXT NOT NULL,
    name               TEXT NOT NULL,
    type               TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    is_system          INTEGER NOT NULL DEFAULT 0,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(koinkat_account_id, name, type)
);

CREATE INDEX IF NOT EXISTS idx_tags_koinkat_account ON tags(koinkat_account_id);

-- ── Budget events ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS budget_events (
    id                 TEXT PRIMARY KEY,
    koinkat_account_id TEXT NOT NULL,
    name               TEXT NOT NULL,
    description        TEXT,
    limit_amount       TEXT NOT NULL,
    currency           TEXT NOT NULL,
    is_expired         INTEGER NOT NULL DEFAULT 0,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_budget_events_koinkat_account ON budget_events(koinkat_account_id);

-- ── Transactions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
    id                      TEXT PRIMARY KEY,
    koinkat_account_id      TEXT NOT NULL,
    account_id              TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    destination_account_id  TEXT REFERENCES accounts(id) ON DELETE CASCADE,
    related_transaction_id  TEXT REFERENCES transactions(id) ON DELETE CASCADE,
    type                    TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
    amount                  TEXT NOT NULL,
    currency                TEXT NOT NULL,
    exchange_rate           TEXT NOT NULL,
    amount_in_account_ccy   TEXT NOT NULL,
    amount_in_dest_ccy      TEXT,
    tag_id                  TEXT REFERENCES tags(id) ON DELETE SET NULL,
    note                    TEXT,
    date                    TEXT NOT NULL,
    is_budgeted             INTEGER NOT NULL DEFAULT 1,
    budget_event_id         TEXT REFERENCES budget_events(id) ON DELETE SET NULL,
    external_ref            TEXT,
    recorded_at             TEXT NOT NULL DEFAULT (datetime('now')),
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (amount > 0),
    CHECK (exchange_rate > 0),
    CHECK (
        (type = 'transfer' AND destination_account_id IS NOT NULL) OR
        (type != 'transfer' AND destination_account_id IS NULL)
    ),
    CHECK (account_id != destination_account_id)
);

CREATE INDEX IF NOT EXISTS idx_transactions_koinkat_account ON transactions(koinkat_account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account         ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_dest_account    ON transactions(destination_account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date            ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_tag             ON transactions(tag_id);
CREATE INDEX IF NOT EXISTS idx_transactions_related         ON transactions(related_transaction_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type            ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_external_ref    ON transactions(external_ref);

-- ── Recurring budgets ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recurring_budgets (
    id                 TEXT PRIMARY KEY,
    koinkat_account_id TEXT NOT NULL,
    year               INTEGER NOT NULL CHECK (year >= 2000),
    start_month        INTEGER NOT NULL CHECK (start_month BETWEEN 1 AND 12),
    end_month          INTEGER NOT NULL CHECK (end_month BETWEEN 1 AND 12),
    rhythm             TEXT NOT NULL DEFAULT 'monthly' CHECK (rhythm IN ('weekly', 'monthly', 'yearly')),
    limit_amount       TEXT NOT NULL,
    currency           TEXT NOT NULL,
    is_active          INTEGER NOT NULL DEFAULT 1,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(koinkat_account_id, year)
);

CREATE INDEX IF NOT EXISTS idx_recurring_budgets_koinkat_account ON recurring_budgets(koinkat_account_id);

-- ── Budget periods ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS budget_periods (
    id                  TEXT PRIMARY KEY,
    koinkat_account_id  TEXT NOT NULL,
    recurring_budget_id TEXT NOT NULL REFERENCES recurring_budgets(id) ON DELETE CASCADE,
    period_start        TEXT NOT NULL,
    period_end          TEXT NOT NULL,
    limit_amount        TEXT NOT NULL,
    currency            TEXT NOT NULL,
    is_customized       INTEGER NOT NULL DEFAULT 0,
    notes               TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(recurring_budget_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_budget_periods_koinkat_account ON budget_periods(koinkat_account_id);

-- ── Bank connections (PSD2 / sandbox) ────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_connections (
    id                 TEXT PRIMARY KEY,
    koinkat_account_id TEXT NOT NULL,
    aspsp_name         TEXT NOT NULL,
    aspsp_country      TEXT NOT NULL,
    session_id         TEXT,
    authorization_id   TEXT,
    status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'active', 'expired', 'error')),
    valid_until        TEXT,
    last_synced_at     TEXT,
    error_message      TEXT,
    is_demo            INTEGER NOT NULL DEFAULT 0,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bank_connections_koinkat_account ON bank_connections(koinkat_account_id);

-- ── Linked bank accounts (bridge: bank_connection ↔ account) ─────────
CREATE TABLE IF NOT EXISTS linked_accounts (
    id                   TEXT PRIMARY KEY,
    koinkat_account_id   TEXT NOT NULL,
    bank_connection_id   TEXT NOT NULL REFERENCES bank_connections(id) ON DELETE CASCADE,
    account_id           TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    external_account_uid TEXT NOT NULL,
    iban                 TEXT,
    last_synced_at       TEXT,
    sync_cursor          TEXT,
    created_at           TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(koinkat_account_id, external_account_uid)
);

CREATE INDEX IF NOT EXISTS idx_linked_accounts_koinkat_account ON linked_accounts(koinkat_account_id);
CREATE INDEX IF NOT EXISTS idx_linked_accounts_connection      ON linked_accounts(bank_connection_id);
CREATE INDEX IF NOT EXISTS idx_linked_accounts_account         ON linked_accounts(account_id);

-- ── Per-koinkat-account Enable Banking credentials ───────────────────
CREATE TABLE IF NOT EXISTS api_configs (
    koinkat_account_id TEXT PRIMARY KEY,
    app_id             TEXT,
    private_key_pem    TEXT,
    environment        TEXT NOT NULL DEFAULT 'production'
                       CHECK (environment IN ('sandbox', 'production')),
    redirect_url       TEXT NOT NULL DEFAULT 'https://marcosburlino.github.io/koinkat-callback/',
    is_configured      INTEGER NOT NULL DEFAULT 0,
    is_demo_mode       INTEGER NOT NULL DEFAULT 0,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Exchange rates (shared infrastructure) ───────────────────────────
CREATE TABLE IF NOT EXISTS exchange_rates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    rate_date  TEXT NOT NULL UNIQUE,
    rates_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_date ON exchange_rates(rate_date);
