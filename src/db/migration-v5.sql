-- Migration v5 — Dated budget events + sum-to-budget linkage.
--
-- Adds four purely additive columns to budget_events:
--
--   start_date     TEXT NULL  — ISO date YYYY-MM-DD. NULL together with
--                               end_date means the event is "undated"
--                               and never auto-suggests on a transaction.
--   end_date       TEXT NULL  — ISO date YYYY-MM-DD. Must be set iff
--                               start_date is set; end_date >= start_date.
--   sum_to_budget  INTEGER    — 1 = this event's limit_amount is added to
--                               a chosen month of the recurring budget,
--                               AND the event's expense transactions count
--                               toward that month's spending. Default 0.
--   sum_to_month   TEXT NULL  — ISO date YYYY-MM-01 of the target month.
--                               Required when sum_to_budget = 1, NULL
--                               otherwise.
--
-- Existing rows receive NULL / 0 defaults, representing
-- "undated, not summed" — the correct legacy behavior.
--
-- NOTE: SQLite ALTER TABLE cannot add CHECK constraints. The two
-- invariants documented above ("both-or-neither dates" and
-- "sum_to_budget iff sum_to_month") are enforced in TypeScript at the
-- service layer (src/services/budget-service.ts).

ALTER TABLE budget_events ADD COLUMN start_date TEXT;
ALTER TABLE budget_events ADD COLUMN end_date TEXT;
ALTER TABLE budget_events ADD COLUMN sum_to_budget INTEGER NOT NULL DEFAULT 0;
ALTER TABLE budget_events ADD COLUMN sum_to_month TEXT;

-- Index supporting getMatchingEventsForDate() range lookups.
CREATE INDEX IF NOT EXISTS idx_budget_events_dates
  ON budget_events(start_date, end_date);

-- Index supporting calculatePeriodSpending() per-month lookups of
-- events whose limits/transactions fold into a recurring budget period.
CREATE INDEX IF NOT EXISTS idx_budget_events_sum_month
  ON budget_events(sum_to_month);
