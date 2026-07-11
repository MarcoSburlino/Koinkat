import { formatFullDate as formatDate } from '../lib/date-format';
import { monthFilterOptions } from '../lib/date-constants';
import { UPPERCASE_LABEL } from '../lib/label-styles';
import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus,
  ArrowLeftRight,
  Trash2,
  Pencil,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  Clock,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { RecurringBadge } from '../components/ui/RecurringBadge';
import { PrivacyField } from '../components/ui/PrivacyField';
import { PageHeader } from '../components/layout/PageHeader';
import { useAppStore } from '../stores/app-store';
import { formatAmount, formatMoney } from '../lib/format';
import { dec } from '../domain/money';
import * as transactionService from '../services/transaction-service';
import * as accountService from '../services/account-service';
import * as categoryService from '../services/category-service';
import { availableYears } from '../services/reporting-service';
import {
  findCandidateTransfers,
  confirmTransferPair,
  dismissTransferPair,
  unpairTransfer,
} from '../services/transfer-detection-service';
import type { TransferCandidate } from '../services/transfer-detection-service';
import type { Account, Category, Transaction } from '../types/models';

const PER_PAGE = 20;

const MONTH_OPTIONS = monthFilterOptions({ value: '', label: 'All months' });

const TYPE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'income_expense', label: 'Income & Expense' },
];

const SORT_OPTIONS = [
  { value: 'date-desc', label: 'Date (newest)' },
  { value: 'date-asc', label: 'Date (oldest)' },
  { value: 'amount-desc', label: 'Amount (highest)' },
  { value: 'amount-asc', label: 'Amount (lowest)' },
];

const SPLIT_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'all', label: 'Split expenses' },
  { value: 'open', label: 'Open splits' },
];

const RECURRING_OPTIONS = [
  { value: '', label: 'All' },
  { value: '1', label: 'Recurring only' },
];

function parseSort(value: string): { sortBy: 'date' | 'amount'; sortDir: 'asc' | 'desc' } {
  const [sortBy, sortDir] = value.split('-') as [string, string];
  return {
    sortBy: sortBy === 'amount' ? 'amount' : 'date',
    sortDir: sortDir === 'asc' ? 'asc' : 'desc',
  };
}

type TypeChipVariant = 'income' | 'expense' | 'transfer';

function TypeChip({ type, paired = false }: { type: TypeChipVariant; paired?: boolean }) {
  // Semantic chip backgrounds derived from the --income/--expense/--transfer
  // tokens via color-mix, so the tint follows the active theme and stays in
  // sync with the design system's money colors.
  //
  // `paired` is set when the row is part of a confirmed transfer pair -
  // the underlying type is still income/expense for storage but the
  // semantics are "transfer", so we render the transfer chip instead.
  const effectiveType: TypeChipVariant = paired ? 'transfer' : type;
  const tintVar: Record<TypeChipVariant, string> = {
    income: 'var(--income)',
    expense: 'var(--expense)',
    transfer: 'var(--transfer)',
  };
  const tint = tintVar[effectiveType];
  const label = paired ? 'transfer' : type;

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full font-medium capitalize"
      style={{
        backgroundColor: `color-mix(in srgb, ${tint} 15%, transparent)`,
        color: tint,
        fontSize: 'var(--fs-rate)',
        letterSpacing: 'var(--ls-uppercase)',
      }}
    >
      {label}
    </span>
  );
}

/**
 * Bank-pending indicator. Visually + textually distinct from Review's
 * "pending category change" wording - a clock icon + "Pending" on a
 * warning tint, meaning "awaiting bank confirmation", not "needs review".
 */
function PendingChip() {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--warning) 15%, transparent)',
        color: 'var(--warning)',
        fontSize: 'var(--fs-rate)',
        letterSpacing: 'var(--ls-uppercase)',
      }}
      title="Awaiting bank confirmation"
    >
      <Clock size={11} aria-hidden />
      Pending
    </span>
  );
}

function SplitBadge({ txnId }: { txnId: string }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigate(`/transactions/${txnId}/split`);
      }}
      className="inline-flex items-center px-2 py-0.5 rounded-full font-medium cursor-pointer hover:opacity-80 transition-opacity"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--primary) 15%, transparent)',
        color: 'var(--primary)',
        fontSize: 'var(--fs-rate)',
        letterSpacing: 'var(--ls-uppercase)',
      }}
      title="View split detail"
    >
      Split
    </button>
  );
}

function RepaymentBadge({ parentId }: { parentId?: string }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (parentId) navigate(`/transactions/${parentId}/split`);
      }}
      disabled={!parentId}
      className="inline-flex items-center px-2 py-0.5 rounded-full font-medium cursor-pointer hover:opacity-80 transition-opacity"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--income) 12%, transparent)',
        color: 'var(--income)',
        fontSize: 'var(--fs-rate)',
        letterSpacing: 'var(--ls-uppercase)',
      }}
      title={parentId ? 'Open parent split' : 'Orphan repayment'}
    >
      Repayment
    </button>
  );
}

function AccountDot({ color, name }: { color: string; name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="w-2 h-2 rounded-full shrink-0 inline-block"
        style={{ backgroundColor: color }}
      />
      <span>{name}</span>
    </span>
  );
}

export function TransactionList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  // Last confirmed pair, kept around so a misclick on Confirm (which sits
  // right next to Dismiss and permanently excludes both rows from every
  // aggregation) has an immediate Undo.
  const [lastConfirmedPair, setLastConfirmedPair] = useState<string | null>(null);
  const [undoingPair, setUndoingPair] = useState(false);

  // Transfer-detection state - populated on mount, refreshed after the
  // user confirms or dismisses a candidate, and after the underlying
  // transaction list changes (which may have surfaced new pairs).
  const [candidates, setCandidates] = useState<TransferCandidate[]>([]);
  const [bannerExpanded, setBannerExpanded] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const settings = useAppStore((s) => s.settings);

  // Read filters from URL search params
  // Support both ?accountId= (filter select) and ?account= (Dashboard deep-link).
  const accountId = searchParams.get('accountId') ?? searchParams.get('account') ?? '';
  const type = searchParams.get('type') ?? '';
  const month = searchParams.get('month') ?? '';
  // `year` makes prior years reachable (the Month filter alone was silently
  // pinned to the current calendar year - in January, picking "December"
  // showed the empty new year, and historical URLs broke at the boundary).
  const yearParam = searchParams.get('year') ?? '';
  const categoryFilter = searchParams.get('category') ?? '';
  const sort = searchParams.get('sort') ?? 'date-desc';
  const page = parseInt(searchParams.get('page') ?? '1', 10) || 1;
  // `splits` filter param: '' = all, 'all' = every split parent (open or
  // settled), 'open' = only open split parents (the Dashboard "View"
  // deep-link on the open-splits callout uses 'open').
  const splitFilter = searchParams.get('splits') ?? '';
  const openSplitsOnly = splitFilter === 'open';
  const splitsOnly = splitFilter === 'all';
  // `recurring=1` shows only rows linked to a recurring series.
  const recurringOnly = searchParams.get('recurring') === '1';

  // Show add-transaction buttons only where manual entry makes sense.
  // - Loading (accounts not yet fetched): optimistic show to avoid flash.
  // - Specific account selected: show only if that account is manual.
  // - No filter: show only if the workspace has at least one manual account.
  const selectedAccount = accountId
    ? accounts.find((a) => a.id === accountId)
    : null;
  const showAddButtons =
    accounts.length === 0 ||
    (selectedAccount != null
      ? selectedAccount.isManual
      : accounts.some((a) => a.isManual));

  const currentYear = new Date().getFullYear();
  const selectedYear =
    yearParam && !Number.isNaN(parseInt(yearParam, 10))
      ? parseInt(yearParam, 10)
      : currentYear;

  // Years offered by the Year filter - every year with data, plus the
  // current one.
  const [years, setYears] = useState<number[]>([currentYear]);
  useEffect(() => {
    availableYears()
      .then((yrs) => {
        setYears(yrs.includes(currentYear) ? yrs : [...yrs, currentYear].sort((a, b) => b - a));
      })
      .catch(() => setYears([currentYear]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update a single filter param and reset page to 1
  const setFilter = useCallback(
    (key: string, value: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (value) {
          next.set(key, value);
        } else {
          next.delete(key);
        }
        // Reset page to 1 when any filter changes (unless we're changing the page itself)
        if (key !== 'page') {
          next.delete('page');
        }
        return next;
      });
    },
    [setSearchParams],
  );

  const setPage = useCallback(
    (p: number) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (p > 1) {
          next.set('page', String(p));
        } else {
          next.delete('page');
        }
        return next;
      });
    },
    [setSearchParams],
  );

  // Load accounts and categories on mount
  useEffect(() => {
    async function loadMeta() {
      const [accts, cats] = await Promise.all([
        accountService.listAccounts(),
        categoryService.listCategories(),
      ]);
      setAccounts(accts);
      setCategories(cats);
    }
    loadMeta();
  }, []);

  // Load transfer-pair candidates on mount and whenever the underlying
  // transactions change (a confirm/dismiss/delete may have surfaced new
  // pairs or removed others).
  const refreshCandidates = useCallback(async () => {
    try {
      const found = await findCandidateTransfers(settings.preferredCurrency);
      setCandidates(found);
    } catch (err) {
      console.warn('Failed to detect transfer candidates:', err);
      setCandidates([]);
    }
  }, [settings.preferredCurrency]);

  useEffect(() => {
    refreshCandidates();
  }, [refreshCandidates]);

  async function handleConfirmCandidate(c: TransferCandidate) {
    setReviewingId(c.outflow.id);
    setCandidateError(null);
    try {
      const pairId = await confirmTransferPair(c.outflow.id, c.inflow.id);
      setLastConfirmedPair(pairId);
      await refreshCandidates();
      // Also reload the visible page so the rows pick up their new
      // `transferPairId` and re-render with the Transfer chip.
      await reloadCurrentPage();
    } catch (err) {
      setCandidateError(
        err instanceof Error ? err.message : 'Failed to confirm transfer pair',
      );
    } finally {
      setReviewingId(null);
    }
  }

  async function handleUndoConfirm() {
    if (!lastConfirmedPair || undoingPair) return;
    setUndoingPair(true);
    setCandidateError(null);
    try {
      await unpairTransfer(lastConfirmedPair);
      setLastConfirmedPair(null);
      await refreshCandidates();
      await reloadCurrentPage();
    } catch (err) {
      setCandidateError(
        err instanceof Error ? err.message : 'Failed to undo the transfer pair',
      );
    } finally {
      setUndoingPair(false);
    }
  }

  async function handleDismissCandidate(c: TransferCandidate) {
    setReviewingId(c.outflow.id);
    setCandidateError(null);
    try {
      await dismissTransferPair(c.outflow.id, c.inflow.id);
      await refreshCandidates();
    } catch (err) {
      setCandidateError(
        err instanceof Error ? err.message : 'Failed to dismiss transfer pair',
      );
    } finally {
      setReviewingId(null);
    }
  }

  // Single source of truth for the URL-driven filter set - used by both
  // the fetch effect and reloadCurrentPage so the two can't drift.
  const buildFilters = useCallback((): transactionService.ListTransactionsFilters => {
    const { sortBy, sortDir } = parseSort(sort);
    const filters: transactionService.ListTransactionsFilters = {
      page,
      perPage: PER_PAGE,
      sortBy,
      sortDir,
    };
    if (accountId) filters.accountId = accountId;
    if (type === 'income' || type === 'expense' || type === 'transfer') {
      filters.type = type;
    } else if (type === 'income_expense') {
      filters.type = 'income_expense';
    }
    if (month) {
      filters.month = parseInt(month, 10);
      filters.year = selectedYear;
    } else if (yearParam) {
      filters.year = selectedYear;
    }
    if (categoryFilter === 'uncategorized') {
      filters.uncategorized = true;
    } else if (categoryFilter) {
      filters.categoryId = categoryFilter;
    }
    if (openSplitsOnly) filters.openSplitsOnly = true;
    if (splitsOnly) filters.splitsOnly = true;
    if (recurringOnly) filters.recurring = true;
    return filters;
  }, [accountId, type, month, yearParam, categoryFilter, sort, page, selectedYear, openSplitsOnly, splitsOnly, recurringOnly]);

  // Helper used by handleDelete and handleConfirmCandidate to refresh the
  // visible page with the same filter state.
  const reloadCurrentPage = useCallback(async () => {
    const result = await transactionService.listTransactions(buildFilters());
    setTransactions(result.transactions);
    setTotal(result.total);
    setTotalPages(result.totalPages);
    setCurrentPage(result.page);
  }, [buildFilters]);

  // Fetch transactions whenever filters change
  useEffect(() => {
    let cancelled = false;

    async function fetchTransactions() {
      setLoading(true);
      try {
        const result = await transactionService.listTransactions(buildFilters());
        if (!cancelled) {
          setTransactions(result.transactions);
          setTotal(result.total);
          setTotalPages(result.totalPages);
          setCurrentPage(result.page);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchTransactions();
    return () => {
      cancelled = true;
    };
  }, [buildFilters]);

  async function handleDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await transactionService.deleteTransaction(deleteTarget.id);
      setDeleteTarget(null);
      await reloadCurrentPage();
      await refreshCandidates();
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Failed to delete transaction',
      );
    } finally {
      setDeleting(false);
    }
  }

  // Split transactions into income/expense vs transfers
  const incomeExpense = transactions.filter((t) => t.type === 'income' || t.type === 'expense');
  const transfers = transactions.filter((t) => t.type === 'transfer');

  // Build dropdown options
  const accountOptions = [
    { value: '', label: 'All accounts' },
    ...accounts.map((a) => ({ value: a.id, label: a.name })),
  ];

  // Group categories for the dropdown: macros first, subcategories
  // indented underneath. Uncategorized gets a synthetic first option.
  const categoryOptions: { value: string; label: string }[] = [
    { value: '', label: 'All categories' },
    { value: 'uncategorized', label: 'Uncategorized' },
  ];
  const macros = categories.filter((c) => c.parentId === null);
  for (const macro of macros) {
    categoryOptions.push({ value: macro.id, label: macro.name });
    const children = categories.filter((c) => c.parentId === macro.id);
    for (const child of children) {
      categoryOptions.push({
        value: child.id,
        label: `  ↳ ${child.name}`,
      });
    }
  }

  return (
    <div>
      <PageHeader
        serif
        label="Overview"
        title="Transactions"
        subtitle="Browse, search and edit every movement across your accounts."
        right={
          showAddButtons ? (
            <>
              <Link to="/transactions/create">
                <Button variant="primary">
                  <Plus size={16} />
                  Income/Expense
                </Button>
              </Link>
              <Link to="/transactions/transfer">
                <Button variant="secondary">
                  <ArrowLeftRight size={16} />
                  Transfer
                </Button>
              </Link>
              <Link to="/transactions/create?split=1">
                <Button variant="ghost">
                  <Plus size={16} />
                  Split expense
                </Button>
              </Link>
            </>
          ) : undefined
        }
      />

      {/* Open-splits filter chip. Shown when &splits=open is in the URL
          (e.g. after clicking "View" on the Dashboard open-splits callout
          or the Split expense fast-action below). */}
      {openSplitsOnly && (
        <div
          className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg"
          style={{
            backgroundColor:
              'color-mix(in srgb, var(--primary) 12%, var(--surface))',
            border:
              '1px solid color-mix(in srgb, var(--primary) 30%, var(--border))',
          }}
        >
          <span
            style={{
              color: 'var(--text)',
              fontSize: 'var(--fs-body-sm)',
              fontWeight: 'var(--fw-medium)',
            }}
          >
            Showing open split expenses only
          </span>
          <button
            type="button"
            onClick={() => setFilter('splits', '')}
            className="ml-auto text-xs cursor-pointer underline"
            style={{ color: 'var(--primary)' }}
          >
            Clear filter
          </button>
        </div>
      )}

      {/* Transfer-pair detection banner. Surfaces matched outflow/inflow
          pairs so the user can confirm they're a transfer (excluded from
          income/expense aggregations) or dismiss them (kept as separate). */}
      {candidates.length > 0 && (
        <div
          className="mb-6 rounded-lg overflow-hidden"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--warning) 12%, var(--surface))',
            border: '1px solid color-mix(in srgb, var(--warning) 35%, var(--border))',
            borderRadius: 'var(--radius-2)',
          }}
        >
          <button
            type="button"
            onClick={() => setBannerExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <AlertTriangle
                size={18}
                style={{ color: 'var(--warning)' }}
              />
              <div className="text-left">
                <p
                  style={{
                    color: 'var(--text)',
                    fontSize: 'var(--fs-body)',
                    fontWeight: 'var(--fw-semibold)',
                  }}
                >
                  {candidates.length} possible transfer
                  {candidates.length !== 1 ? 's' : ''} detected
                </p>
                <p
                  style={{
                    color: 'var(--text-secondary)',
                    fontSize: 'var(--fs-body-sm)',
                  }}
                >
                  Outflows on one account that match inflows on another.
                  Confirmed transfers are excluded from income/expense totals.
                </p>
              </div>
            </div>
            {bannerExpanded ? (
              <ChevronUp size={18} style={{ color: 'var(--text-secondary)' }} />
            ) : (
              <ChevronDown size={18} style={{ color: 'var(--text-secondary)' }} />
            )}
          </button>

          {bannerExpanded && (
            <div
              className="flex flex-col"
              style={{ borderTop: '1px solid color-mix(in srgb, var(--warning) 25%, var(--border))' }}
            >
              {candidates.map((c) => (
                <div
                  key={`${c.outflow.id}-${c.inflow.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                  style={{
                    borderBottom: '1px solid color-mix(in srgb, var(--warning) 18%, var(--border))',
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div
                      className="flex items-center gap-2 flex-wrap"
                      style={{ fontSize: 'var(--fs-body-sm)' }}
                    >
                      {/* Outflow side */}
                      <span
                        className="inline-flex items-center gap-1.5"
                        style={{ color: 'var(--text)' }}
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: c.outflow.accountColor }}
                        />
                        <span style={{ fontWeight: 'var(--fw-medium)' }}>
                          {c.outflow.accountName}
                        </span>
                        <span
                          className="amount"
                          style={{
                            color: 'var(--expense)',
                            fontSize: 'var(--fs-body-sm)',
                          }}
                          data-privacy-field
                        >
                          −{formatAmount(c.outflow.amount, settings.decimalSeparator)}
                        </span>
                        <span className="currency-code">{c.outflow.currency}</span>
                        <span
                          style={{
                            color: 'var(--text-muted)',
                            fontSize: 'var(--fs-rate)',
                          }}
                        >
                          {formatDate(c.outflow.date)}
                        </span>
                      </span>

                      <ArrowLeftRight
                        size={14}
                        style={{ color: 'var(--text-muted)' }}
                      />

                      {/* Inflow side */}
                      <span
                        className="inline-flex items-center gap-1.5"
                        style={{ color: 'var(--text)' }}
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: c.inflow.accountColor }}
                        />
                        <span style={{ fontWeight: 'var(--fw-medium)' }}>
                          {c.inflow.accountName}
                        </span>
                        <span
                          className="amount"
                          style={{
                            color: 'var(--income)',
                            fontSize: 'var(--fs-body-sm)',
                          }}
                          data-privacy-field
                        >
                          +{formatAmount(c.inflow.amount, settings.decimalSeparator)}
                        </span>
                        <span className="currency-code">{c.inflow.currency}</span>
                        <span
                          style={{
                            color: 'var(--text-muted)',
                            fontSize: 'var(--fs-rate)',
                          }}
                        >
                          {formatDate(c.inflow.date)}
                        </span>
                      </span>
                    </div>
                    <PrivacyField
                      as="p"
                      className="mt-1"
                      style={{
                        color: 'var(--text-muted)',
                        fontSize: 'var(--fs-rate)',
                      }}
                    >
                      Match score {(c.score * 100).toFixed(0)}% · {c.dayGap}-day gap
                      {dec(c.feeInPreferred).gt('0.005') &&
                        ` · ~${formatAmount(c.feeInPreferred, settings.decimalSeparator)} ${settings.preferredCurrency} fee`}
                      {c.isCrossCurrency && ' · cross-currency'}
                    </PrivacyField>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleConfirmCandidate(c)}
                      disabled={reviewingId === c.outflow.id}
                      className="inline-flex items-center gap-1.5 px-3 h-8 rounded cursor-pointer transition-opacity hover:opacity-85 disabled:opacity-50"
                      style={{
                        backgroundColor: 'color-mix(in srgb, var(--income) 15%, transparent)',
                        color: 'var(--income)',
                        border: '1px solid color-mix(in srgb, var(--income) 40%, transparent)',
                        fontSize: 'var(--fs-body-sm)',
                        fontWeight: 'var(--fw-medium)',
                      }}
                    >
                      <Check size={14} />
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDismissCandidate(c)}
                      disabled={reviewingId === c.outflow.id}
                      className="inline-flex items-center gap-1.5 px-3 h-8 rounded cursor-pointer transition-opacity hover:opacity-85 disabled:opacity-50"
                      style={{
                        backgroundColor: 'transparent',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border)',
                        fontSize: 'var(--fs-body-sm)',
                        fontWeight: 'var(--fw-medium)',
                      }}
                    >
                      <X size={14} />
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {candidateError && (
            <p
              className="px-4 pb-3"
              style={{ color: 'var(--danger)', fontSize: 'var(--fs-body-sm)' }}
            >
              {candidateError}
            </p>
          )}
        </div>
      )}

      {/* Undo line for the last confirmed transfer pair - confirming
          permanently excludes both rows from every aggregation, and the
          Confirm button sits one slip away from Dismiss. */}
      {lastConfirmedPair && (
        <div
          className="flex items-center justify-between gap-3 rounded-lg px-4 py-2.5 mb-6"
          style={{
            backgroundColor:
              'color-mix(in srgb, var(--income) 10%, var(--surface))',
            border:
              '1px solid color-mix(in srgb, var(--income) 30%, var(--border))',
          }}
        >
          <p style={{ color: 'var(--text)', fontSize: 'var(--fs-body-sm)' }}>
            Marked as a transfer - the two rows no longer count as income or
            expense.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="ghost" onClick={handleUndoConfirm} disabled={undoingPair}>
              {undoingPair ? 'Undoing...' : 'Undo'}
            </Button>
            <button
              onClick={() => setLastConfirmedPair(null)}
              className="cursor-pointer p-1 rounded"
              aria-label="Dismiss"
              style={{ color: 'var(--text-muted)' }}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <Card className="mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <Select
            label="Account"
            value={accountId}
            onChange={(e) => setFilter('accountId', e.target.value)}
            options={accountOptions}
          />
          <Select
            label="Type"
            value={type}
            onChange={(e) => setFilter('type', e.target.value)}
            options={TYPE_OPTIONS}
          />
          <Select
            label="Year"
            value={yearParam}
            onChange={(e) => setFilter('year', e.target.value)}
            options={[
              { value: '', label: month ? String(currentYear) : 'All years' },
              ...years.map((y) => ({ value: String(y), label: String(y) })),
            ]}
          />
          <Select
            label="Month"
            value={month}
            onChange={(e) => setFilter('month', e.target.value)}
            options={MONTH_OPTIONS}
          />
          <Select
            label="Category"
            value={categoryFilter}
            onChange={(e) => setFilter('category', e.target.value)}
            options={categoryOptions}
          />
          <Select
            label="Split"
            value={splitFilter}
            onChange={(e) => setFilter('splits', e.target.value)}
            options={SPLIT_OPTIONS}
          />
          <Select
            label="Recurring"
            value={recurringOnly ? '1' : ''}
            onChange={(e) => setFilter('recurring', e.target.value)}
            options={RECURRING_OPTIONS}
          />
          <Select
            label="Sort"
            value={sort}
            onChange={(e) => setFilter('sort', e.target.value)}
            options={SORT_OPTIONS}
          />
        </div>
      </Card>

      {/* Loading state - without it the area below the filters is blank,
          indistinguishable from "this filter matched nothing". */}
      {loading && transactions.length === 0 && (
        <Card>
          <p
            className="text-sm text-center py-12"
            style={{ color: 'var(--text-muted)' }}
          >
            Loading...
          </p>
        </Card>
      )}

      {/* Empty State - copy branches on whether the workspace can create
          transactions manually: telling a linked-only user to "create a new
          transaction" while hiding every create button is a dead end. */}
      {!loading && transactions.length === 0 && (
        <Card>
          <div className="text-center py-12">
            <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>
              No transactions found.
            </p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {showAddButtons
                ? 'Adjust your filters or create a new transaction to get started.'
                : 'Adjust your filters - or run a sync: transactions will appear after your next bank sync.'}
            </p>
          </div>
        </Card>
      )}

      {/* Income & Expense Table */}
      {incomeExpense.length > 0 && (
        <Card className="mb-6">
          <p
            className="uppercase mb-4"
            style={UPPERCASE_LABEL}
          >
            Income & expenses
          </p>
          <div className="overflow-x-auto">
            <table className="w-full" style={{ color: 'var(--text)' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Date', 'Type', 'Amount', 'Account', 'Category', 'Note'].map((h, i) => (
                    <th
                      key={h}
                      className="py-2 px-3 font-medium uppercase"
                      style={{
                        color: 'var(--text-secondary)',
                        fontSize: 'var(--fs-body-sm)',
                        letterSpacing: 'var(--ls-uppercase)',
                        textAlign: i === 2 ? 'right' : 'left',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                  <th className="w-20 py-2 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {incomeExpense.map((txn) => {
                  const isPaired = txn.transferPairId !== null;
                  // Paired (confirmed transfer) rows render with the
                  // transfer tint instead of income/expense; the storage
                  // type is unchanged but the semantics flip.
                  const tint = isPaired
                    ? 'var(--transfer)'
                    : txn.type === 'income'
                      ? 'var(--income)'
                      : 'var(--expense)';
                  return (
                    <tr
                      key={txn.id}
                      className="transition-colors"
                      style={{ borderBottom: '1px solid var(--border)' }}
                    >
                      <td
                        className="py-2.5 px-3 whitespace-nowrap"
                        style={{ fontSize: 'var(--fs-body-sm)' }}
                      >
                        {formatDate(txn.date)}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5">
                          <TypeChip
                            type={txn.type as 'income' | 'expense'}
                            paired={isPaired}
                          />
                          {txn.status === 'pending' && <PendingChip />}
                          {/* Split is disabled on bank-pending rows (see
                              convertToSplit guard); hide the affordance too. */}
                          {txn.splitStatus != null && txn.status !== 'pending' && (
                            <SplitBadge txnId={txn.id} />
                          )}
                          {txn.relationKind === 'repayment' && (
                            <RepaymentBadge
                              parentId={txn.relatedTransactionId ?? undefined}
                            />
                          )}
                          {txn.recurringSeriesId && <RecurringBadge />}
                        </div>
                      </td>
                      <td
                        className="py-2.5 px-3 text-right whitespace-nowrap"
                        data-privacy-field
                      >
                        <span className="amount amount-sm" style={{ color: tint }}>
                          {!isPaired && txn.type === 'expense' ? '-' : ''}
                          {formatAmount(txn.amount, settings.decimalSeparator)}
                        </span>
                        <span className="currency-code">{txn.currency}</span>
                      </td>
                      <td
                        className="py-2.5 px-3 whitespace-nowrap"
                        style={{ fontSize: 'var(--fs-body-sm)' }}
                      >
                        {txn.account ? (
                          <AccountDot color={txn.account.color} name={txn.account.name} />
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>--</span>
                        )}
                      </td>
                      <td
                        className="py-2.5 px-3 whitespace-nowrap"
                        style={{ fontSize: 'var(--fs-body-sm)' }}
                      >
                        {txn.category ? (
                          <span>{txn.category.name}</span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>--</span>
                        )}
                      </td>
                      <td
                        className="py-2.5 px-3 max-w-[200px] truncate"
                        style={{
                          color: 'var(--text-muted)',
                          fontSize: 'var(--fs-body-sm)',
                        }}
                        title={txn.note ?? undefined}
                      >
                        {txn.note || '--'}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => navigate(`/transactions/${txn.id}/edit`)}
                            className="p-1 rounded transition-opacity hover:opacity-70 cursor-pointer"
                            style={{ color: 'var(--text-muted)' }}
                            title="Edit transaction"
                            aria-label="Edit transaction"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(txn)}
                            className="p-1 rounded transition-opacity hover:opacity-70 cursor-pointer"
                            style={{ color: 'var(--danger)' }}
                            title="Delete transaction"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Transfers Table */}
      {transfers.length > 0 && (
        <Card className="mb-6">
          <p
            className="uppercase mb-4"
            style={UPPERCASE_LABEL}
          >
            Transfers
          </p>
          <div className="overflow-x-auto">
            <table className="w-full" style={{ color: 'var(--text)' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Date', 'Type', 'Amount', 'From / To', 'Note'].map((h, i) => (
                    <th
                      key={h}
                      className="py-2 px-3 font-medium uppercase"
                      style={{
                        color: 'var(--text-secondary)',
                        fontSize: 'var(--fs-body-sm)',
                        letterSpacing: 'var(--ls-uppercase)',
                        textAlign: i === 2 ? 'right' : 'left',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                  <th className="w-20 py-2 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((txn) => (
                  <tr
                    key={txn.id}
                    className="transition-colors"
                    style={{ borderBottom: '1px solid var(--border)' }}
                  >
                    <td
                      className="py-2.5 px-3 whitespace-nowrap"
                      style={{ fontSize: 'var(--fs-body-sm)' }}
                    >
                      {formatDate(txn.date)}
                    </td>
                    <td className="py-2.5 px-3">
                      <TypeChip type="transfer" />
                    </td>
                    <td
                      className="py-2.5 px-3 text-right whitespace-nowrap"
                      data-privacy-field
                    >
                      <span
                        className="amount amount-sm"
                        style={{ color: 'var(--transfer)' }}
                      >
                        {formatAmount(txn.amount, settings.decimalSeparator)}
                      </span>
                      <span className="currency-code">{txn.currency}</span>
                    </td>
                    <td
                      className="py-2.5 px-3 whitespace-nowrap"
                      style={{ fontSize: 'var(--fs-body-sm)' }}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {txn.account ? (
                          <AccountDot color={txn.account.color} name={txn.account.name} />
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>--</span>
                        )}
                        <span style={{ color: 'var(--text-muted)' }} className="mx-1">
                          &rarr;
                        </span>
                        {txn.destinationAccount ? (
                          <AccountDot
                            color={txn.destinationAccount.color}
                            name={txn.destinationAccount.name}
                          />
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>--</span>
                        )}
                      </span>
                    </td>
                    <td
                      className="py-2.5 px-3 max-w-[200px] truncate"
                      style={{
                        color: 'var(--text-muted)',
                        fontSize: 'var(--fs-body-sm)',
                      }}
                      title={txn.note ?? undefined}
                    >
                      {txn.note || '--'}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => navigate(`/transactions/${txn.id}/edit`)}
                          className="p-1 rounded transition-opacity hover:opacity-70 cursor-pointer"
                          style={{ color: 'var(--text-muted)' }}
                          title="Edit transaction"
                          aria-label="Edit transaction"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(txn)}
                          className="p-1 rounded transition-opacity hover:opacity-70 cursor-pointer"
                          style={{ color: 'var(--danger)' }}
                          title="Delete transaction"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-center gap-4 mt-4">
          <Button
            variant="ghost"
            disabled={currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}
          >
            <ChevronLeft size={16} />
            Previous
          </Button>
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="ghost"
            disabled={currentPage >= totalPages}
            onClick={() => setPage(currentPage + 1)}
          >
            Next
            <ChevronRight size={16} />
          </Button>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => { setDeleteTarget(null); setDeleteError(null); }}
        title="Delete transaction?"
      >
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          Are you sure you want to delete this{' '}
          <strong style={{ color: 'var(--text)' }}>{deleteTarget?.type}</strong> transaction
          {deleteTarget?.amount && (
            <>
              {' '}of{' '}
              <PrivacyField as="strong" style={{ color: 'var(--text)' }}>
                {formatMoney(deleteTarget.amount, deleteTarget.currency, settings.decimalSeparator)}
              </PrivacyField>
            </>
          )}
          ? This action cannot be undone and the account balance will be adjusted.
        </p>
        {deleteTarget?.splitStatus != null && (
          <p className="text-sm mb-4" style={{ color: 'var(--warning)' }}>
            This is a split expense: every linked repayment (bank-imported
            income rows on your accounts) will be deleted with it and those
            account balances adjusted too. To keep the repayments as ordinary
            income instead, use “Convert to normal expense” on the split
            detail page first.
          </p>
        )}
        {deleteError && (
          <p className="text-sm mb-4" style={{ color: 'var(--danger)' }}>
            {deleteError}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button
            variant="ghost"
            onClick={() => { setDeleteTarget(null); setDeleteError(null); }}
          >
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
