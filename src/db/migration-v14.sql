-- Migration v14 - stable bank-account identity across authorization sessions.
--
-- The problem. `linked_accounts.external_account_uid` is Enable Banking's
-- per-SESSION account uid. Re-authorizing the same bank (which every user
-- must do when a 90-day consent lapses) issues a NEW session with NEW uids,
-- so the re-link lookup in bank-sync-service found nothing and created a
-- second local account for the same IBAN. The user then saw the account
-- twice and their total balance counted it twice.
--
-- Enable Banking does return a stable identity - `identification_hash` /
-- `identification_hashes` on each session account - but both adapters were
-- dropping those fields before they reached the domain layer.
--
-- `identification_hash` stores the primary value. `identification_hashes`
-- stores the full set as a JSON array of strings, because the provider can
-- return several (an account reachable by more than one identifier), and a
-- later session may present any one of them.
--
-- Existing rows keep NULL: their identity was never observed, and inventing
-- one would be a guess. Those fall back to the conservative normalized
-- IBAN + bank + currency match in bank-sync-service, which refuses to act
-- when the match is ambiguous rather than merging accounts that might have
-- separately edited history.

ALTER TABLE linked_accounts ADD COLUMN identification_hash TEXT;
ALTER TABLE linked_accounts ADD COLUMN identification_hashes TEXT;

-- Re-link always narrows by workspace first; the hash discriminates inside it.
CREATE INDEX IF NOT EXISTS idx_linked_accounts_identification_hash
    ON linked_accounts(koinkat_account_id, identification_hash);
