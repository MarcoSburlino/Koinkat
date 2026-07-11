-- Migration v9 — bank-import provenance, manual-only events, auto-capture.
--
-- Bundles four loosely-related additions into a single migration so the
-- whole "Fix 1 / Fix 2 / Fix 3" set ships against one version bump.

-- ── budget_events.manual_only ─────────────────────────────────────────
-- When set, getMatchingEventsForDate skips this event regardless of
-- its date range. Lets a user keep an event's start/end dates for
-- display (e.g. a trip range) while opting out of the picker's
-- date-based pre-fill. Default 0 preserves legacy behaviour for
-- every existing row.
ALTER TABLE budget_events
  ADD COLUMN manual_only INTEGER NOT NULL DEFAULT 0;

-- ── budget_events.auto_capture (Fix 3) ────────────────────────────────
-- When set on a dated, non-expired event, applyAutoCaptureForEvent
-- sweeps expense transactions whose `date` falls in the event's range
-- and links them automatically. Off by default; per-row overrides via
-- transactions.event_link_pinned always win.
ALTER TABLE budget_events
  ADD COLUMN auto_capture INTEGER NOT NULL DEFAULT 0;

-- ── transactions.event_link_pinned (Fix 3) ────────────────────────────
-- Per-transaction pin. Set to 1 whenever the user manually picks or
-- clears budget_event_id via TransactionCreate / TransactionEdit /
-- Review. Auto-capture sweeps skip pinned rows in both directions
-- (won't link, won't unlink).
ALTER TABLE transactions
  ADD COLUMN event_link_pinned INTEGER NOT NULL DEFAULT 0;

-- ── transactions.source_description (Fix 1) ───────────────────────────
-- The raw joined remittance text exactly as received from the bank.
-- Stored so the cleaner (cleanImportDescription) can be re-run later
-- without losing the original text, and so Re-clean notes can use it
-- as the "do not clobber manual edits" sentinel (only rewrite `note`
-- where it still equals source_description).
ALTER TABLE transactions
  ADD COLUMN source_description TEXT;

-- ── transactions.booking_date (Fix 1) ─────────────────────────────────
-- The bank's booking date preserved verbatim, since transactions.date
-- now stores txn.transactionDate (value date) when present. NULL on
-- legacy rows imported before this migration and on every manually-
-- created row.
ALTER TABLE transactions
  ADD COLUMN booking_date TEXT;
