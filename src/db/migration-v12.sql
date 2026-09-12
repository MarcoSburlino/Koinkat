-- Migration v12 - device-local app state (active user / active workspace).
--
-- Before v12 the "who is logged in" and "which workspace is open" pointers
-- lived ONLY in the WebView2 localStorage profile under AppData\Local. That
-- directory is disposable: Storage Sense, Disk Cleanup and a WebView2 reset
-- can all clear it, and it is origin-partitioned, so a dev build (served from
-- localhost:1420) never saw the pointers written by a production build
-- (served from tauri.localhost). Losing it made a fully-populated database
-- look like a brand-new install.
--
-- This table is deliberately NOT workspace-scoped. Every other table follows
-- the koinkat_account_id invariant, but this is the table that DETERMINES the
-- active workspace, so scoping it on the workspace would be circular. Do not
-- "fix" it by adding a koinkat_account_id column.
--
-- Keys currently used:
--   active_user_id            - id of the logged-in user
--   active_koinkat_account_id - id of the workspace that user is inside

CREATE TABLE IF NOT EXISTS app_state (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
