-- Koinkat migration v4: replace tags with categories + rule engine
--
-- Replaces the flat `tags` table with a two-level `categories` table
-- (system macros + user subcategories) and introduces the supporting
-- tables for the rule-learning categorization engine:
--   - categorization_rules (user + learned + MCC-derived rules)
--   - mcc_mappings        (static MCC → macro category lookup)
--   - rule_applications   (audit log)
--
-- SQLite's ALTER TABLE RENAME COLUMN can't handle dropping `tags`
-- followed by renaming `transactions.tag_id` — the strict validation
-- re-parses the stored schema and fails on the dangling
-- `REFERENCES tags(id)`. Instead we follow the canonical "make other
-- kinds of schema changes" recipe from the SQLite docs:
--   1. Rename the old transactions table out of the way
--   2. CREATE the new transactions table with the target schema
--      (FK to `categories`, plus the new categorization columns)
--   3. Copy data (nulling out category_id — old tag ids point nowhere)
--   4. Drop the backup
--   5. Drop `tags` LAST — only safe once no table references it
--   6. Recreate indexes + categorization tables
--
-- `PRAGMA legacy_alter_table = ON` disables SQLite's strict validation
-- during the rename. `PRAGMA defer_foreign_keys = ON` defers FK checks
-- until transaction commit, so the self-reference INSERT loop doesn't
-- fail mid-way.
--
-- Existing tag assignments are LOST: `category_id` is nulled for every
-- row. The categorization engine re-populates values on the next bank
-- sync or manual categorization.

PRAGMA legacy_alter_table = ON;
PRAGMA defer_foreign_keys = ON;

-- ── Step 0: clean up any leftovers from a previous failed attempt ─────
-- If an earlier run crashed mid-migration, the backup table might
-- still be around. Drop it so we can retry cleanly.
DROP TABLE IF EXISTS _transactions_v3_backup;

-- ── Step 1: drop indexes on the old tables ────────────────────────────
-- Required so the rename doesn't collide with the new indexes we
-- recreate later, and so dropping `tags` doesn't trip on its index.
DROP INDEX IF EXISTS idx_tags_koinkat_account;
DROP INDEX IF EXISTS idx_tags_profile;
DROP INDEX IF EXISTS idx_transactions_koinkat_account;
DROP INDEX IF EXISTS idx_transactions_profile;
DROP INDEX IF EXISTS idx_transactions_account;
DROP INDEX IF EXISTS idx_transactions_dest_account;
DROP INDEX IF EXISTS idx_transactions_date;
DROP INDEX IF EXISTS idx_transactions_tag;
DROP INDEX IF EXISTS idx_transactions_related;
DROP INDEX IF EXISTS idx_transactions_type;
DROP INDEX IF EXISTS idx_transactions_external_ref;
DROP INDEX IF EXISTS idx_transactions_transfer_pair;

-- ── Step 2: create `categories` so the new transactions table can
--             FK to it ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
    id                  TEXT PRIMARY KEY,
    koinkat_account_id  TEXT NOT NULL,
    name                TEXT NOT NULL,
    type                TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    parent_id           TEXT REFERENCES categories(id) ON DELETE CASCADE,
    icon                TEXT,
    color               TEXT,
    is_system           INTEGER NOT NULL DEFAULT 0,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(koinkat_account_id, name, parent_id, type)
);

CREATE INDEX IF NOT EXISTS idx_categories_parent
  ON categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_categories_koinkat_account
  ON categories(koinkat_account_id);

-- ── Step 3: rename the old transactions table out of the way ──────────
-- legacy_alter_table prevents SQLite from following the stored
-- `REFERENCES transactions(id)` self-reference during the rename.
ALTER TABLE transactions RENAME TO _transactions_v3_backup;

-- ── Step 4: create the NEW transactions table with:
--             - category_id → categories(id)
--             - all categorization tracking columns
CREATE TABLE transactions (
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
    category_id             TEXT REFERENCES categories(id) ON DELETE SET NULL,
    note                    TEXT,
    date                    TEXT NOT NULL,
    is_budgeted             INTEGER NOT NULL DEFAULT 1,
    budget_event_id         TEXT REFERENCES budget_events(id) ON DELETE SET NULL,
    external_ref            TEXT,
    recorded_at             TEXT NOT NULL DEFAULT (datetime('now')),
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
    -- v3: transfer-pair detection
    transfer_pair_id        TEXT,
    transfer_reviewed_at    TEXT,
    -- v4: categorization engine
    categorization_source   TEXT,
    applied_rule_id         TEXT,
    needs_review            INTEGER NOT NULL DEFAULT 0,
    confirmed_at            TEXT,
    merchant_raw            TEXT,
    merchant_normalized     TEXT,
    merchant_category_code  TEXT,
    CHECK (amount > 0),
    CHECK (exchange_rate > 0),
    CHECK (
        (type = 'transfer' AND destination_account_id IS NOT NULL) OR
        (type != 'transfer' AND destination_account_id IS NULL)
    ),
    CHECK (account_id != destination_account_id)
);

-- ── Step 5: copy data from the backup. category_id is explicitly NULL
--             because the old tag_id values point to a table that will
--             be dropped below.
INSERT INTO transactions (
    id, koinkat_account_id, account_id, destination_account_id, related_transaction_id,
    type, amount, currency, exchange_rate, amount_in_account_ccy, amount_in_dest_ccy,
    category_id, note, date, is_budgeted, budget_event_id, external_ref,
    recorded_at, created_at, updated_at,
    transfer_pair_id, transfer_reviewed_at
)
SELECT
    id, koinkat_account_id, account_id, destination_account_id, related_transaction_id,
    type, amount, currency, exchange_rate, amount_in_account_ccy, amount_in_dest_ccy,
    NULL, note, date, is_budgeted, budget_event_id, external_ref,
    recorded_at, created_at, updated_at,
    transfer_pair_id, transfer_reviewed_at
FROM _transactions_v3_backup;

-- ── Step 6: drop the backup. Nothing references `_transactions_v3_backup`
--             so this is safe. Afterward the only thing still pointing
--             at `tags` is... nothing (the new transactions table uses
--             `categories`), which is why step 7 works.
DROP TABLE _transactions_v3_backup;

-- ── Step 7: drop `tags`. Safe now because no table references it. ─────
DROP TABLE IF EXISTS tags;

-- ── Step 8: recreate all transaction indexes on the NEW table ─────────
CREATE INDEX IF NOT EXISTS idx_transactions_koinkat_account ON transactions(koinkat_account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account         ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_dest_account    ON transactions(destination_account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date            ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_related         ON transactions(related_transaction_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type            ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_external_ref    ON transactions(external_ref);
CREATE INDEX IF NOT EXISTS idx_transactions_transfer_pair   ON transactions(transfer_pair_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category        ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_needs_review    ON transactions(needs_review);
CREATE INDEX IF NOT EXISTS idx_transactions_merchant_normalized ON transactions(merchant_normalized);

-- ── Step 9: categorization engine tables ──────────────────────────────
CREATE TABLE IF NOT EXISTS categorization_rules (
    id                 TEXT PRIMARY KEY,
    koinkat_account_id TEXT NOT NULL,
    name               TEXT,
    match_field        TEXT NOT NULL DEFAULT 'merchant_normalized',
    match_type         TEXT NOT NULL
                       CHECK (match_type IN ('exact', 'prefix', 'contains')),
    match_pattern      TEXT NOT NULL,
    category_id        TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    priority           INTEGER NOT NULL DEFAULT 100,
    is_active          INTEGER NOT NULL DEFAULT 1,
    source             TEXT NOT NULL
                       CHECK (source IN ('user', 'learned', 'mcc', 'system')),
    confidence         REAL NOT NULL DEFAULT 1.0,
    match_count        INTEGER NOT NULL DEFAULT 0,
    last_matched_at    TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rules_active_priority
  ON categorization_rules(is_active, priority);
CREATE INDEX IF NOT EXISTS idx_rules_pattern
  ON categorization_rules(match_pattern);
CREATE INDEX IF NOT EXISTS idx_rules_koinkat_account
  ON categorization_rules(koinkat_account_id);

CREATE TABLE IF NOT EXISTS mcc_mappings (
    koinkat_account_id TEXT NOT NULL,
    mcc_code           TEXT NOT NULL,
    category_id        TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    description        TEXT NOT NULL,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (koinkat_account_id, mcc_code)
);

CREATE INDEX IF NOT EXISTS idx_mcc_mappings_koinkat_account
  ON mcc_mappings(koinkat_account_id);

CREATE TABLE IF NOT EXISTS rule_applications (
    id             TEXT PRIMARY KEY,
    rule_id        TEXT NOT NULL REFERENCES categorization_rules(id) ON DELETE CASCADE,
    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    applied_at     TEXT NOT NULL DEFAULT (datetime('now')),
    was_correct    INTEGER,
    UNIQUE(rule_id, transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_rule_applications_txn
  ON rule_applications(transaction_id);

PRAGMA legacy_alter_table = OFF;
