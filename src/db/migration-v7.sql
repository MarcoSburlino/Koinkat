-- Migration v7 — Bank-link: user-chosen sync start date.
--
-- Adds a single purely additive column:
--
--   sync_start_date   TEXT NULL   — ISO date YYYY-MM-DD. The floor for
--                                   the initial transaction sync for
--                                   this linked account. NULL = legacy
--                                   row; use the 180-day default.
--
-- Records "how far back we agreed to import" per linked account. The
-- floor is used only on the first sync (when last_synced_at is NULL)
-- and by resyncFullHistory(). Subsequent delta syncs key off
-- last_synced_at with a 1-day overlap as before.

ALTER TABLE linked_accounts ADD COLUMN sync_start_date TEXT;
