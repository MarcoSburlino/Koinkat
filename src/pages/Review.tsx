import { formatFullDate as formatDate } from '../lib/date-format';
import { UPPERCASE_LABEL } from '../lib/label-styles';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Check, CheckCheck, Clock, MoreHorizontal, Repeat2, RefreshCw, RotateCcw, Sparkles, Users } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { CategoryPicker } from '../components/ui/CategoryPicker';
import { BudgetEventPicker } from '../components/ui/BudgetEventPicker';
import { RecurringBadge } from '../components/ui/RecurringBadge';
import { PrivacyField } from '../components/ui/PrivacyField';
import { InfoBanner } from '../components/ui/InfoBanner';
import { PageHeader } from '../components/layout/PageHeader';
import { useAppStore } from '../stores/app-store';
import { formatAmount } from '../lib/format';
import * as transactionService from '../services/transaction-service';
import * as categoryService from '../services/category-service';
import * as recurringService from '../services/recurring-service';
import type { RecurringSuggestion } from '../services/recurring-service';
import {
  categorizer,
  uncategorizeAll,
  recategorizeAll,
} from '../services/categorization-service';
import { recleanImportedNotes } from '../services/bank-sync-service';
import type { Transaction, Category } from '../types/models';
import type { RecurrenceCadence } from '../types/enums';

const PER_PAGE = 50;

// In demo builds the fixture-backed bank sync imports two expense rows
// that need to be wired up as split parents. The banner at the top of
// this page nudges the user toward that task.
// On in demo builds, off in development by default, impossible in production.
const IS_MOCK_MODE = __KOINKAT_ALLOW_MOCKS__ && __KOINKAT_EB_MOCK_DEFAULT__;

/**
 * How the suggested category was picked, in user language. `RULE`/`MCC`
 * were engine internals; a null return hides the badge entirely (a bare
 * "-" chip read as a rendering bug).
 */
function confidenceBadge(
  source: string | null,
): { label: string; hint: string } | null {
  switch (source) {
    case 'rule_auto':
      return {
        label: 'Suggested',
        hint: 'Suggested from your past confirmations of this merchant',
      };
    case 'mcc_auto':
      return {
        label: 'Auto',
        hint: "Guessed from the merchant's business type",
      };
    default:
      return null;
  }
}

export function Review() {
  const settings = useAppStore((s) => s.settings);
  const refreshPendingReviewCount = useAppStore(
    (s) => s.refreshPendingReviewCount,
  );

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Total rows still needing review (can exceed the PER_PAGE shown).
  const [totalPending, setTotalPending] = useState(0);
  // Map category_id → Category for rendering suggested-category rows.
  const [categoryMap, setCategoryMap] = useState<Map<string, Category>>(
    new Map(),
  );
  // Per-row pending category change (txn id → new category id).
  // When set, the Confirm button uses this id instead of the txn's
  // suggested category. Cleared when the user confirms or cancels.
  const [pendingChanges, setPendingChanges] = useState<
    Record<string, string>
  >({});
  // Per-row pending budget-event change (txn id → event id | null).
  // Distinct from `pendingChanges`: explicit `null` is a valid pending
  // value (clear the link), so presence is tested via `in`, not `??`.
  const [pendingEvents, setPendingEvents] = useState<
    Record<string, string | null>
  >({});
  const [processing, setProcessing] = useState<string | null>(null);
  // Transient toast showing the last retroactive-update count
  // (e.g. "Also categorized 42 similar transactions")
  const [retroToast, setRetroToast] = useState<string | null>(null);
  // Status line shared by the uncategorize action.
  const [backfillResult, setBackfillResult] = useState<string | null>(null);
  // Uncategorize-from-date state (destructive action, gated by confirm modal)
  const [uncategorizeConfirmOpen, setUncategorizeConfirmOpen] =
    useState(false);
  const [uncategorizing, setUncategorizing] = useState(false);
  // ISO date (YYYY-MM-DD) the uncategorize action resets from. Defaults to
  // the first of the current month.
  const [uncategorizeFromDate, setUncategorizeFromDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
  // Re-clean notes state (non-destructive maintenance action).
  const [recleanConfirmOpen, setRecleanConfirmOpen] = useState(false);
  const [recleaning, setRecleaning] = useState(false);
  // Re-categorize all state (mostly non-destructive - preserves user-
  // confirmed rows).
  const [recategorizeConfirmOpen, setRecategorizeConfirmOpen] = useState(false);
  const [recategorizing, setRecategorizing] = useState(false);
  // Row id currently having its "Budgeted" flag persisted (disables that
  // row's checkbox to avoid a double-toggle race).
  const [budgetingId, setBudgetingId] = useState<string | null>(null);
  // Overflow menu holding the maintenance tools (re-categorize / re-clean /
  // uncategorize) - powerful but rarely used, so they don't earn a
  // permanent header button each.
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  // Rows whose manual "mark as recurring" controls are expanded. The
  // controls used to render on EVERY expense card; now they hide behind a
  // small link unless the matcher itself has a suggestion.
  const [recurringFormFor, setRecurringFormFor] = useState<Set<string>>(
    new Set(),
  );

  // Split-expense wizard state.
  // expenseSelection keeps both "checked" and the (optionally overridden)
  // category per row - category defaults to the row's existing suggestion.
  const [splitWizardOpen, setSplitWizardOpen] = useState(false);
  const [wizardExpenseSelection, setWizardExpenseSelection] = useState<
    Record<string, { checked: boolean; categoryId: string | null }>
  >({});
  const [wizardIncomeSelection, setWizardIncomeSelection] = useState<
    Set<string>
  >(new Set());
  const [wizardSubmitting, setWizardSubmitting] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);

  // `background: true` refreshes the queue WITHOUT toggling the loading
  // flag - per-row actions use it so confirming one row doesn't blank the
  // whole list and reset the scroll position (the single most-repeated
  // interaction in the app).
  const load = useCallback(async (opts?: { background?: boolean }) => {
    if (!opts?.background) setLoading(true);
    setLoadError(null);
    try {
      const [result, cats] = await Promise.all([
        transactionService.listTransactions({
          needsReview: true,
          sortBy: 'date',
          sortDir: 'desc',
          perPage: PER_PAGE,
        }),
        categoryService.listCategories(),
      ]);
      setTransactions(result.transactions);
      setTotalPending(result.total);
      const map = new Map<string, Category>();
      for (const c of cats) map.set(c.id, c);
      setCategoryMap(map);
    } catch (err) {
      // Without this, a failed load renders the "All caught up" empty state
      // - falsely telling the user there's nothing to review.
      setLoadError(
        err instanceof Error ? err.message : 'Failed to load the review queue',
      );
    } finally {
      if (!opts?.background) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ── Recurring capture state ───────────────────────────────────────
  const [recurringSuggestions, setRecurringSuggestions] = useState<
    Map<string, RecurringSuggestion>
  >(new Map());
  const [recurringCadence, setRecurringCadence] = useState<
    Record<string, RecurrenceCadence>
  >({});
  const [recurringBusy, setRecurringBusy] = useState<string | null>(null);

  // After the queue loads, ask the matcher for a pre-filled suggestion on
  // each unflagged expense ("Looks like your monthly Netflix" / price jump).
  // One batched call for the whole queue - the per-row form ran three
  // queries per transaction.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const expenses = transactions.filter(
        (t) => t.type === 'expense' && !t.recurringSeriesId && !t.recurringLocked,
      );
      const m = await recurringService
        .getRecurringSuggestionsBatch(expenses.map((t) => t.id))
        .catch(() => new Map<string, RecurringSuggestion>());
      if (cancelled) return;
      setRecurringSuggestions(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [transactions]);

  const cadenceFor = (id: string): RecurrenceCadence =>
    recurringCadence[id] ?? 'monthly';

  async function runRecurringAction(txnId: string, work: () => Promise<void>) {
    setRecurringBusy(txnId);
    try {
      await work();
      await refreshPendingReviewCount();
      await load({ background: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Review] recurring action failed:', err);
      setRetroToast(`Failed: ${msg || 'Unknown error.'}`);
      setTimeout(() => setRetroToast(null), 6000);
    } finally {
      setRecurringBusy(null);
    }
  }

  /** Flag a fresh expense as recurring with the chosen cadence. */
  function handleFlagRecurring(txn: Transaction) {
    void runRecurringAction(txn.id, () =>
      recurringService
        .flagTransactionAsRecurring(txn.id, { cadence: cadenceFor(txn.id) })
        .then(() => undefined),
    );
  }

  /** Confirm a matcher suggestion (attaches to / strengthens the series). */
  function handleConfirmRecurring(txn: Transaction) {
    void runRecurringAction(txn.id, () =>
      recurringService.flagTransactionAsRecurring(txn.id).then(() => undefined),
    );
  }

  /** "Not recurring" - record a dismissal so the matcher stops nudging. */
  function handleDismissRecurring(txn: Transaction) {
    void runRecurringAction(txn.id, () =>
      recurringService.dismissMerchant(txn.id),
    );
  }

  /** Clear an existing series link from this row. */
  function handleUnflagRecurring(txn: Transaction) {
    void runRecurringAction(txn.id, () =>
      recurringService.unflagRecurring(txn.id),
    );
  }

  /**
   * Shared confirm logic. Called by both `handleConfirm` (single row
   * only) and `handleConfirmForAll` (row + retroactive propagation).
   *
   * Both paths create or strengthen a learned rule for the merchant,
   * so FUTURE bank imports of the same merchant auto-categorize. They
   * differ only in whether EXISTING matching rows get retroactively
   * updated: single confirm leaves them alone, "for all" propagates.
   */
  async function applyConfirm(txn: Transaction, propagate: boolean) {
    const pending = pendingChanges[txn.id];
    const effectiveId = pending ?? txn.categoryId;
    if (!effectiveId) return;
    const isCorrection = pending !== undefined && pending !== txn.categoryId;
    const effectiveCategory = categoryMap.get(effectiveId);
    const effectiveName = effectiveCategory
      ? effectiveCategory.parentId
        ? `${categoryMap.get(effectiveCategory.parentId)?.name ?? ''} / ${effectiveCategory.name}`
        : effectiveCategory.name
      : 'the selected category';

    setProcessing(txn.id);
    try {
      const result = await categorizer.learnFromCorrection({
        transactionId: txn.id,
        newCategoryId: effectiveId,
        action: isCorrection ? 'corrected' : 'confirmed',
        propagate,
      });
      // If the user also changed the budget event link, persist just that
      // one column. We deliberately use the lightweight
      // setTransactionBudgetEvent (a single auto-commit UPDATE) rather than
      // the heavy updateIncomeExpense transaction - the latter reverses and
      // re-applies the balance for no reason here, can trip "database is
      // locked", and would overwrite the categorization_source that
      // learnFromCorrection just set.
      if (
        txn.id in pendingEvents &&
        pendingEvents[txn.id] !== txn.budgetEventId
      ) {
        await transactionService.setTransactionBudgetEvent(
          txn.id,
          pendingEvents[txn.id],
        );
      }
      // Clear the row's pending state
      setPendingChanges((prev) => {
        const { [txn.id]: _cleared, ...rest } = prev;
        return rest;
      });
      setPendingEvents((prev) => {
        const { [txn.id]: _cleared, ...rest } = prev;
        return rest;
      });

      // Toast only for the propagating path - single confirm is silent
      // because there's nothing interesting to report. The three result
      // kinds correspond to three observably different things that just
      // happened; renaming them into a single "0 matches" toast (as we
      // did before) made the user think nothing worked.
      if (propagate) {
        switch (result.kind) {
          case 'learned':
            if (result.retroactiveUpdates > 0) {
              setRetroToast(
                `Also categorized ${result.retroactiveUpdates} similar transaction${result.retroactiveUpdates !== 1 ? 's' : ''} as ${effectiveName}`,
              );
            } else {
              setRetroToast(
                `No other matching transactions found. The rule is saved for future imports.`,
              );
            }
            break;
          case 'no_merchant':
            setRetroToast(
              `Confirmed. Couldn't learn a rule - this transaction has no merchant name to match future imports against.`,
            );
            break;
          case 'transaction_missing':
            setRetroToast(
              `Transaction not found - it may have been deleted in another window.`,
            );
            break;
        }
        setTimeout(() => setRetroToast(null), 5000);
      }

      // Optimistically drop the confirmed row so the rest of the queue
      // stays in place (no loading flash, no scroll reset), then refresh
      // in the background to pick up retroactive changes.
      setTransactions((prev) => prev.filter((t) => t.id !== txn.id));
      setTotalPending((prev) => Math.max(0, prev - 1));
      await refreshPendingReviewCount();
      await load({ background: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Review] applyConfirm failed:', err);
      setRetroToast(`Failed: ${msg || 'Unknown error.'}`);
      setTimeout(() => setRetroToast(null), 6000);
    } finally {
      setProcessing(null);
    }
  }

  /** "Confirm" - persists THIS row only. The learned rule is still
   *  created so future imports of the same merchant auto-match, but
   *  other existing matching rows stay in the review queue. */
  async function handleConfirm(txn: Transaction) {
    await applyConfirm(txn, false);
  }

  /** "Confirm for all" - persists THIS row plus fuzzy-updates every
   *  other transaction in the workspace with a matching merchant.
   *  This is the "Pizzeria da Gigi effect". */
  async function handleConfirmForAll(txn: Transaction) {
    await applyConfirm(txn, true);
  }

  /**
   * User picked a category in the picker. Store it as a PENDING
   * change (not persisted yet) - the user must click Confirm next
   * to make it official.
   */
  function handlePickCategory(txn: Transaction, newCategoryId: string) {
    setPendingChanges((prev) => ({ ...prev, [txn.id]: newCategoryId }));
  }

  /**
   * Toggle the per-row "Budgeted" flag. Persists immediately, independent
   * of the category confirm flow. Unchecking excludes the expense from
   * monthly budget totals; the service also clears any budget-event link,
   * so we drop any pending event for the row to keep the UI in sync.
   */
  async function handleToggleBudgeted(txn: Transaction, next: boolean) {
    if (budgetingId) return;
    setBudgetingId(txn.id);
    try {
      await transactionService.setTransactionBudgeted(txn.id, next);
      if (!next) {
        setPendingEvents((prev) => {
          const { [txn.id]: _cleared, ...rest } = prev;
          return rest;
        });
      }
      // Patch the single row in place - a full reload would blank the list
      // and reset scroll for a one-column change.
      setTransactions((prev) =>
        prev.map((t) =>
          t.id === txn.id
            ? { ...t, isBudgeted: next, budgetEventId: next ? t.budgetEventId : null }
            : t,
        ),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setRetroToast(`Failed to update the Budgeted flag: ${msg}`);
      setTimeout(() => setRetroToast(null), 6000);
    } finally {
      setBudgetingId(null);
    }
  }

  /** Stage a budget-event change for this row. Picking the row's
   *  existing value clears the pending state to avoid showing a
   *  "pending" indicator for a no-op. */
  function handlePickEvent(txn: Transaction, eventId: string | null) {
    setPendingEvents((prev) => {
      if (eventId === txn.budgetEventId) {
        const { [txn.id]: _cleared, ...rest } = prev;
        return rest;
      }
      return { ...prev, [txn.id]: eventId };
    });
  }

  async function handleUncategorizeAll() {
    if (uncategorizing) return;
    setUncategorizing(true);
    setBackfillResult(null);
    try {
      const count = await uncategorizeAll(uncategorizeFromDate);
      const fromLabel = formatDate(uncategorizeFromDate);
      setBackfillResult(
        count === 0
          ? `No transactions dated on/after ${fromLabel} to reset.`
          : `Reset ${count} transaction${count !== 1 ? 's' : ''} dated on/after ${fromLabel}; they're back in this review queue.`,
      );
      await refreshPendingReviewCount();
      await load();
    } catch (err) {
      setBackfillResult(
        err instanceof Error
          ? `Failed: ${err.message}`
          : 'Failed to reset categorization.',
      );
    } finally {
      setUncategorizing(false);
      setUncategorizeConfirmOpen(false);
    }
  }

  async function handleRecleanNotes() {
    if (recleaning) return;
    setRecleaning(true);
    setBackfillResult(null);
    try {
      const count = await recleanImportedNotes();
      setBackfillResult(
        count === 0
          ? 'No imported notes needed re-cleaning. Either everything is already cleaned, or all rows were imported before this feature shipped (run "Re-pull everything from scratch" in Settings to refresh them).'
          : `Re-cleaned ${count} imported note${count !== 1 ? 's' : ''}.`,
      );
      await load();
    } catch (err) {
      setBackfillResult(
        err instanceof Error
          ? `Failed: ${err.message}`
          : 'Failed to re-clean notes.',
      );
    } finally {
      setRecleaning(false);
      setRecleanConfirmOpen(false);
    }
  }

  async function handleRecategorizeAll() {
    if (recategorizing) return;
    setRecategorizing(true);
    setBackfillResult(null);
    try {
      const result = await recategorizeAll();
      setBackfillResult(
        result.processed === 0
          ? 'Nothing to re-categorize - every engine-driven row already has a high-confidence category.'
          : `Re-categorized ${result.processed} transaction${result.processed !== 1 ? 's' : ''} (${result.needsReview} still need review, ${result.backfilled} merchant name${result.backfilled !== 1 ? 's' : ''} backfilled).`,
      );
      await refreshPendingReviewCount();
      await load();
    } catch (err) {
      setBackfillResult(
        err instanceof Error
          ? `Failed: ${err.message}`
          : 'Failed to re-categorize.',
      );
    } finally {
      setRecategorizing(false);
      setRecategorizeConfirmOpen(false);
    }
  }

  // ── Split-expense wizard handlers ──────────────────────────────────

  // Derived slices of the review queue used by the wizard modal.
  const queueExpenses = useMemo(
    () => transactions.filter((t) => t.type === 'expense'),
    [transactions],
  );
  const queueIncomes = useMemo(
    () => transactions.filter((t) => t.type === 'income'),
    [transactions],
  );

  function openSplitWizard() {
    // Seed the expense selection with each row's current category
    // suggestion so the CategoryPickers render meaningful defaults. No
    // rows are checked by default - user opts in per-row.
    const seed: Record<string, { checked: boolean; categoryId: string | null }> = {};
    for (const e of queueExpenses) {
      seed[e.id] = { checked: false, categoryId: e.categoryId ?? null };
    }
    setWizardExpenseSelection(seed);
    setWizardIncomeSelection(new Set());
    setWizardError(null);
    setSplitWizardOpen(true);
  }

  function closeSplitWizard() {
    setSplitWizardOpen(false);
    setWizardError(null);
  }

  function toggleWizardExpense(id: string) {
    setWizardExpenseSelection((prev) => ({
      ...prev,
      [id]: {
        checked: !(prev[id]?.checked ?? false),
        categoryId: prev[id]?.categoryId ?? null,
      },
    }));
  }

  function setWizardExpenseCategory(id: string, categoryId: string | null) {
    setWizardExpenseSelection((prev) => ({
      ...prev,
      [id]: {
        checked: prev[id]?.checked ?? false,
        categoryId,
      },
    }));
  }

  function toggleWizardIncome(id: string) {
    setWizardIncomeSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleConfirmSplitWizard() {
    const checkedExpenses = queueExpenses.filter(
      (e) => wizardExpenseSelection[e.id]?.checked,
    );
    if (checkedExpenses.length === 0) {
      setWizardError('Pick at least one expense to flag.');
      return;
    }

    // The UI only allows linking incomes when exactly one expense is
    // selected, but double-check to keep the invariant inside the
    // orchestrator too.
    const incomeIds = Array.from(wizardIncomeSelection);
    if (incomeIds.length > 0 && checkedExpenses.length !== 1) {
      setWizardError(
        'To link reimbursements, check exactly one expense. Uncheck the rest or run the wizard again later.',
      );
      return;
    }

    setWizardSubmitting(true);
    setWizardError(null);
    try {
      // Flag each selected expense as a split. Each call is idempotent -
      // if the row is already a split, only the category + confirmation
      // state are updated.
      for (const expense of checkedExpenses) {
        const categoryId =
          wizardExpenseSelection[expense.id]?.categoryId ?? null;
        await transactionService.flagExpenseAsSplit(expense.id, categoryId);
      }

      // Link incomes to the one-and-only-if-any parent.
      if (incomeIds.length > 0) {
        await transactionService.linkIncomesAsRepayments(
          checkedExpenses[0].id,
          incomeIds,
        );
      }

      // Drop state + refresh queue.
      setSplitWizardOpen(false);
      setWizardExpenseSelection({});
      setWizardIncomeSelection(new Set());
      await refreshPendingReviewCount();
      await load();
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : String(err);
      console.error('[Review] split wizard failed:', err);
      setWizardError(msg || 'Failed to flag split expenses.');
    } finally {
      setWizardSubmitting(false);
    }
  }

  const hasRows = transactions.length > 0;

  return (
    <div>
      <PageHeader
        serif
        label="Inbox"
        title="Review"
        subtitle={
          totalPending > 0
            ? `${totalPending} transaction${totalPending !== 1 ? 's' : ''} waiting${totalPending > PER_PAGE ? ` · showing the first ${PER_PAGE}` : ''}. Confirm to teach the system.`
            : 'Bank-imported transactions that need a category confirmed. Confirm to teach the system.'
        }
        right={
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="secondary"
              onClick={openSplitWizard}
              disabled={queueExpenses.length === 0 || uncategorizing || recleaning || recategorizing}
              title="Flag one or more expenses in this queue as split expenses and link matching reimbursement incomes to them, without re-typing amounts."
            >
              <Users size={16} />
              Flag &amp; link split expenses
            </Button>
            {/* Maintenance tools live behind an overflow menu - three
                always-visible power buttons crowded the header of the
                app's most-visited page. */}
            <div className="relative">
              <Button
                variant="ghost"
                onClick={() => setMaintenanceOpen((o) => !o)}
                disabled={uncategorizing || recleaning || recategorizing}
                title="Maintenance tools"
                aria-label="More actions"
                aria-expanded={maintenanceOpen}
              >
                <MoreHorizontal size={16} />
              </Button>
              {maintenanceOpen && (
                <>
                  {/* Click-away backdrop */}
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setMaintenanceOpen(false)}
                  />
                  <div
                    className="absolute right-0 top-full mt-1 z-20 py-1 w-72 rounded-lg"
                    style={{
                      backgroundColor: 'var(--surface)',
                      border: '1px solid var(--border)',
                      boxShadow: 'var(--elev-2)',
                    }}
                  >
                    {(
                      [
                        {
                          icon: Sparkles,
                          label: 'Re-categorize all',
                          hint: 'Re-run suggestions on everything you haven’t confirmed',
                          onClick: () => setRecategorizeConfirmOpen(true),
                        },
                        {
                          icon: RefreshCw,
                          label: 'Re-clean notes',
                          hint: 'Re-run the description cleaner on imported notes',
                          onClick: () => setRecleanConfirmOpen(true),
                        },
                        {
                          icon: RotateCcw,
                          label: 'Uncategorize from…',
                          hint: 'Send imported rows back into this queue',
                          onClick: () => setUncategorizeConfirmOpen(true),
                        },
                      ] as const
                    ).map(({ icon: Icon, label, hint, onClick }) => (
                      <button
                        key={label}
                        type="button"
                        className="w-full flex items-start gap-2.5 px-3 py-2 text-left cursor-pointer transition-colors"
                        style={{ color: 'var(--text)' }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor =
                            'var(--surface-alt)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                        onClick={() => {
                          setMaintenanceOpen(false);
                          onClick();
                        }}
                      >
                        <Icon
                          size={15}
                          className="mt-0.5 shrink-0"
                          style={{ color: 'var(--text-muted)' }}
                        />
                        <span className="min-w-0">
                          <span
                            className="block"
                            style={{ fontSize: 'var(--fs-body-sm)' }}
                          >
                            {label}
                          </span>
                          <span
                            className="block"
                            style={{
                              color: 'var(--text-muted)',
                              fontSize: 'var(--fs-rate)',
                            }}
                          >
                            {hint}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        }
      />

      {IS_MOCK_MODE && (
        <InfoBanner
          storageKey="koinkat.reviewMockModeDismissed"
          variant="warning"
          title="Mock mode"
          className="mb-4"
        >
          2 split transactions need wiring. Use the Flag &amp; link wizard:
          look for 'Trattoria Da Enzo' (€120, flag + link 2 repayments) and
          'Airbnb Ireland' (€210, flag + link 1 repayment).
        </InfoBanner>
      )}

      {backfillResult && (
        <div
          className="mb-4 px-4 py-3 rounded-lg"
          style={{
            backgroundColor:
              'color-mix(in srgb, var(--primary) 10%, var(--surface))',
            border:
              '1px solid color-mix(in srgb, var(--primary) 30%, var(--border))',
            color: 'var(--text)',
            fontSize: 'var(--fs-body-sm)',
          }}
        >
          {backfillResult}
        </div>
      )}

      {retroToast && (
        <div
          className="mb-4 px-4 py-3 rounded-lg flex items-center gap-3"
          style={{
            backgroundColor:
              'color-mix(in srgb, var(--income) 12%, var(--surface))',
            border:
              '1px solid color-mix(in srgb, var(--income) 35%, var(--border))',
            color: 'var(--text)',
            fontSize: 'var(--fs-body-sm)',
            fontWeight: 'var(--fw-medium)',
          }}
        >
          {retroToast}
        </div>
      )}

      {loadError && (
        <Card className="mb-4">
          <p className="text-sm py-2" style={{ color: 'var(--danger)' }}>
            Couldn't load the review queue: {loadError}
          </p>
        </Card>
      )}

      {loading ? (
        <Card>
          <p
            className="text-center py-12"
            style={{
              color: 'var(--text-muted)',
              fontSize: 'var(--fs-body-sm)',
            }}
          >
            Loading...
          </p>
        </Card>
      ) : loadError ? null : !hasRows ? (
        <Card>
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <CheckCheck
              size={32}
              strokeWidth={1.75}
              style={{ color: 'var(--income)' }}
            />
            <p
              style={{
                color: 'var(--text)',
                fontSize: 'var(--fs-h3)',
                fontFamily: 'var(--font-head)',
                fontWeight: 'var(--fw-medium)',
              }}
            >
              All caught up
            </p>
            <p
              className="text-center max-w-md"
              style={{
                color: 'var(--text-muted)',
                fontSize: 'var(--fs-body-sm)',
              }}
            >
              No transactions are waiting for review. Bank-imported transactions
              will show up here automatically after the next sync.
            </p>
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {transactions.map((txn) => {
            const isProcessing = processing === txn.id;
            const pending = pendingChanges[txn.id];
            const effectiveCategoryId = pending ?? txn.categoryId;
            const hasPending = pending !== undefined && pending !== txn.categoryId;
            const hasPendingEvent = txn.id in pendingEvents;
            const effectiveEventId = hasPendingEvent
              ? pendingEvents[txn.id]
              : txn.budgetEventId;
            const displayMerchant =
              txn.merchantRaw ?? txn.note ?? '(no merchant)';
            const badge = confidenceBadge(txn.categorizationSource);

            return (
              <Card key={txn.id}>
                <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                  {/* ── Identity: name on top, meta directly below ── */}
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    {/* Line 1: merchant name + source badge */}
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="truncate min-w-0"
                        title={displayMerchant}
                        style={{
                          color: 'var(--text)',
                          fontSize: 'var(--fs-body)',
                          fontWeight: 'var(--fw-medium)',
                        }}
                      >
                        {displayMerchant}
                      </span>
                      {badge && (
                        <span
                          className="px-1.5 py-0.5 rounded uppercase shrink-0"
                          title={badge.hint}
                          style={{
                            backgroundColor: 'var(--surface-alt)',
                            color: 'var(--text-muted)',
                            fontSize: 'var(--fs-rate)',
                            fontFamily: 'var(--font-mono)',
                            letterSpacing: 'var(--ls-uppercase)',
                          }}
                        >
                          {badge.label}
                        </span>
                      )}
                      {txn.status === 'pending' && (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full shrink-0"
                          style={{
                            backgroundColor:
                              'color-mix(in srgb, var(--warning) 15%, transparent)',
                            color: 'var(--warning)',
                            fontSize: 'var(--fs-rate)',
                            letterSpacing: 'var(--ls-uppercase)',
                            fontWeight: 'var(--fw-medium)',
                          }}
                          title="Awaiting bank confirmation"
                        >
                          <Clock size={11} aria-hidden />
                          Pending
                        </span>
                      )}
                      {txn.recurringSeriesId && <RecurringBadge />}
                    </div>
                    {/* Line 2: date · account · amount (moved under the name) */}
                    <div
                      className="flex items-center gap-2 flex-wrap"
                      style={{
                        color: 'var(--text-muted)',
                        fontSize: 'var(--fs-body-sm)',
                      }}
                    >
                      <span>{formatDate(txn.date)}</span>
                      {txn.account && (
                        <>
                          <span aria-hidden="true" style={{ opacity: 0.4 }}>·</span>
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: txn.account.color }}
                            />
                            {txn.account.name}
                          </span>
                        </>
                      )}
                      <span aria-hidden="true" style={{ opacity: 0.4 }}>·</span>
                      <span
                        className="amount amount-sm"
                        style={{
                          color:
                            txn.type === 'income'
                              ? 'var(--income)'
                              : 'var(--expense)',
                        }}
                        data-privacy-field
                      >
                        {txn.type === 'expense' ? '-' : ''}
                        {formatAmount(txn.amount, settings.decimalSeparator)}
                      </span>
                      <span className="currency-code">{txn.currency}</span>
                    </div>
                  </div>

                  {/* ── Controls: category on top, event + budgeted below ── */}
                  <div className="w-full lg:w-72 shrink-0 flex flex-col gap-2">
                    {/* A staged-but-unsaved re-pick must be visibly different
                        from an untouched suggestion, and recoverable - the
                        revert (×) restores the engine's original suggestion. */}
                    {hasPending && (
                      <div className="flex items-center gap-2">
                        <span
                          className="uppercase px-1.5 py-0.5 rounded"
                          style={{
                            color: 'var(--primary)',
                            border: '1px solid color-mix(in srgb, var(--primary) 40%, transparent)',
                            fontSize: 'var(--fs-rate)',
                            letterSpacing: 'var(--ls-uppercase)',
                          }}
                        >
                          Pending change
                        </span>
                        <button
                          type="button"
                          className="cursor-pointer underline"
                          style={{
                            color: 'var(--text-muted)',
                            fontSize: 'var(--fs-rate)',
                          }}
                          onClick={() =>
                            setPendingChanges((prev) => {
                              const { [txn.id]: _cleared, ...rest } = prev;
                              return rest;
                            })
                          }
                        >
                          Revert to suggestion
                        </button>
                      </div>
                    )}
                    <CategoryPicker
                      value={effectiveCategoryId}
                      onChange={(id) => {
                        if (id) handlePickCategory(txn, id);
                      }}
                      type={txn.type === 'income' ? 'income' : 'expense'}
                      allowNull={false}
                      placeholder={hasPending ? 'Select category... (pending)' : 'Select category...'}
                    />
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <BudgetEventPicker
                          value={effectiveEventId}
                          onChange={(id) => handlePickEvent(txn, id)}
                          disabled={txn.type === 'expense' && !txn.isBudgeted}
                          placeholder={hasPendingEvent ? 'No event (pending)' : 'No event'}
                        />
                      </div>
                      {txn.type === 'expense' && (
                        <label
                          className="inline-flex items-center gap-2 cursor-pointer select-none shrink-0"
                          style={{
                            color: 'var(--text-secondary)',
                            fontSize: 'var(--fs-body-sm)',
                          }}
                          title="Uncheck to exclude this expense from monthly budget totals (e.g. one-off annual costs like yearly taxes)."
                        >
                          <input
                            type="checkbox"
                            checked={txn.isBudgeted}
                            disabled={budgetingId === txn.id}
                            onChange={(e) =>
                              handleToggleBudgeted(txn, e.target.checked)
                            }
                            className="cursor-pointer"
                          />
                          Budgeted
                        </label>
                      )}
                    </div>
                  </div>

                  {/* ── Right rail: actions. The single-row Confirm is
                      PRIMARY: it's the safe default, while "for all"
                      rewrites every matching row in the workspace - the
                      bulk action shouldn't be the biggest click target. */}
                  <div className="flex flex-row lg:flex-col gap-2 shrink-0 lg:w-44 lg:justify-center">
                    <Button
                      variant="primary"
                      className="w-full justify-center"
                      disabled={!effectiveCategoryId || isProcessing}
                      onClick={() => handleConfirm(txn)}
                      title="Apply the category to THIS transaction only. Future bank imports of the same merchant will auto-match, but other existing matching rows stay in the queue."
                    >
                      <Check size={16} />
                      Confirm
                    </Button>
                    <Button
                      variant="secondary"
                      className="w-full justify-center"
                      disabled={!effectiveCategoryId || isProcessing}
                      onClick={() => handleConfirmForAll(txn)}
                      title="Apply the category to this transaction AND every other transaction with the same merchant name."
                    >
                      <CheckCheck size={16} />
                      Confirm for all
                    </Button>
                  </div>
                </div>

                {/* ── Recurring capture strip ─────────────────────── */}
                {txn.type === 'expense' &&
                  (() => {
                    const rBusy = recurringBusy === txn.id;
                    if (txn.recurringSeriesId) {
                      return (
                        <div
                          className="mt-3 pt-3 flex items-center gap-2 flex-wrap"
                          style={{ borderTop: '1px solid var(--border)' }}
                        >
                          <RecurringBadge />
                          <span
                            style={{
                              color: 'var(--text-muted)',
                              fontSize: 'var(--fs-body-sm)',
                            }}
                          >
                            Tracked as a recurring expense.
                          </span>
                          <Button
                            variant="ghost"
                            disabled={rBusy}
                            onClick={() => handleUnflagRecurring(txn)}
                          >
                            Not recurring
                          </Button>
                        </div>
                      );
                    }
                    const sug = recurringSuggestions.get(txn.id);
                    if (sug) {
                      const sep = settings.decimalSeparator;
                      const msg = sug.amountJumped
                        ? `Amount changed ${formatAmount(sug.expectedAmount ?? '0', sep)} → ${formatAmount(sug.newAmount, sep)} ${sug.currency} - still the same plan?`
                        : sug.reason === 'ambiguous-multiple-series'
                          ? `Could be your recurring "${sug.displayName}" - link it?`
                          : `Looks like your ${sug.cadence} ${sug.displayName} - recurring?`;
                      return (
                        <div
                          className="mt-3 pt-3 flex items-center gap-2 flex-wrap"
                          style={{ borderTop: '1px solid var(--border)' }}
                        >
                          <Repeat2
                            size={14}
                            aria-hidden
                            style={{ color: 'var(--viz-3, #7c3aed)' }}
                          />
                          <PrivacyField
                            style={{
                              color: 'var(--text)',
                              fontSize: 'var(--fs-body-sm)',
                            }}
                          >
                            {msg}
                          </PrivacyField>
                          <Button
                            variant="secondary"
                            disabled={rBusy}
                            onClick={() => handleConfirmRecurring(txn)}
                          >
                            {sug.amountJumped ? 'Yes, keep' : 'Confirm recurring'}
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={rBusy}
                            onClick={() => handleDismissRecurring(txn)}
                          >
                            Not recurring
                          </Button>
                        </div>
                      );
                    }
                    // No engine suggestion: the manual controls hide behind
                    // a small link instead of rendering a select + button on
                    // every single card in the queue.
                    if (!recurringFormFor.has(txn.id)) {
                      return (
                        <div className="mt-2 flex justify-start">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 cursor-pointer hover:underline"
                            style={{
                              color: 'var(--text-muted)',
                              fontSize: 'var(--fs-rate)',
                            }}
                            onClick={() =>
                              setRecurringFormFor(
                                (prev) => new Set(prev).add(txn.id),
                              )
                            }
                          >
                            <Repeat2 size={12} />
                            Mark as recurring…
                          </button>
                        </div>
                      );
                    }
                    return (
                      <div
                        className="mt-3 pt-3 flex items-center gap-2 flex-wrap"
                        style={{ borderTop: '1px solid var(--border)' }}
                      >
                        <span
                          style={{
                            color: 'var(--text-muted)',
                            fontSize: 'var(--fs-body-sm)',
                          }}
                        >
                          Repeats
                        </span>
                        <select
                          value={cadenceFor(txn.id)}
                          onChange={(e) =>
                            setRecurringCadence((prev) => ({
                              ...prev,
                              [txn.id]: e.target.value as RecurrenceCadence,
                            }))
                          }
                          className="kk-select"
                          style={{
                            fontSize: 'var(--fs-body-sm)',
                            padding: '2px 6px',
                            borderRadius: 6,
                            border: '1px solid var(--border)',
                            background: 'var(--surface)',
                            color: 'var(--text)',
                          }}
                        >
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                          <option value="yearly">Yearly</option>
                        </select>
                        <Button
                          variant="ghost"
                          disabled={rBusy}
                          onClick={() => handleFlagRecurring(txn)}
                        >
                          <Repeat2 size={14} />
                          Mark recurring
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={rBusy}
                          onClick={() =>
                            setRecurringFormFor((prev) => {
                              const next = new Set(prev);
                              next.delete(txn.id);
                              return next;
                            })
                          }
                        >
                          Cancel
                        </Button>
                      </div>
                    );
                  })()}
              </Card>
            );
          })}
        </div>
      )}

      {(() => {
        const checkedExpenseIds = queueExpenses
          .filter((e) => wizardExpenseSelection[e.id]?.checked)
          .map((e) => e.id);
        const singleExpenseSelected = checkedExpenseIds.length === 1;
        const selectedIncomeCount = wizardIncomeSelection.size;
        const confirmDisabled =
          wizardSubmitting || checkedExpenseIds.length === 0;

        return (
          <Modal
            open={splitWizardOpen}
            onClose={closeSplitWizard}
            size="xl"
            title="Flag & link split expenses"
          >
            <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
              Pick an expense to flag as a split (and assign its category),
              then optionally pick the reimbursement incomes that pay it
              back. Everything you touch leaves the review queue.
            </p>

            {/* ── Two-column layout: expenses | reimbursements ───────── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              {/* ── Section 1 - Parent expenses ─────────────────────── */}
              <div className="flex flex-col min-h-0">
                <p
                  className="uppercase mb-2"
                  style={UPPERCASE_LABEL}
                >
                  1. Parent expense(s)
                </p>
                {queueExpenses.length === 0 ? (
                  <div
                    className="rounded-lg flex items-center justify-center"
                    style={{
                      border: '1px solid var(--border)',
                      height: 420,
                      color: 'var(--text-muted)',
                      fontSize: 'var(--fs-body-sm)',
                    }}
                  >
                    No expenses waiting.
                  </div>
                ) : (
                  <div
                    className="rounded-lg overflow-y-auto"
                    style={{
                      border: '1px solid var(--border)',
                      height: 420,
                    }}
                  >
                    {queueExpenses.map((e, idx) => {
                      const sel = wizardExpenseSelection[e.id];
                      const checked = sel?.checked ?? false;
                      const isAlreadySplit = e.splitStatus != null;
                      const merchant =
                        e.merchantRaw ?? e.note ?? '(no merchant)';
                      const isLast = idx === queueExpenses.length - 1;
                      return (
                        <div
                          key={e.id}
                          className="flex flex-col gap-2 p-3"
                          style={{
                            borderBottom: isLast
                              ? 'none'
                              : '1px solid var(--border)',
                            backgroundColor: checked
                              ? 'color-mix(in srgb, var(--primary) 6%, transparent)'
                              : 'transparent',
                          }}
                        >
                          <div className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleWizardExpense(e.id)}
                              className="mt-1 cursor-pointer shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5 min-w-0">
                                <span
                                  className="truncate"
                                  style={{
                                    color: 'var(--text)',
                                    fontSize: 'var(--fs-body)',
                                    fontWeight: 'var(--fw-medium)',
                                  }}
                                  title={merchant}
                                >
                                  {merchant}
                                </span>
                                {isAlreadySplit && (
                                  <span
                                    className="px-1.5 py-0.5 rounded shrink-0"
                                    style={{
                                      backgroundColor:
                                        'color-mix(in srgb, var(--primary) 15%, transparent)',
                                      color: 'var(--primary)',
                                      fontSize: 'var(--fs-rate)',
                                      letterSpacing: 'var(--ls-uppercase)',
                                    }}
                                  >
                                    ALREADY SPLIT
                                  </span>
                                )}
                              </div>
                              <div
                                className="flex items-center gap-2 flex-wrap"
                                style={{
                                  color: 'var(--text-muted)',
                                  fontSize: 'var(--fs-body-sm)',
                                }}
                              >
                                <span>{formatDate(e.date)}</span>
                                {e.account && (
                                  <span className="inline-flex items-center gap-1.5 truncate max-w-[120px]">
                                    <span
                                      className="w-2 h-2 rounded-full shrink-0"
                                      style={{ backgroundColor: e.account.color }}
                                    />
                                    <span className="truncate">{e.account.name}</span>
                                  </span>
                                )}
                                <span
                                  className="amount amount-sm"
                                  style={{ color: 'var(--expense)' }}
                                  data-privacy-field
                                >
                                  -{formatAmount(e.amount, settings.decimalSeparator)}
                                </span>
                                <span className="currency-code">{e.currency}</span>
                              </div>
                            </div>
                          </div>
                          {/* CategoryPicker stacks below - columns are too
                              narrow to fit it inline next to the metadata. */}
                          {checked && (
                            <div className="pl-7">
                              <CategoryPicker
                                value={sel?.categoryId ?? null}
                                onChange={(id) =>
                                  setWizardExpenseCategory(e.id, id)
                                }
                                type="expense"
                                allowNull
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ── Section 2 - Reimbursements ──────────────────────── */}
              <div className="flex flex-col min-h-0">
                <p
                  className="uppercase mb-2"
                  style={UPPERCASE_LABEL}
                >
                  2. Reimbursements
                  <span
                    className="ml-1 normal-case"
                    style={{
                      color: 'var(--text-muted)',
                      fontWeight: 'var(--fw-regular)',
                      letterSpacing: 'normal',
                    }}
                  >
                    (optional)
                  </span>
                </p>

                {!singleExpenseSelected ? (
                  <div
                    className="rounded-lg flex items-center justify-center text-center px-4"
                    style={{
                      border: '1px solid var(--border)',
                      height: 420,
                      color: 'var(--text-muted)',
                      fontSize: 'var(--fs-body-sm)',
                    }}
                  >
                    {checkedExpenseIds.length === 0
                      ? 'Pick one expense on the left to link reimbursements.'
                      : 'Linking reimbursements is only available when a single expense is selected on the left. Uncheck the others; you can run this wizard again for them.'}
                  </div>
                ) : queueIncomes.length === 0 ? (
                  <div
                    className="rounded-lg flex items-center justify-center text-center px-4"
                    style={{
                      border: '1px solid var(--border)',
                      height: 420,
                      color: 'var(--text-muted)',
                      fontSize: 'var(--fs-body-sm)',
                    }}
                  >
                    No income rows waiting in the review queue. You can still
                    flag the expense as a split; repayments can be added
                    later from the split detail page.
                  </div>
                ) : (
                  <div
                    className="rounded-lg overflow-y-auto"
                    style={{
                      border: '1px solid var(--border)',
                      height: 420,
                    }}
                  >
                    {queueIncomes.map((inc, idx) => {
                      const checked = wizardIncomeSelection.has(inc.id);
                      const note = inc.merchantRaw ?? inc.note ?? '(no note)';
                      const isLast = idx === queueIncomes.length - 1;
                      return (
                        <div
                          key={inc.id}
                          className="flex items-start gap-3 p-3"
                          style={{
                            borderBottom: isLast
                              ? 'none'
                              : '1px solid var(--border)',
                            backgroundColor: checked
                              ? 'color-mix(in srgb, var(--income) 8%, transparent)'
                              : 'transparent',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleWizardIncome(inc.id)}
                            className="mt-1 cursor-pointer shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <p
                              className="truncate mb-0.5"
                              style={{
                                color: 'var(--text)',
                                fontSize: 'var(--fs-body)',
                                fontWeight: 'var(--fw-medium)',
                              }}
                              title={note}
                            >
                              {note}
                            </p>
                            <div
                              className="flex items-center gap-2 flex-wrap"
                              style={{
                                color: 'var(--text-muted)',
                                fontSize: 'var(--fs-body-sm)',
                              }}
                            >
                              <span>{formatDate(inc.date)}</span>
                              {inc.account && (
                                <span className="inline-flex items-center gap-1.5 truncate max-w-[120px]">
                                  <span
                                    className="w-2 h-2 rounded-full shrink-0"
                                    style={{ backgroundColor: inc.account.color }}
                                  />
                                  <span className="truncate">{inc.account.name}</span>
                                </span>
                              )}
                              <span
                                className="amount amount-sm"
                                style={{ color: 'var(--income)' }}
                                data-privacy-field
                              >
                                +{formatAmount(inc.amount, settings.decimalSeparator)}
                              </span>
                              <span className="currency-code">{inc.currency}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {singleExpenseSelected && queueIncomes.length > 0 && (
                  <p
                    className="mt-2"
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: 'var(--fs-rate)',
                      fontStyle: 'italic',
                    }}
                  >
                    These incomes will be re-labelled as repayments.
                    Balances aren't touched; the money already landed at
                    import.
                  </p>
                )}
              </div>
            </div>

            {wizardError && (
              <p
                className="mb-3 text-sm"
                style={{ color: 'var(--danger)' }}
              >
                {wizardError}
              </p>
            )}

            {/* ── Footer ────────────────────────────────────────────── */}
            <div className="flex items-center justify-between">
              <p
                style={{
                  color: 'var(--text-muted)',
                  fontSize: 'var(--fs-body-sm)',
                }}
              >
                {checkedExpenseIds.length === 0
                  ? 'Nothing selected'
                  : `Flag ${checkedExpenseIds.length} expense${checkedExpenseIds.length !== 1 ? 's' : ''}${
                      selectedIncomeCount > 0 && singleExpenseSelected
                        ? ` · link ${selectedIncomeCount} repayment${selectedIncomeCount !== 1 ? 's' : ''}`
                        : ''
                    }`}
              </p>
              <div className="flex gap-3">
                <Button
                  variant="ghost"
                  onClick={closeSplitWizard}
                  disabled={wizardSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  disabled={confirmDisabled}
                  onClick={handleConfirmSplitWizard}
                >
                  {wizardSubmitting ? 'Saving...' : 'Confirm'}
                </Button>
              </div>
            </div>
          </Modal>
        );
      })()}

      <Modal
        open={recleanConfirmOpen}
        onClose={() => setRecleanConfirmOpen(false)}
        title="Re-clean import notes"
      >
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          Re-runs the import-description cleaner over every bank-imported
          transaction whose note still matches the bank's raw remittance text.
          Manually edited notes are left alone. Rows imported before this
          update have no stored raw text and can only be refreshed by
          "Re-pull everything from scratch" in Settings.
        </p>
        <div className="flex justify-end gap-3">
          <Button
            variant="ghost"
            onClick={() => setRecleanConfirmOpen(false)}
            disabled={recleaning}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleRecleanNotes}
            disabled={recleaning}
          >
            {recleaning ? 'Cleaning...' : 'Re-clean notes'}
          </Button>
        </div>
      </Modal>

      <Modal
        open={recategorizeConfirmOpen}
        onClose={() => setRecategorizeConfirmOpen(false)}
        title="Re-categorize all"
      >
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          Re-runs categorization on every bank-imported transaction that you
          haven't manually confirmed or corrected. Backfills missing merchant
          names first, then re-applies the rule cascade so newer rules can
          take effect on older rows. User-confirmed categories are preserved.
        </p>
        <div className="flex justify-end gap-3">
          <Button
            variant="ghost"
            onClick={() => setRecategorizeConfirmOpen(false)}
            disabled={recategorizing}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleRecategorizeAll}
            disabled={recategorizing}
          >
            {recategorizing ? 'Re-categorizing...' : 'Re-categorize all'}
          </Button>
        </div>
      </Modal>

      <Modal
        open={uncategorizeConfirmOpen}
        onClose={() => setUncategorizeConfirmOpen(false)}
        title="Uncategorize from a date"
      >
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          Clears the category on every bank-imported transaction dated on or
          after the date below and puts them back in this review queue, so you
          can re-confirm them. Earlier transactions and manual transactions are
          left untouched.
        </p>
        <div className="mb-4">
          <Input
            label="Uncategorize from"
            type="date"
            value={uncategorizeFromDate}
            onChange={(e) => setUncategorizeFromDate(e.target.value)}
            disabled={uncategorizing}
          />
        </div>
        <div className="flex justify-end gap-3">
          <Button
            variant="ghost"
            onClick={() => setUncategorizeConfirmOpen(false)}
            disabled={uncategorizing}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleUncategorizeAll}
            disabled={uncategorizing || !uncategorizeFromDate}
          >
            {uncategorizing ? 'Resetting...' : 'Uncategorize'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
