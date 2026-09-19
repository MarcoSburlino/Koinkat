-- Migration v13 - a durable identity for imported bank transactions.
--
-- The problem. Bank import deduplicated booked entries on `external_ref`
-- (Enable Banking's `entry_reference`) alone. That left two holes:
--
--   1. Entries the bank sends WITHOUT an entry_reference had no dedup at
--      all. Every repeated sync of the same window re-inserted them, so a
--      user's history accumulated duplicates of the same payment.
--   2. `pending_fingerprint` existed but was cleared the moment a pending
--      row was promoted to booked, so it could not identify the resulting
--      booked row on any later sync.
--
-- `import_fingerprint` is set once, when a row is first imported, and is
-- never cleared - including across the pending -> booked promotion. It is
-- derived from the fields that stay stable between the two sightings
-- (account, direction, amount, currency, normalized merchant, transaction
-- date) by computePendingFingerprint in src/domain/pending-reconcile.ts.
--
-- It is deliberately NOT unique. Two genuinely identical payments - same
-- shop, same amount, same day - produce the same fingerprint and are both
-- legitimate. Dedup is therefore occurrence-aware: the importer counts how
-- many rows carry a fingerprint locally versus how many the bank reported,
-- and inserts only the shortfall. A fingerprint is an identity hint, never
-- a uniqueness constraint.
--
-- Existing rows keep NULL. They were imported under the old rules, and
-- back-filling a fingerprint for them would invent an identity the import
-- never actually observed; the reference-based path still covers them.

ALTER TABLE transactions ADD COLUMN import_fingerprint TEXT;

-- Dedup always narrows by workspace + account first, so the fingerprint
-- only has to discriminate within that set.
CREATE INDEX IF NOT EXISTS idx_transactions_import_fingerprint
    ON transactions(koinkat_account_id, account_id, import_fingerprint);
