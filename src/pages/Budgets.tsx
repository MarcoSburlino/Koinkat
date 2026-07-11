import { formatDayLabel, formatMonthLabel } from '../lib/date-format';
import { monthFilterOptions } from '../lib/date-constants';
import { UPPERCASE_LABEL,UPPERCASE_LABEL_SM } from '../lib/label-styles';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { chartTooltipStyle, chartAxisStyle, chartGridStyle } from '../lib/chart-style';
import {
  parseISO,
  format as formatDate,
  startOfMonth,
  addMonths,
  eachMonthOfInterval,
} from 'date-fns';
import { Pencil, Trash2, Archive, ArchiveRestore, Plus, AlertCircle, Repeat2, Clock } from 'lucide-react';

import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { InfoBanner } from '../components/ui/InfoBanner';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { CurrencyPicker } from '../components/ui/CurrencyPicker';
import { CategoryPicker } from '../components/ui/CategoryPicker';
import { PageHeader } from '../components/layout/PageHeader';

import { useAppStore } from '../stores/app-store';
import { formatAmount, formatMoney } from '../lib/format';
import { MONTH_NAMES_SHORT } from '../lib/date-constants';
import { dec, qCent } from '../domain/money';
import * as budgetService from '../services/budget-service';
import * as recurringService from '../services/recurring-service';
import {
  sumNonBudgetedExpenses,
  categoryBreakdown,
  type CategoryBreakdownRow,
} from '../services/reporting-service';
import type {
  PeriodWithSpending,
  YearlyBudgetData,
} from '../services/budget-service';
import type {
  RecurringForMonthResult,
  MissedCharge,
} from '../services/recurring-service';
import type { BudgetEvent, RecurringSeries } from '../types/models';
import type { BudgetRhythm, RecurrenceCadence } from '../types/enums';
import { getPercentageColor } from '../lib/budget-colors';
import { monthPace } from '../lib/budget-pace';

// ── Constants ───────────────────────────────────────────────────────────

const MONTH_LABELS = MONTH_NAMES_SHORT;

const MONTH_OPTIONS = monthFilterOptions(null, { short: true });

const RHYTHM_OPTIONS: { value: string; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'yearly', label: 'Yearly' },
];

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Decimal-precise positive-amount validation. Replaces the old
 * `Number(x) > 0` checks which silently truncated `"1,234"` to 1
 * and accepted scientific notation like `"1e-10"`.
 */
function isPositiveAmountString(value: string): boolean {
  if (!value || !value.trim()) return false;
  try {
    return dec(value.trim()).gt(0);
  } catch {
    return false;
  }
}


function buildEventMonthOptions(
  startDate: string,
  endDate: string,
): { value: string; label: string }[] {
  let range: Date[];
  if (startDate && endDate) {
    try {
      const start = startOfMonth(parseISO(startDate));
      const end = startOfMonth(parseISO(endDate));
      if (end < start) return [];
      range = eachMonthOfInterval({ start, end });
    } catch {
      return [];
    }
  } else {
    const now = startOfMonth(new Date());
    range = Array.from({ length: 12 }, (_, i) => addMonths(now, i));
  }
  return range.map((d) => ({
    value: formatDate(d, 'yyyy-MM-01'),
    label: formatDate(d, 'MMMM yyyy'),
  }));
}

function getMonthIndex(periodStart: string): number {
  return new Date(periodStart).getMonth();
}

interface EventSpending {
  total: string;
  perCurrency: Record<string, string>;
}

type SpendingMap = Record<string, EventSpending>;

// ── Main component ──────────────────────────────────────────────────────

export function Budgets() {
  const settings = useAppStore((s) => s.settings);

  // Year + focused month navigation
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [yearlyData, setYearlyData] = useState<YearlyBudgetData | null>(null);
  const [focusedPeriodId, setFocusedPeriodId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Events + spending
  const [events, setEvents] = useState<BudgetEvent[]>([]);
  const [eventSpending, setEventSpending] = useState<SpendingMap>({});

  // Backfill state
  const [unbudgetedCount, setUnbudgetedCount] = useState(0);

  // Round 2: surface load failures inline. Round 1's silent
  // console.error meant a thrown ensurePeriodsForYear (or any other
  // service throw) just looked like "no budget for {year}" to the user.
  const [loadError, setLoadError] = useState<string | null>(null);
  // Errors from page-level actions (backfill, archive/reactivate) - these
  // have no modal to live in, so they render under the page header.
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteEventError, setDeleteEventError] = useState<string | null>(null);

  // Collapsible sections
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  // Modals
  const [createBudgetOpen, setCreateBudgetOpen] = useState(false);
  const [editPeriod, setEditPeriod] = useState<PeriodWithSpending | null>(null);
  const [editBudgetOpen, setEditBudgetOpen] = useState(false);
  const [createEventOpen, setCreateEventOpen] = useState(false);
  const [editEvent, setEditEvent] = useState<BudgetEvent | null>(null);
  const [deleteEvent, setDeleteEvent] = useState<BudgetEvent | null>(null);
  const [deleteBudgetOpen, setDeleteBudgetOpen] = useState(false);

  // Ref for scrolling to the focused-month card when a "folds in" badge
  // is clicked on an envelope.
  const focusedCardRef = useRef<HTMLDivElement | null>(null);

  const scrollToFocusedMonth = useCallback(() => {
    if (focusedCardRef.current) {
      focusedCardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  // ── Load data ─────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // Run the three independent top-level fetches in parallel.
      const [years, data, list] = await Promise.all([
        budgetService.getAvailableBudgetYears(),
        budgetService.getYearlyBudgetData(selectedYear),
        budgetService.listBudgetEvents(),
      ]);

      setAvailableYears(years);
      setYearlyData(data);
      setEvents(list);

      // Decide focused period.
      if (data) {
        const now = new Date();
        const isCurrentYear = now.getFullYear() === selectedYear;
        if (isCurrentYear) {
          const currentMonthStart = formatDate(startOfMonth(now), 'yyyy-MM-dd');
          const match = data.periods.find(
            (p) => p.periodStart === currentMonthStart,
          );
          setFocusedPeriodId(
            match
              ? match.id
              : data.periods[data.periods.length - 1]?.id ?? null,
          );
        } else {
          // Decision Q8: fall back to LAST month of the budget on expired years.
          setFocusedPeriodId(
            data.periods[data.periods.length - 1]?.id ?? null,
          );
        }
      } else {
        setFocusedPeriodId(null);
      }

      // Per-event spending (one grouped query for every event, instead of
      // two queries per event) + unbudgeted count run in parallel.
      const [spendingByEvent, unbudgetedRows] = await Promise.all([
        budgetService
          .calculateEventSpendingBatch(list.map((ev) => ev.id))
          .catch(() => ({}) as Record<string, EventSpending>),
        data
          ? budgetService.countUnbudgetedExpenses({
              year: data.budget.year,
              startMonth: data.budget.startMonth,
              endMonth: data.budget.endMonth,
            })
          : Promise.resolve(null),
      ]);

      const map: SpendingMap = {};
      for (const ev of list) {
        map[ev.id] = spendingByEvent[ev.id] ?? { total: '0.00', perCurrency: {} };
      }
      setEventSpending(map);

      setUnbudgetedCount(unbudgetedRows ?? 0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Budgets.load] failed:', err);
      setLoadError(msg || 'Failed to load budget data.');
    } finally {
      setLoading(false);
    }
  }, [selectedYear]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Derived data ──────────────────────────────────────────────────────

  const focusedPeriod = useMemo(() => {
    if (!yearlyData || !focusedPeriodId) return null;
    return (
      yearlyData.periods.find((p) => p.id === focusedPeriodId) ?? null
    );
  }, [yearlyData, focusedPeriodId]);

  const focusedMonthKey = useMemo(() => {
    if (!focusedPeriod) return null;
    return focusedPeriod.periodStart.slice(0, 7) + '-01';
  }, [focusedPeriod]);

  // Off-budget spend (is_budgeted = 0) for the focused month, converted to
  // the budget currency, shown as a small line under the month's summary
  // triad. Independent of the whole-period "unbudgeted" backfill banner.
  const [nonBudgetedFocused, setNonBudgetedFocused] = useState<string>('0.00');
  const focusedBudgetCcy = yearlyData?.budget.currency;
  useEffect(() => {
    if (!focusedMonthKey || !focusedBudgetCcy) {
      setNonBudgetedFocused('0.00');
      return;
    }
    let cancelled = false;
    sumNonBudgetedExpenses({
      year: parseInt(focusedMonthKey.slice(0, 4), 10),
      month: parseInt(focusedMonthKey.slice(5, 7), 10),
      preferredCurrency: focusedBudgetCcy,
    })
      .then((res) => {
        if (!cancelled) setNonBudgetedFocused(res.total);
      })
      .catch(() => {
        if (!cancelled) setNonBudgetedFocused('0.00');
      });
    return () => {
      cancelled = true;
    };
  }, [focusedMonthKey, focusedBudgetCcy]);

  const activeEvents = useMemo(
    () => events.filter((e) => !e.isExpired),
    [events],
  );
  const expiredEvents = useMemo(
    () => events.filter((e) => e.isExpired),
    [events],
  );

  // Events rolling up into the focused month.
  const foldingEvents = useMemo(() => {
    if (!focusedMonthKey) return [];
    return activeEvents.filter(
      (e) => e.sumToBudget && e.sumToMonth === focusedMonthKey,
    );
  }, [activeEvents, focusedMonthKey]);

  const yearOptions = availableYears.map((y) => ({
    value: String(y),
    label: String(y),
  }));

  const monthOptions = useMemo(() => {
    if (!yearlyData) return [];
    return yearlyData.periods.map((p) => ({
      value: p.id,
      label: MONTH_LABELS[getMonthIndex(p.periodStart)],
    }));
  }, [yearlyData]);

  // ── Handlers ──────────────────────────────────────────────────────────

  async function handleBackfill() {
    if (!yearlyData) return;
    setActionError(null);
    try {
      await budgetService.backfillBudgetedExpenses({
        year: yearlyData.budget.year,
        startMonth: yearlyData.budget.startMonth,
        endMonth: yearlyData.budget.endMonth,
      });
      await load();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to include transactions in the budget',
      );
    }
  }

  async function handleExpire(id: string) {
    setActionError(null);
    try {
      await budgetService.markEventExpired(id);
      await load();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to archive budget event',
      );
    }
  }

  async function handleReactivate(id: string) {
    setActionError(null);
    try {
      await budgetService.reactivateBudgetEvent(id);
      await load();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to reactivate budget event',
      );
    }
  }

  async function handleDeleteEvent() {
    if (!deleteEvent) return;
    setDeleteEventError(null);
    try {
      await budgetService.deleteBudgetEvent(deleteEvent.id);
      setDeleteEvent(null);
      await load();
    } catch (err) {
      // Keep the modal open so the user can read why deletion failed.
      setDeleteEventError(
        err instanceof Error ? err.message : 'Failed to delete budget event',
      );
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div>
      <PageHeader
        serif
        label="Overview"
        title="Budgets"
        subtitle="Track monthly spending against your limits and events."
        right={
          <div className="flex items-center gap-3">
            <div className="w-28">
              <Select
                value={String(selectedYear)}
                onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
                options={yearOptions.length ? yearOptions : [{ value: String(selectedYear), label: String(selectedYear) }]}
              />
            </div>
            {yearlyData && monthOptions.length > 0 && (
              <div className="w-28">
                <Select
                  value={focusedPeriodId ?? ''}
                  onChange={(e) => setFocusedPeriodId(e.target.value)}
                  options={monthOptions}
                />
              </div>
            )}
            {!yearlyData && !loading && (
              <Button variant="primary" onClick={() => setCreateBudgetOpen(true)}>
                <Plus size={14} /> New budget
              </Button>
            )}
            {/* "New event" intentionally lives ONLY on the events card -
                two identical buttons on one screen read as two features. */}
          </div>
        }
      />

      {/* One-time orientation tip: "budget vs events" is the page's core
          mental model and nothing else on screen explains it. */}
      <InfoBanner storageKey="koinkat.tip.budgetsEvents" className="mb-6">
        Your budget is one monthly spending limit. <strong>Events</strong>{' '}
        give one-off plans - a trip, a purchase - their own limit, and can
        fold that limit into a specific month's budget.
      </InfoBanner>

      {loadError && (
        <Card className="mb-4">
          <div
            className="flex items-start gap-2 py-2"
            style={{ color: 'var(--danger)' }}
          >
            <AlertCircle size={16} className="mt-[2px]" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Couldn't load budget data</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {loadError}
              </p>
            </div>
          </div>
        </Card>
      )}

      {actionError && (
        <Card className="mb-4">
          <div
            className="flex items-start gap-2 py-2"
            style={{ color: 'var(--danger)' }}
          >
            <AlertCircle size={16} className="mt-[2px]" />
            <p className="text-sm">{actionError}</p>
          </div>
        </Card>
      )}

      {loading && (
        <Card>
          <p
            className="text-center py-12"
            style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}
          >
            Loading...
          </p>
        </Card>
      )}

      {!loading && (
        <div className="grid grid-cols-1 lg:grid-cols-[7fr_3fr] gap-4 items-start">
          {/* ── LEFT (70%): budget content ─────────────────────────── */}
          <div className="min-w-0">
            {/* Backfill banner */}
            {yearlyData && unbudgetedCount > 0 && (
              <Card className="mb-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm" style={{ color: 'var(--text)' }}>
                      <strong>{unbudgetedCount}</strong> expense
                      {unbudgetedCount !== 1 ? 's' : ''} in this period{' '}
                      {unbudgetedCount !== 1 ? 'are' : 'is'} excluded from the
                      budget.
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      "Include" counts them toward the monthly totals - including
                      any you excluded on purpose (e.g. one-off annual costs).
                    </p>
                  </div>
                  <Button variant="secondary" onClick={handleBackfill}>
                    Include
                  </Button>
                </div>
              </Card>
            )}

            {/* No budget CTA */}
            {!yearlyData && (
              <Card className="mb-4">
                <div className="py-10 text-center">
                  <p
                    className="mb-4"
                    style={{
                      color: 'var(--text)',
                      fontFamily: 'var(--font-head)',
                      fontSize: 'var(--fs-h2)',
                      fontWeight: 'var(--fw-semibold)',
                    }}
                  >
                    No budget for {selectedYear}
                  </p>
                  <p className="mb-6 text-sm" style={{ color: 'var(--text-muted)' }}>
                    Create a budget to start tracking monthly spending against a limit.
                    Events will still work on their own without a recurring budget.
                  </p>
                  <Button variant="primary" onClick={() => setCreateBudgetOpen(true)}>
                    <Plus size={14} /> Create budget for {selectedYear}
                  </Button>
                </div>
              </Card>
            )}

            {/* Focused-month hero card */}
            {focusedPeriod && yearlyData && (
              <div ref={focusedCardRef}>
                <FocusedMonthCard
                  period={focusedPeriod}
                  budgetCurrency={yearlyData.budget.currency}
                  decimalSeparator={settings.decimalSeparator}
                  foldingEvents={foldingEvents}
                  foldingEventSpending={eventSpending}
                  nonBudgetedAmount={nonBudgetedFocused}
                  onEditLimit={() => setEditPeriod(focusedPeriod)}
                  onEditBudgetLimit={() => setEditBudgetOpen(true)}
                  onDeleteBudget={() => setDeleteBudgetOpen(true)}
                />
              </div>
            )}

            {/* Annual breakdown - chart always visible, table behind a dropdown. */}
            {yearlyData && (
              <>
                <Card className="mb-4">
                  <p
                    className="uppercase mb-3"
                    style={UPPERCASE_LABEL}
                  >
                    Annual breakdown
                  </p>
                  {/* Most finance charts draw bars as SPENDING - here the
                      bars are the allowance, so say so or users invert it. */}
                  <p
                    className="mb-3"
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: 'var(--fs-body-sm)',
                    }}
                  >
                    Bars show your budget for each month (usual limit + extra
                    from events); the line is what you actually spent.
                  </p>
                  <AnnualBreakdownChart
                    yearlyData={yearlyData}
                    decimalSeparator={settings.decimalSeparator}
                  />
                </Card>

                <Collapsible
                  open={breakdownOpen}
                  onToggle={() => setBreakdownOpen(!breakdownOpen)}
                  label="Per-period table"
                >
                  <AnnualBreakdownTable
                    yearlyData={yearlyData}
                    decimalSeparator={settings.decimalSeparator}
                    onEditPeriod={setEditPeriod}
                  />
                </Collapsible>
              </>
            )}
          </div>

          {/* ── RIGHT (30%): budget events ─────────────────────────── */}
          <div className="min-w-0">
            <EventsSection
              events={activeEvents}
              spending={eventSpending}
              focusedMonthKey={focusedMonthKey}
              decimalSeparator={settings.decimalSeparator}
              onEdit={setEditEvent}
              onExpire={handleExpire}
              onDelete={setDeleteEvent}
              onCreate={() => setCreateEventOpen(true)}
              onFoldBadgeClick={scrollToFocusedMonth}
            />

            {/* Archive (collapsible, expired events) */}
            {expiredEvents.length > 0 && (
              <Collapsible
                open={archiveOpen}
                onToggle={() => setArchiveOpen(!archiveOpen)}
                label={`Archive · ${expiredEvents.length} expired event${expiredEvents.length !== 1 ? 's' : ''}`}
              >
                <div className="grid grid-cols-1 gap-3">
                  {expiredEvents.map((ev) => (
                    <EventCard
                      key={ev.id}
                      event={ev}
                      spending={eventSpending[ev.id] ?? { total: '0.00', perCurrency: {} }}
                      foldsIntoFocusedMonth={false}
                      decimalSeparator={settings.decimalSeparator}
                      onEdit={() => setEditEvent(ev)}
                      onExpire={null}
                      onReactivate={() => handleReactivate(ev.id)}
                      onDelete={() => setDeleteEvent(ev)}
                    />
                  ))}
                </div>
              </Collapsible>
            )}

            <RecurringCostsSection
              focusedMonthKey={focusedMonthKey}
              targetCurrency={focusedBudgetCcy ?? settings.preferredCurrency}
              decimalSeparator={settings.decimalSeparator}
            />
          </div>
        </div>
      )}

      {/* Modals */}
      <CreateBudgetModal
        open={createBudgetOpen}
        onClose={() => setCreateBudgetOpen(false)}
        year={selectedYear}
        preferredCurrency={settings.preferredCurrency}
        onCreated={async () => {
          setCreateBudgetOpen(false);
          await load();
        }}
      />

      <EditPeriodModal
        period={editPeriod}
        onClose={() => setEditPeriod(null)}
        onSaved={async () => {
          setEditPeriod(null);
          await load();
        }}
      />

      <EditBudgetLimitModal
        open={editBudgetOpen}
        onClose={() => setEditBudgetOpen(false)}
        budget={yearlyData?.budget ?? null}
        onSaved={async () => {
          setEditBudgetOpen(false);
          await load();
        }}
      />

      <CreateEventModal
        open={createEventOpen}
        onClose={() => setCreateEventOpen(false)}
        preferredCurrency={settings.preferredCurrency}
        focusedMonthKey={focusedMonthKey}
        onCreated={async () => {
          setCreateEventOpen(false);
          await load();
        }}
      />

      <EditEventModal
        event={editEvent}
        onClose={() => setEditEvent(null)}
        onSaved={async () => {
          setEditEvent(null);
          await load();
        }}
      />

      <DeleteEventModal
        event={deleteEvent}
        error={deleteEventError}
        onCancel={() => { setDeleteEvent(null); setDeleteEventError(null); }}
        onConfirm={handleDeleteEvent}
      />

      <DeleteBudgetModal
        open={deleteBudgetOpen}
        onCancel={() => setDeleteBudgetOpen(false)}
        budget={yearlyData?.budget ?? null}
        onConfirm={async () => {
          if (!yearlyData) return;
          await budgetService.deleteRecurringBudget(yearlyData.budget.id);
          setDeleteBudgetOpen(false);
          await load();
        }}
      />
    </div>
  );
}

// ── Collapsible section ─────────────────────────────────────────────────

function Collapsible({
  open,
  onToggle,
  label,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="mb-4">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between cursor-pointer"
        style={{ color: 'var(--text)' }}
      >
        <span
          className="uppercase"
          style={UPPERCASE_LABEL}
        >
          {label}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          {open ? '▼' : '▶'}
        </span>
      </button>
      {open && <div className="mt-4">{children}</div>}
    </Card>
  );
}

// ── Focused month hero card ─────────────────────────────────────────────

function FocusedMonthCard({
  period,
  budgetCurrency,
  decimalSeparator,
  foldingEvents,
  foldingEventSpending,
  nonBudgetedAmount,
  onEditLimit,
  onEditBudgetLimit,
  onDeleteBudget,
}: {
  period: PeriodWithSpending;
  budgetCurrency: string;
  decimalSeparator: string;
  foldingEvents: BudgetEvent[];
  foldingEventSpending: SpendingMap;
  /** Off-budget spend for this month (is_budgeted = 0), in budgetCurrency. */
  nonBudgetedAmount?: string;
  onEditLimit: () => void;
  onEditBudgetLimit: () => void;
  onDeleteBudget?: () => void;
}) {
  const monthIdx = getMonthIndex(period.periodStart);
  const year = period.periodStart.slice(0, 4);
  const pctColor = getPercentageColor(period.percentage);
  const clampedPct = Math.min(period.percentage, 100);
  // Money math in Big (invariant: no float arithmetic on amounts);
  // toNumber() only at the final CSS-width boundary.
  const baseLimitD = dec(period.baseLimit);
  const effLimitD = dec(period.effectiveLimit);
  const eventShare = effLimitD.gt(0)
    ? effLimitD.minus(baseLimitD).div(effLimitD).times(100).toNumber()
    : 0;
  const baseShare = 100 - eventShare;
  const perCurrencyKeys = Object.keys(period.spentPerCurrency);
  const multiCurrency = perCurrencyKeys.length > 1;

  // Pace context - 60% spent is fine on the 25th and alarming on the 5th,
  // but the percentage alone can't say which. Only meaningful when the
  // focused month IS the current calendar month. The math lives in the
  // shared monthPace helper so this card and the Dashboard month card
  // can never drift.
  const now = new Date();
  const isCurrentMonth =
    period.periodStart.slice(0, 7) ===
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const pace = monthPace(period.remaining, now);
  const monthElapsedPct = pace.monthElapsedPct;
  const safePerDay = isCurrentMonth ? pace.safePerDay : null;

  return (
    <Card className="mb-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p
            className="uppercase"
            style={UPPERCASE_LABEL}
          >
            {MONTH_LABELS[monthIdx]} {year} · monthly limit
            {period.isCustomized && (
              <span
                style={{
                  marginLeft: 8,
                  color: 'var(--primary)',
                  fontSize: 'var(--fs-rate)',
                }}
                title="Custom limit for this month only"
              >
                ★ custom limit
              </span>
            )}
          </p>
          <div className="flex items-baseline gap-2 mt-1">
            <span
              className="amount"
              data-privacy-field
              style={{
                color: 'var(--text)',
                fontFamily: 'var(--font-head)',
                fontSize: 'var(--fs-h1)',
                fontWeight: 'var(--fw-semibold)',
              }}
            >
              {formatAmount(period.effectiveLimit, decimalSeparator)}
            </span>
            <span className="currency-code">{budgetCurrency}</span>
          </div>
          <p
            className="mt-0.5"
            data-privacy-field
            style={{
              color: 'var(--text-muted)',
              fontSize: 'var(--fs-rate)',
            }}
          >
            {formatAmount(period.baseLimit, decimalSeparator)} usual limit
            {dec(period.eventContribution).gt(0) && (
              <> + {formatAmount(period.eventContribution, decimalSeparator)} extra from events</>
            )}
          </p>
        </div>
        <div
          style={{
            color: pctColor,
            fontFamily: 'var(--font-head)',
            fontSize: 'var(--fs-h2)',
            fontWeight: 'var(--fw-semibold)',
          }}
        >
          {period.percentage.toFixed(1)}%
        </div>
      </div>

      {/* Progress bar (two-tone) */}
      <div
        className="h-2 rounded-full overflow-hidden mb-3 relative"
        style={{ backgroundColor: 'var(--surface-alt)' }}
      >
        <div
          className="h-full"
          style={{
            width: `${clampedPct}%`,
            backgroundColor: pctColor,
            transition: 'width var(--dur-std) var(--ease-standard)',
          }}
        />
        {/* Base/event split indicator */}
        {eventShare > 0 && (
          <div
            className="absolute top-0 bottom-0"
            style={{
              left: `${baseShare}%`,
              width: 1,
              backgroundColor: 'var(--border)',
              opacity: 0.6,
            }}
          />
        )}
        {/* "Today" pace tick - lets the user compare spent-% against
            elapsed-% of the month in one glance. Current month only. */}
        {isCurrentMonth && (
          <div
            className="absolute top-0 bottom-0"
            title={`Today - ${monthElapsedPct.toFixed(0)}% of the month gone`}
            style={{
              left: `${monthElapsedPct}%`,
              width: 2,
              backgroundColor: 'var(--text)',
              opacity: 0.5,
            }}
          />
        )}
      </div>

      {/* Summary triad. For the current month the third slot is "Safe per
          day" (remaining ÷ days left incl. today) - the number a budgeter
          actually acts on; the monthly limit is already the hero figure
          above. Past/future months keep the limit. */}
      <div className="grid grid-cols-3 gap-3 text-center mb-3">
        <KPI label="Spent" value={period.spent} currency={budgetCurrency} decimalSeparator={decimalSeparator} color="var(--expense)" />
        <KPI label="Remaining" value={period.remaining} currency={budgetCurrency} decimalSeparator={decimalSeparator} color={dec(period.remaining).gte(0) ? 'var(--text)' : 'var(--danger)'} />
        {isCurrentMonth ? (
          <KPI
            label="Safe per day"
            value={safePerDay ?? '0.00'}
            currency={budgetCurrency}
            decimalSeparator={decimalSeparator}
            color={safePerDay ? 'var(--text)' : 'var(--danger)'}
          />
        ) : (
          <KPI label="Monthly limit" value={period.effectiveLimit} currency={budgetCurrency} decimalSeparator={decimalSeparator} color="var(--text)" />
        )}
      </div>

      {/* Off-budget spend for this month (excluded from the limit above) */}
      {nonBudgetedAmount && nonBudgetedAmount !== '0.00' && (
        <p
          className="mb-3"
          style={{
            color: 'var(--text-muted)',
            fontSize: 'var(--fs-body-sm)',
          }}
        >
          Excluded from budget this month:{' '}
          <span data-privacy-field>
            {formatAmount(nonBudgetedAmount, decimalSeparator)} {budgetCurrency}
          </span>{' '}
          <span style={{ fontSize: 'var(--fs-rate)' }}>
            (one-offs you unchecked "Budgeted" on)
          </span>
        </p>
      )}

      {multiCurrency && (
        <p
          className="mb-3 italic"
          style={{
            color: 'var(--text-muted)',
            fontSize: 'var(--fs-rate)',
          }}
        >
          Spending sourced from{' '}
          {perCurrencyKeys.map((c) => c.toUpperCase()).join(', ')},
          converted to {budgetCurrency}.
        </p>
      )}

      {/* Rolling-up events */}
      {foldingEvents.length > 0 && (
        <div
          className="mb-3 pt-3"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          <p
            className="uppercase mb-2"
            style={UPPERCASE_LABEL_SM}
          >
            Rolling up this month
          </p>
          <div className="flex flex-col gap-2">
            {foldingEvents.map((ev) => {
              const sp = foldingEventSpending[ev.id] ?? { total: '0.00', perCurrency: {} };
              // Big for the amount division; toNumber() only at the final
              // CSS-width boundary.
              const limD = dec(ev.limitAmount);
              const pct = limD.gt(0)
                ? dec(sp.total).div(limD).times(100).toNumber()
                : 0;
              const clamped = Math.min(pct, 100);
              return (
                <div key={ev.id} className="flex items-center gap-3">
                  <span
                    style={{ color: 'var(--text)', fontSize: 'var(--fs-body-sm)' }}
                  >
                    • {ev.name}
                  </span>
                  <span
                    className="flex-1 amount"
                    data-privacy-field
                    style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-rate)' }}
                  >
                    {formatAmount(sp.total, decimalSeparator)} /{' '}
                    {formatAmount(ev.limitAmount, decimalSeparator)}{' '}
                    <span className="currency-code">{ev.currency}</span>
                  </span>
                  <div
                    className="w-24 h-1 rounded-full overflow-hidden"
                    style={{ backgroundColor: 'var(--surface-alt)' }}
                  >
                    <div
                      className="h-full"
                      style={{
                        width: `${clamped}%`,
                        backgroundColor: getPercentageColor(pct),
                      }}
                    />
                  </div>
                  <span
                    style={{
                      color: getPercentageColor(pct),
                      fontSize: 'var(--fs-rate)',
                      minWidth: 42,
                      textAlign: 'right',
                    }}
                  >
                    {pct.toFixed(0)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <Button variant="secondary" onClick={onEditLimit}>
          Edit {MONTH_LABELS[monthIdx]}'s limit
        </Button>
        <Button variant="ghost" onClick={onEditBudgetLimit}>
          Edit budget baseline
        </Button>
        {onDeleteBudget && (
          <Button variant="ghost" onClick={onDeleteBudget}>
            <Trash2 size={14} /> Delete budget
          </Button>
        )}
      </div>
    </Card>
  );
}

function KPI({
  label,
  value,
  currency,
  decimalSeparator,
  color,
}: {
  label: string;
  value: string;
  currency: string;
  decimalSeparator: string;
  color: string;
}) {
  return (
    <div>
      <p
        className="mb-0.5 uppercase"
        style={UPPERCASE_LABEL_SM}
      >
        {label}
      </p>
      <div className="flex items-baseline justify-center" data-privacy-field>
        <span
          className="amount amount-sm"
          style={{ color }}
        >
          {formatAmount(value, decimalSeparator)}
        </span>
        <span className="currency-code">{currency}</span>
      </div>
    </div>
  );
}

// ── Events section ──────────────────────────────────────────────────────

function EventsSection({
  events,
  spending,
  focusedMonthKey,
  decimalSeparator,
  onEdit,
  onExpire,
  onDelete,
  onCreate,
  onFoldBadgeClick,
}: {
  events: BudgetEvent[];
  spending: SpendingMap;
  focusedMonthKey: string | null;
  decimalSeparator: string;
  onEdit: (e: BudgetEvent) => void;
  onExpire: (id: string) => Promise<void>;
  onDelete: (e: BudgetEvent) => void;
  onCreate: () => void;
  onFoldBadgeClick: () => void;
}) {
  // Phase 2 decision Q12: events folded into the focused month float to
  // the top of the grid, then other active events below. Within each
  // group, preserve the existing sort (list-budget-events default).
  const sorted = useMemo(() => {
    if (!focusedMonthKey) return events;
    const folded: BudgetEvent[] = [];
    const others: BudgetEvent[] = [];
    for (const ev of events) {
      if (ev.sumToBudget && ev.sumToMonth === focusedMonthKey) {
        folded.push(ev);
      } else {
        others.push(ev);
      }
    }
    return [...folded, ...others];
  }, [events, focusedMonthKey]);

  return (
    <Card className="mb-4">
      <div className="flex items-center justify-between mb-3">
        <p
          className="uppercase"
          style={UPPERCASE_LABEL}
        >
          Events · Active
        </p>
        <Button variant="ghost" onClick={onCreate}>
          <Plus size={14} /> New event
        </Button>
      </div>

      {events.length === 0 ? (
        <p
          className="py-8 text-center"
          style={{
            color: 'var(--text-muted)',
            fontSize: 'var(--fs-body-sm)',
          }}
        >
          No events yet. Events track one-off spending like a trip or a
          purchase, optionally folding into a specific month's budget.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {sorted.map((ev) => (
            <EventCard
              key={ev.id}
              event={ev}
              spending={spending[ev.id] ?? { total: '0.00', perCurrency: {} }}
              foldsIntoFocusedMonth={
                ev.sumToBudget &&
                !!focusedMonthKey &&
                ev.sumToMonth === focusedMonthKey
              }
              decimalSeparator={decimalSeparator}
              onEdit={() => onEdit(ev)}
              onExpire={() => onExpire(ev.id)}
              onReactivate={null}
              onDelete={() => onDelete(ev)}
              onFoldBadgeClick={onFoldBadgeClick}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function EventCard({
  event,
  spending,
  foldsIntoFocusedMonth,
  decimalSeparator,
  onEdit,
  onExpire,
  onReactivate,
  onDelete,
  onFoldBadgeClick,
}: {
  event: BudgetEvent;
  spending: EventSpending;
  foldsIntoFocusedMonth: boolean;
  decimalSeparator: string;
  onEdit: (() => void) | null;
  onExpire: (() => void | Promise<void>) | null;
  onReactivate: (() => void | Promise<void>) | null;
  onDelete: () => void;
  onFoldBadgeClick?: () => void;
}) {
  const spent = spending.total;
  // `remaining` is a DISPLAYED money value → compute it with big.js, floored
  // at zero. `limitNum`/`spentNum` stay float ONLY because they feed the
  // percentage / progress-bar width below, which is display geometry.
  const remDec = dec(event.limitAmount).minus(dec(spent));
  const remaining = remDec.gt(0) ? qCent(remDec) : dec('0');
  // Big for the amount division; toNumber() only at the final CSS-width
  // boundary (display geometry).
  const limitD = dec(event.limitAmount);
  const pct = limitD.gt(0)
    ? dec(spent).div(limitD).times(100).toNumber()
    : 0;
  const clampedPct = Math.min(pct, 100);
  const perCurrencyKeys = Object.keys(spending.perCurrency);
  const multiCurrency = perCurrencyKeys.length > 1;
  const mutedStyle: React.CSSProperties = event.isExpired ? { opacity: 0.55 } : {};
  const hasDates = event.startDate && event.endDate;

  // Per-event category breakdown (lazy-loaded on expand). Amounts are
  // converted to the event's own currency so the list lines up with "spent".
  const [bdOpen, setBdOpen] = useState(false);
  const [bdRows, setBdRows] = useState<CategoryBreakdownRow[] | null>(null);
  const [bdLoading, setBdLoading] = useState(false);
  useEffect(() => {
    if (!bdOpen) return;
    let cancelled = false;
    setBdLoading(true);
    categoryBreakdown({
      budgetEventId: event.id,
      type: 'expense',
      preferredCurrency: event.currency,
    })
      .then((res) => {
        if (!cancelled) setBdRows(res.rows);
      })
      .catch(() => {
        if (!cancelled) setBdRows([]);
      })
      .finally(() => {
        if (!cancelled) setBdLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bdOpen, event.id, event.currency]);

  return (
    <div
      className="rounded-lg p-4"
      style={{
        backgroundColor: 'var(--card-bg, var(--surface))',
        border: '1px solid var(--border)',
        ...mutedStyle,
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3
              className="truncate"
              style={{
                color: 'var(--text)',
                fontSize: 'var(--fs-body)',
                fontWeight: 'var(--fw-semibold)',
              }}
            >
              {event.name}
            </h3>
            {foldsIntoFocusedMonth && (
              <button
                onClick={onFoldBadgeClick}
                className="px-1.5 py-0.5 rounded cursor-pointer hover:opacity-80 transition-opacity"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--primary) 18%, transparent)',
                  color: 'var(--primary)',
                  fontSize: 'var(--fs-rate)',
                  fontWeight: 'var(--fw-medium)',
                }}
                title="Jump to focused month"
              >
                ● folds in
              </button>
            )}
          </div>
          {event.description && (
            <p
              className="mt-0.5 truncate"
              style={{
                color: 'var(--text-muted)',
                fontSize: 'var(--fs-body-sm)',
              }}
            >
              {event.description}
            </p>
          )}
          <p
            className="mt-0.5"
            style={{
              color: 'var(--text-muted)',
              fontSize: 'var(--fs-rate)',
            }}
          >
            {hasDates
              ? `${formatDayLabel(event.startDate!)} – ${formatDayLabel(event.endDate!)}`
              : 'Undated'}
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {onEdit && (
            <button
              onClick={onEdit}
              className="p-1.5 rounded transition-opacity hover:opacity-80 cursor-pointer"
              style={{ color: 'var(--text-muted)' }}
              title="Edit"
            >
              <Pencil size={14} />
            </button>
          )}
          {onExpire && (
            <button
              onClick={() => void onExpire()}
              className="p-1.5 rounded transition-opacity hover:opacity-80 cursor-pointer"
              style={{ color: 'var(--text-muted)' }}
              title="Archive"
            >
              <Archive size={14} />
            </button>
          )}
          {onReactivate && (
            <button
              onClick={() => void onReactivate()}
              className="p-1.5 rounded transition-opacity hover:opacity-80 cursor-pointer"
              style={{ color: 'var(--text-muted)' }}
              title="Reactivate"
            >
              <ArchiveRestore size={14} />
            </button>
          )}
          <button
            onClick={onDelete}
            className="p-1.5 rounded transition-opacity hover:opacity-80 cursor-pointer"
            style={{ color: 'var(--danger)' }}
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {event.sumToBudget && event.sumToMonth && (
        <p
          className="mb-2"
          style={{
            color: 'var(--text-muted)',
            fontSize: 'var(--fs-rate)',
          }}
        >
          Summed into {formatMonthLabel(event.sumToMonth)} budget
        </p>
      )}

      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span
            className="amount"
            data-privacy-field
            style={{
              color: 'var(--text)',
              fontSize: 'var(--fs-body-sm)',
            }}
          >
            {formatAmount(spent, decimalSeparator)} /{' '}
            {formatAmount(event.limitAmount, decimalSeparator)}{' '}
            <span className="currency-code">{event.currency}</span>
          </span>
          <span
            style={{
              color: getPercentageColor(pct),
              fontSize: 'var(--fs-rate)',
              fontWeight: 'var(--fw-medium)',
            }}
          >
            {pct.toFixed(1)}%
          </span>
        </div>
        <div
          className="h-1.5 rounded-full overflow-hidden"
          style={{ backgroundColor: 'var(--surface-alt)' }}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${clampedPct}%`,
              backgroundColor: getPercentageColor(pct),
              transition: 'width var(--dur-std) var(--ease-standard)',
            }}
          />
        </div>
      </div>

      <p
        className="text-center"
        style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-rate)' }}
      >
        Remaining:{' '}
        <span
          className="amount amount-sm"
          data-privacy-field
          style={{
            color: remDec.gt(0) ? 'var(--income)' : 'var(--danger)',
          }}
        >
          {formatAmount(remaining.toFixed(2), decimalSeparator)}
        </span>{' '}
        <span className="currency-code">{event.currency}</span>
        {multiCurrency && (
          <span className="ml-2 italic">
            · spent across {perCurrencyKeys.map((c) => c.toUpperCase()).join(', ')}
          </span>
        )}
      </p>

      {/* Per-event category breakdown (same grouping as Analysis). */}
      <button
        onClick={() => setBdOpen((o) => !o)}
        className="mt-3 w-full flex items-center justify-between cursor-pointer"
      >
        <span
          className="uppercase"
          style={{
            color: 'var(--text-secondary)',
            fontSize: 'var(--fs-rate)',
            letterSpacing: 'var(--ls-uppercase)',
            fontWeight: 'var(--fw-medium)',
          }}
        >
          Breakdown by category
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
          {bdOpen ? '▼' : '▶'}
        </span>
      </button>
      {bdOpen && (
        <div className="mt-2 flex flex-col gap-2">
          {bdLoading ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-rate)' }}>
              Loading…
            </p>
          ) : !bdRows || bdRows.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-rate)' }}>
              No categorized spending yet.
            </p>
          ) : (
            bdRows.map((row, i) => {
              const colorVar = `var(--viz-${(i % 8) + 1})`;
              return (
                <div key={row.macroId ?? '__uncat__'} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: colorVar }}
                    />
                    <span
                      className="truncate flex-1"
                      style={{ color: 'var(--text)', fontSize: 'var(--fs-body-sm)' }}
                    >
                      {row.macroName}
                    </span>
                    <span
                      className="amount amount-sm shrink-0"
                      data-privacy-field
                      style={{ color: 'var(--text)' }}
                    >
                      {formatAmount(row.amount, decimalSeparator)}{' '}
                      <span className="currency-code">{event.currency}</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div
                      className="flex-1 h-1 rounded-full overflow-hidden"
                      style={{ backgroundColor: 'var(--border)' }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${row.percentage}%`,
                          backgroundColor: colorVar,
                        }}
                      />
                    </div>
                    <span
                      className="amount shrink-0"
                      style={{
                        color: 'var(--text-muted)',
                        fontSize: 'var(--fs-rate)',
                        minWidth: '2.5rem',
                        textAlign: 'right',
                      }}
                    >
                      {row.percentage.toFixed(0)}%
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ── Annual breakdown (chart + table) ────────────────────────────────────

function AnnualBreakdownChart({
  yearlyData,
  decimalSeparator,
}: {
  yearlyData: YearlyBudgetData;
  decimalSeparator: string;
}) {
  const chartData = useMemo(() => {
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    // display-boundary: geometry only. Recharts needs JS numbers; these are
    // terminal coercions of already-quantized strings, with NO arithmetic
    // performed on the floats.
    return yearlyData.periods.map((p) => ({
      name: MONTH_LABELS[getMonthIndex(p.periodStart)],
      baseLimit: parseFloat(p.baseLimit),
      eventContribution: parseFloat(p.eventContribution),
      // Spend line stops at the current month - future months have no spend
      // yet and a line dropping to 0 would mislead.
      spent:
        p.periodStart.slice(0, 7) > currentMonth ? null : parseFloat(p.spent),
    }));
  }, [yearlyData.periods]);

  return (
    <div className="w-full mb-4" style={{ height: 280 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} barCategoryGap="20%">
          <CartesianGrid {...chartGridStyle} vertical={false} />
          <XAxis
            dataKey="name"
            {...chartAxisStyle}
          />
          <YAxis
            {...chartAxisStyle}
          />
          <Tooltip
            formatter={(value: number) =>
              formatMoney(
                String(value),
                yearlyData.budget.currency,
                decimalSeparator as ',' | '.',
              )
            }
            {...chartTooltipStyle}
          />
          <Legend wrapperStyle={{ fontSize: 'var(--fs-body-sm)' }} />
          {/* Stacked allocation: base monthly budget + events on top. */}
          <Bar
            dataKey="baseLimit"
            name="Monthly budget"
            stackId="alloc"
            fill="var(--primary)"
          />
          <Bar
            dataKey="eventContribution"
            name="Events"
            stackId="alloc"
            fill="var(--viz-2)"
            radius={[3, 3, 0, 0]}
          />
          {/* Actual spend, drawn over the bars; stops at the current month. */}
          <Line
            type="linear"
            dataKey="spent"
            name="Spent"
            stroke="var(--text)"
            strokeWidth={2}
            dot={{ r: 3, fill: 'var(--text)', strokeWidth: 0 }}
            activeDot={{ r: 4 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function AnnualBreakdownTable({
  yearlyData,
  decimalSeparator,
  onEditPeriod,
}: {
  yearlyData: YearlyBudgetData;
  decimalSeparator: string;
  onEditPeriod: (p: PeriodWithSpending) => void;
}) {
  // Only months with actual spending - all-zero rows (including future
  // months) are noise here. Months without spending are still reachable
  // for limit customization via the month selector + focused-month card.
  const activePeriods = yearlyData.periods.filter(
    (p) => !dec(p.spent).eq(0),
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full" style={{ color: 'var(--text)' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            {['Month', 'Limit', 'Events', 'Eff. Limit', 'Spent', 'Remaining', 'Used', ''].map(
              (h, i) => (
                <th
                  key={i}
                  className="pb-3 pr-4 font-medium uppercase"
                  style={{
                    color: 'var(--text-secondary)',
                    fontSize: 'var(--fs-body-sm)',
                    letterSpacing: 'var(--ls-uppercase)',
                    textAlign: i === 0 ? 'left' : 'right',
                  }}
                >
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {activePeriods.length === 0 && (
            <tr>
              <td
                colSpan={8}
                className="py-6 text-center"
                style={{
                  color: 'var(--text-muted)',
                  fontSize: 'var(--fs-body-sm)',
                }}
              >
                No spending recorded in this budget's months yet.
              </td>
            </tr>
          )}
          {activePeriods.map((period) => {
            const pctColor = getPercentageColor(period.percentage);
            const perCurrencyKeys = Object.keys(period.spentPerCurrency);
            const multi = perCurrencyKeys.length > 1;
            return (
              <tr
                key={period.id}
                style={{ borderBottom: '1px solid var(--border)' }}
              >
                <td
                  className="py-3 pr-4 font-medium"
                  style={{ fontSize: 'var(--fs-body)' }}
                >
                  {MONTH_LABELS[getMonthIndex(period.periodStart)]}
                  {period.isCustomized && (
                    <span
                      style={{
                        marginLeft: 6,
                        color: 'var(--primary)',
                        fontSize: 'var(--fs-rate)',
                      }}
                      title="Customized"
                    >
                      ★
                    </span>
                  )}
                  {multi && (
                    <div
                      style={{
                        color: 'var(--text-muted)',
                        fontSize: 'var(--fs-rate)',
                        marginTop: 2,
                      }}
                    >
                      {perCurrencyKeys.map((c) => c.toUpperCase()).join(' · ')}
                    </div>
                  )}
                </td>
                <td className="py-3 pr-4 text-right" data-privacy-field>
                  <span className="amount amount-sm" style={{ color: 'var(--text)' }}>
                    {formatAmount(period.baseLimit, decimalSeparator)}
                  </span>
                  <span className="currency-code">{yearlyData.budget.currency}</span>
                </td>
                <td className="py-3 pr-4 text-right" data-privacy-field>
                  {dec(period.eventContribution).gt(0) ? (
                    <>
                      <span
                        className="amount amount-sm"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        +{formatAmount(period.eventContribution, decimalSeparator)}
                      </span>
                      <span className="currency-code">{yearlyData.budget.currency}</span>
                    </>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>-</span>
                  )}
                </td>
                <td className="py-3 pr-4 text-right" data-privacy-field>
                  <span className="amount amount-sm" style={{ color: 'var(--text)' }}>
                    {formatAmount(period.effectiveLimit, decimalSeparator)}
                  </span>
                  <span className="currency-code">{yearlyData.budget.currency}</span>
                </td>
                <td className="py-3 pr-4 text-right" data-privacy-field>
                  <span
                    className="amount amount-sm"
                    style={{ color: 'var(--expense)' }}
                  >
                    {formatAmount(period.spent, decimalSeparator)}
                  </span>
                  <span className="currency-code">{yearlyData.budget.currency}</span>
                </td>
                <td className="py-3 pr-4 text-right" data-privacy-field>
                  <span
                    className="amount amount-sm"
                    style={{
                      color:
                        dec(period.remaining).gte(0)
                          ? 'var(--text)'
                          : 'var(--danger)',
                    }}
                  >
                    {formatAmount(period.remaining, decimalSeparator)}
                  </span>
                  <span className="currency-code">{yearlyData.budget.currency}</span>
                </td>
                <td
                  className="py-3 pr-4 text-right amount amount-sm"
                  style={{ color: pctColor, fontWeight: 'var(--fw-semibold)' }}
                >
                  {period.percentage.toFixed(1)}%
                </td>
                <td className="py-3 text-right">
                  <Button variant="ghost" onClick={() => onEditPeriod(period)}>
                    Edit
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Modals ──────────────────────────────────────────────────────────────

function CreateBudgetModal({
  open,
  onClose,
  year,
  preferredCurrency,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  year: number;
  preferredCurrency: string;
  onCreated: () => Promise<void>;
}) {
  const [startMonth, setStartMonth] = useState('1');
  const [endMonth, setEndMonth] = useState('12');
  const [rhythm, setRhythm] = useState<BudgetRhythm>('monthly');
  const [limitAmount, setLimitAmount] = useState('');
  const [currency, setCurrency] = useState(preferredCurrency);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setStartMonth('1');
      setEndMonth('12');
      setRhythm('monthly');
      setLimitAmount('');
      setCurrency(preferredCurrency);
      setError('');
    }
  }, [open, preferredCurrency]);

  async function handleCreate() {
    setError('');
    if (!isPositiveAmountString(limitAmount)) {
      setError('Please enter a valid limit amount.');
      return;
    }
    setSubmitting(true);
    try {
      await budgetService.createRecurringBudget({
        year,
        startMonth: parseInt(startMonth, 10),
        endMonth: parseInt(endMonth, 10),
        rhythm,
        limitAmount,
        currency,
      });
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create budget.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Create budget for ${year}`}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select
          label="Start Month"
          value={startMonth}
          onChange={(e) => setStartMonth(e.target.value)}
          options={MONTH_OPTIONS}
        />
        <Select
          label="End Month"
          value={endMonth}
          onChange={(e) => setEndMonth(e.target.value)}
          options={MONTH_OPTIONS}
        />
        <Select
          label="Limit resets"
          value={rhythm}
          onChange={(e) => setRhythm(e.target.value as BudgetRhythm)}
          options={RHYTHM_OPTIONS}
        />
        <Input
          label="Limit Amount"
          type="number"
          min="0"
          step="0.01"
          placeholder="e.g. 2000.00"
          value={limitAmount}
          onChange={(e) => setLimitAmount(e.target.value)}
        />
        <CurrencyPicker
          label="Currency"
          value={currency}
          onChange={setCurrency}
        />
      </div>
      {error && (
        <p className="text-sm mt-3" style={{ color: 'var(--danger)' }}>{error}</p>
      )}
      <div className="mt-5 flex justify-end gap-3">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={handleCreate} disabled={submitting}>
          {submitting ? 'Creating...' : 'Create Budget'}
        </Button>
      </div>
    </Modal>
  );
}

function EditPeriodModal({
  period,
  onClose,
  onSaved,
}: {
  period: PeriodWithSpending | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [limit, setLimit] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (period) {
      setLimit(period.limitAmount);
      setNotes(period.notes ?? '');
      setError('');
    }
  }, [period]);

  async function handleSave() {
    if (!period) return;
    if (!isPositiveAmountString(limit)) {
      setError('Please enter a valid limit amount.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await budgetService.customizePeriod(period.id, limit, notes || undefined);
      await onSaved();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to customize period.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const monthLabel = period
    ? `${MONTH_LABELS[getMonthIndex(period.periodStart)]} ${period.periodStart.slice(0, 4)}`
    : '';

  return (
    <Modal
      open={period !== null}
      onClose={onClose}
      title={period ? `Edit ${monthLabel} limit` : 'Edit period'}
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Limit Amount"
          type="number"
          min="0"
          step="0.01"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
        />
        <Input
          label="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Reason for customization..."
        />
        {error && (
          <p className="text-sm" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={submitting}>
            {submitting ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function EditBudgetLimitModal({
  open,
  onClose,
  budget,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  budget: YearlyBudgetData['budget'] | null;
  onSaved: () => Promise<void>;
}) {
  const [limit, setLimit] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open && budget) {
      setLimit(budget.limitAmount);
      setError('');
    }
  }, [open, budget]);

  async function handleSave() {
    if (!budget) return;
    if (!isPositiveAmountString(limit)) {
      setError('Please enter a valid limit amount.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await budgetService.updateRecurringBudgetLimit(budget.id, limit);
      await onSaved();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to update budget limit.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit budget baseline">
      <div className="flex flex-col gap-4">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          This updates the baseline limit used for every non-customized period.
        </p>
        <Input
          label="New Limit Amount"
          type="number"
          min="0"
          step="0.01"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
        />
        {error && (
          <p className="text-sm" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={submitting}>
            {submitting ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CreateEventModal({
  open,
  onClose,
  preferredCurrency,
  focusedMonthKey,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  preferredCurrency: string;
  focusedMonthKey: string | null;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [limit, setLimit] = useState('');
  const [currency, setCurrency] = useState(preferredCurrency);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sumToBudget, setSumToBudget] = useState(false);
  const [sumToMonth, setSumToMonth] = useState('');
  const [manualOnly, setManualOnly] = useState(false);
  const [autoCapture, setAutoCapture] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
      setLimit('');
      setCurrency(preferredCurrency);
      setStartDate('');
      setEndDate('');
      setSumToBudget(false);
      setSumToMonth('');
      setManualOnly(false);
      setAutoCapture(false);
      setError('');
    }
  }, [open, preferredCurrency]);

  // Decision Q9: pre-fill target month ONLY when the event's dates overlap the focused month.
  useEffect(() => {
    if (!sumToBudget) {
      setSumToMonth('');
      return;
    }
    if (!focusedMonthKey) return;
    if (!startDate || !endDate) return;
    const start = startOfMonth(parseISO(startDate));
    const end = startOfMonth(parseISO(endDate));
    const focused = parseISO(focusedMonthKey);
    if (focused >= start && focused <= end) {
      setSumToMonth(focusedMonthKey);
    }
  }, [sumToBudget, focusedMonthKey, startDate, endDate]);

  async function handleCreate() {
    setError('');
    const trimmedName = name.trim();
    const trimmedLimit = limit.trim();
    if (!trimmedName) return setError('Event name is required.');
    if (!isPositiveAmountString(trimmedLimit))
      return setError('A valid limit amount is required.');
    if ((startDate && !endDate) || (!startDate && endDate))
      return setError('Start and end dates must both be set or both be empty.');
    if (startDate && endDate && endDate < startDate)
      return setError('End date must be on or after start date.');
    if (sumToBudget && !sumToMonth)
      return setError('Target month is required when summing into the monthly budget.');

    setSubmitting(true);
    try {
      await budgetService.createBudgetEvent({
        name: trimmedName,
        description: description.trim() || undefined,
        limitAmount: trimmedLimit,
        currency,
        startDate: startDate || null,
        endDate: endDate || null,
        sumToBudget,
        sumToMonth: sumToBudget ? sumToMonth : null,
        manualOnly,
        autoCapture,
      });
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create event.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create event">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Trip to Japan" />
        <Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
        <Input label="Limit Amount" type="number" min="0" step="0.01" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="e.g. 1500" />
        <CurrencyPicker label="Currency" value={currency} onChange={setCurrency} />
        <Input label="Start Date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <Input label="End Date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </div>
      <div className="flex flex-col gap-3 mb-3">
        <label
          className="flex flex-col gap-1 cursor-pointer"
          style={{
            color:
              startDate && endDate ? 'var(--text-secondary)' : 'var(--text-muted)',
            fontSize: 'var(--fs-body-sm)',
            opacity: startDate && endDate ? 1 : 0.6,
          }}
        >
          <span className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={autoCapture}
              disabled={!startDate || !endDate}
              onChange={(e) => setAutoCapture(e.target.checked)}
            />
            Auto-capture
          </span>
          <span className="text-xs pl-6" style={{ color: 'var(--text-muted)' }}>
            {startDate && endDate
              ? 'Automatically link every expense whose date falls in this event’s range. Manually picked links are always preserved.'
              : 'Requires both Start and End dates.'}
          </span>
        </label>
        {autoCapture && manualOnly && (
          <p className="text-xs pl-6" style={{ color: 'var(--warning)' }}>
            Auto-capture overrides Manual only.
          </p>
        )}
        <label
          className="flex flex-col gap-1 cursor-pointer"
          style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-body-sm)' }}
        >
          <span className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={manualOnly}
              onChange={(e) => setManualOnly(e.target.checked)}
            />
            Manual only
          </span>
          <span className="text-xs pl-6" style={{ color: 'var(--text-muted)' }}>
            Don't auto-link transactions whose date falls in this event's range.
            Links must be set explicitly in the picker.
          </span>
        </label>
        <label
          className="flex items-center gap-2 cursor-pointer"
          style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-body-sm)' }}
        >
          <input
            type="checkbox"
            checked={sumToBudget}
            onChange={(e) => {
              setSumToBudget(e.target.checked);
              if (!e.target.checked) setSumToMonth('');
            }}
          />
          Include in monthly budget
        </label>
        {sumToBudget && (
          <Select
            label="Target month"
            value={sumToMonth}
            onChange={(e) => setSumToMonth(e.target.value)}
            options={[
              { value: '', label: 'Select a month…' },
              ...buildEventMonthOptions(startDate, endDate),
            ]}
          />
        )}
      </div>
      {error && (
        <p className="text-xs mb-3" style={{ color: 'var(--danger)' }}>{error}</p>
      )}
      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={handleCreate} disabled={submitting}>
          {submitting ? 'Creating...' : 'Create Event'}
        </Button>
      </div>
    </Modal>
  );
}

function EditEventModal({
  event,
  onClose,
  onSaved,
}: {
  event: BudgetEvent | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [limit, setLimit] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sumToBudget, setSumToBudget] = useState(false);
  const [sumToMonth, setSumToMonth] = useState('');
  const [manualOnly, setManualOnly] = useState(false);
  const [autoCapture, setAutoCapture] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (event) {
      setName(event.name);
      setDescription(event.description ?? '');
      setLimit(event.limitAmount);
      setStartDate(event.startDate ?? '');
      setEndDate(event.endDate ?? '');
      setSumToBudget(event.sumToBudget);
      setSumToMonth(event.sumToMonth ?? '');
      setManualOnly(event.manualOnly);
      setAutoCapture(event.autoCapture);
      setError('');
    }
  }, [event]);

  async function handleSave() {
    if (!event) return;
    setError('');
    const trimmedName = name.trim();
    const trimmedLimit = limit.trim();
    if (!trimmedName) return setError('Event name is required.');
    if (!isPositiveAmountString(trimmedLimit))
      return setError('A valid limit amount is required.');
    if ((startDate && !endDate) || (!startDate && endDate))
      return setError('Start and end dates must both be set or both be empty.');
    if (startDate && endDate && endDate < startDate)
      return setError('End date must be on or after start date.');
    if (sumToBudget && !sumToMonth)
      return setError('Target month is required when summing into the monthly budget.');

    setSubmitting(true);
    try {
      await budgetService.updateBudgetEvent(event.id, {
        name: trimmedName,
        description: description.trim(),
        limitAmount: trimmedLimit,
        startDate: startDate || null,
        endDate: endDate || null,
        sumToBudget,
        sumToMonth: sumToBudget ? sumToMonth : null,
        manualOnly,
        autoCapture,
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update event.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={event !== null} onClose={onClose} title="Edit event">
      <div className="flex flex-col gap-3 mb-4">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
        <Input label="Limit Amount" type="number" min="0" step="0.01" value={limit} onChange={(e) => setLimit(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Start Date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <Input label="End Date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <label
          className="flex flex-col gap-1 cursor-pointer"
          style={{
            color:
              startDate && endDate ? 'var(--text-secondary)' : 'var(--text-muted)',
            fontSize: 'var(--fs-body-sm)',
            opacity: startDate && endDate ? 1 : 0.6,
          }}
        >
          <span className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={autoCapture}
              disabled={!startDate || !endDate}
              onChange={(e) => setAutoCapture(e.target.checked)}
            />
            Auto-capture
          </span>
          <span className="text-xs pl-6" style={{ color: 'var(--text-muted)' }}>
            {startDate && endDate
              ? 'Automatically link every expense whose date falls in this event’s range. Manually picked links are always preserved.'
              : 'Requires both Start and End dates.'}
          </span>
        </label>
        {autoCapture && manualOnly && (
          <p className="text-xs pl-6" style={{ color: 'var(--warning)' }}>
            Auto-capture overrides Manual only.
          </p>
        )}
        <label
          className="flex flex-col gap-1 cursor-pointer"
          style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-body-sm)' }}
        >
          <span className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={manualOnly}
              onChange={(e) => setManualOnly(e.target.checked)}
            />
            Manual only
          </span>
          <span className="text-xs pl-6" style={{ color: 'var(--text-muted)' }}>
            Don't auto-link transactions whose date falls in this event's range.
            Links must be set explicitly in the picker.
          </span>
        </label>
        <label
          className="flex items-center gap-2 cursor-pointer"
          style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-body-sm)' }}
        >
          <input
            type="checkbox"
            checked={sumToBudget}
            onChange={(e) => {
              setSumToBudget(e.target.checked);
              if (!e.target.checked) setSumToMonth('');
            }}
          />
          Include in monthly budget
        </label>
        {sumToBudget && (
          <Select
            label="Target month"
            value={sumToMonth}
            onChange={(e) => setSumToMonth(e.target.value)}
            options={[
              { value: '', label: 'Select a month…' },
              ...buildEventMonthOptions(startDate, endDate),
            ]}
          />
        )}
      </div>
      {error && (
        <p className="text-xs mb-3" style={{ color: 'var(--danger)' }}>{error}</p>
      )}
      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={submitting}>
          {submitting ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </Modal>
  );
}

function DeleteBudgetModal({
  open,
  onCancel,
  budget,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  budget: YearlyBudgetData['budget'] | null;
  onConfirm: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  async function handle() {
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <Modal open={open} onClose={onCancel} title="Delete budget?">
      <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
        Delete the budget for{' '}
        <strong style={{ color: 'var(--text)' }}>{budget?.year}</strong>?
        All per-period limits and customizations will be removed.
        Transactions in this period will be preserved (they simply won't
        belong to a budget anymore).
      </p>
      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="danger" onClick={handle} disabled={submitting}>
          {submitting ? 'Deleting...' : 'Delete budget'}
        </Button>
      </div>
    </Modal>
  );
}

function DeleteEventModal({
  event,
  error,
  onCancel,
  onConfirm,
}: {
  event: BudgetEvent | null;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);

  async function handle() {
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={event !== null} onClose={onCancel} title="Delete event?">
      <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
        Are you sure you want to delete{' '}
        <strong style={{ color: 'var(--text)' }}>{event?.name}</strong>?
        Transactions linked to this event will be unlinked.
      </p>
      {error && (
        <p className="text-sm mb-4" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}
      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="danger" onClick={handle} disabled={submitting}>
          {submitting ? 'Deleting...' : 'Delete'}
        </Button>
      </div>
    </Modal>
  );
}

/* ── Recurring costs (Budgets) ───────────────────────────────────── */
//
// A LENS over the focused month's spend: each active series with its
// expected amount and this-month actual, plus the recurring slice of
// spend and a quiet missed-charge notice. These amounts are already
// inside the period total - never add them on top of it.

function RecurringCostsSection({
  focusedMonthKey,
  targetCurrency,
  decimalSeparator,
}: {
  focusedMonthKey: string | null;
  targetCurrency: string;
  decimalSeparator: string;
}) {
  const { year, month } = useMemo(() => {
    if (focusedMonthKey) {
      return {
        year: parseInt(focusedMonthKey.slice(0, 4), 10),
        month: parseInt(focusedMonthKey.slice(5, 7), 10),
      };
    }
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  }, [focusedMonthKey]);

  const [data, setData] = useState<RecurringForMonthResult | null>(null);
  const [missed, setMissed] = useState<MissedCharge[]>([]);
  const [editing, setEditing] = useState<RecurringSeries | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [d, m] = await Promise.all([
        recurringService.getRecurringForMonth({ year, month, targetCurrency }),
        recurringService.listMissedCharges(),
      ]);
      setData(d);
      setMissed(m);
    } catch (err) {
      console.warn('[Budgets] recurring load failed:', err);
      setData(null);
      setMissed([]);
    }
  }, [year, month, targetCurrency]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function runAction(_id: string, work: () => Promise<void>) {
    setActionErr(null);
    try {
      await work();
      await reload();
    } catch (err) {
      setActionErr(
        err instanceof Error ? err.message : 'Action failed - please retry.',
      );
    }
  }

  if (!data) return null;

  const hasRows = data.rows.length > 0;

  return (
    /* px-5 matches the Card's p-5 inset so this chrome-free section's text
       column lines up with the Events card content above it. */
    <div className="mt-6 px-5">
      {actionErr && (
        <p className="text-sm mb-2" style={{ color: 'var(--danger)' }}>
          {actionErr}
        </p>
      )}
      <div className="flex items-center gap-2 mb-3">
        <Repeat2 size={16} aria-hidden style={{ color: 'var(--viz-3, #7c3aed)' }} />
        <h3
          style={{
            color: 'var(--text)',
            fontSize: 'var(--fs-body)',
            fontWeight: 'var(--fw-semibold)',
          }}
        >
          Recurring costs
        </h3>
      </div>

      {!hasRows ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}>
          No recurring expenses yet. Flag one from Review or a transaction's edit screen.
        </p>
      ) : (
        <>
          <p
            className="mb-3"
            data-privacy-field
            style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}
          >
            <strong style={{ color: 'var(--text)' }}>
              {formatAmount(data.totalActual, decimalSeparator)} {targetCurrency}
            </strong>{' '}
            of this month's spend is recurring
            {dec(data.remainingExpected).gt(0) && (
              <>
                {' '}· {formatAmount(data.remainingExpected, decimalSeparator)} {targetCurrency}{' '}
                still expected
              </>
            )}
            .
          </p>

          <div className="grid grid-cols-1 gap-2">
            {data.rows.map((row) => (
              <div
                key={row.series.id}
                className="rounded-lg p-3"
                style={{
                  backgroundColor: 'var(--card-bg, var(--surface))',
                  border: '1px solid var(--border)',
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p
                      className="truncate"
                      style={{
                        color: 'var(--text)',
                        fontSize: 'var(--fs-body-sm)',
                        fontWeight: 'var(--fw-medium)',
                      }}
                    >
                      {row.series.displayName}
                    </p>
                    <p
                      className="capitalize"
                      style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-rate)' }}
                    >
                      {row.series.cadence}
                      {row.expected != null && (
                        <span data-privacy-field>
                          {' '}· expected {formatAmount(row.expected, decimalSeparator)}{' '}
                          {targetCurrency}
                        </span>
                      )}
                    </p>
                  </div>
                  {/* No pause/end controls: series self-retire. When the
                      expected charge stops arriving at the start of its
                      period (due date + grace), the card disappears on its
                      own and returns if the charge resumes. */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setEditing(row.series)}
                      className="p-1.5 rounded transition-opacity hover:opacity-80 cursor-pointer"
                      style={{ color: 'var(--text-muted)' }}
                      title="Edit"
                    >
                      <Pencil size={14} />
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-rate)' }}>
                    {row.charged ? 'Charged this month' : 'Not yet charged'}
                  </span>
                  <span
                    className="amount"
                    data-privacy-field
                    style={{ color: 'var(--text)', fontSize: 'var(--fs-body-sm)' }}
                  >
                    {formatAmount(row.actual, decimalSeparator)} {targetCurrency}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {missed.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          {missed.map((m) => (
            <p
              key={m.series.id}
              className="inline-flex items-center gap-1.5"
              style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}
            >
              <Clock size={13} aria-hidden style={{ color: 'var(--warning)' }} />
              {m.series.displayName} usually hits around {formatDayLabel(m.expectedDate)} -
              nothing yet.
            </p>
          ))}
        </div>
      )}

      <EditRecurringModal
        series={editing}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await reload();
        }}
        onReactivate={(id) => void runAction(id, () => recurringService.reactivateSeries(id))}
      />
    </div>
  );
}

function EditRecurringModal({
  series,
  onClose,
  onSaved,
  onReactivate,
}: {
  series: RecurringSeries | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onReactivate: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [cadence, setCadence] = useState<RecurrenceCadence>('monthly');
  const [expected, setExpected] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (series) {
      setName(series.displayName);
      setCadence(series.cadence);
      setExpected(series.expectedAmount ?? '');
      setCategoryId(series.categoryId);
      setError('');
    }
  }, [series]);

  if (!series) return null;

  async function handleSave() {
    if (!series) return;
    if (expected.trim() && !isPositiveAmountString(expected)) {
      setError('Expected amount must be a positive number (or empty).');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await recurringService.updateSeries(series.id, {
        displayName: name.trim() || series.displayName,
        cadence,
        expectedAmount: expected.trim() || null,
        categoryId,
      });
      await onSaved();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to update the series.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={series !== null} onClose={onClose} title="Edit recurring series">
      <div className="flex flex-col gap-4 mb-4">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Select
          label="Cadence"
          value={cadence}
          onChange={(e) => setCadence(e.target.value as RecurrenceCadence)}
          options={[
            { value: 'weekly', label: 'Weekly' },
            { value: 'monthly', label: 'Monthly' },
            { value: 'yearly', label: 'Yearly' },
          ]}
        />
        <Input
          label={`Expected amount${series.currency ? ` (${series.currency})` : ''}`}
          value={expected}
          onChange={(e) => setExpected(e.target.value)}
          placeholder="0.00"
        />
        <CategoryPicker
          label="Category"
          value={categoryId}
          onChange={setCategoryId}
          type="expense"
        />
        {error && (
          <p className="text-sm" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}
        {series.status !== 'active' && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            This series is {series.status}.{' '}
            <button
              className="underline cursor-pointer"
              style={{ color: 'var(--primary)' }}
              onClick={() => {
                onReactivate(series.id);
                onClose();
              }}
            >
              Reactivate
            </button>
          </p>
        )}
      </div>
      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={submitting}>
          {submitting ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </Modal>
  );
}
