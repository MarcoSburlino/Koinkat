// src/services/transaction-service.ts
// Core financial mutation service -- all balance-affecting operations flow through here.

import Big from 'big.js';
import { format } from 'date-fns';
import { getDb, withTransaction, type DbExecutor } from '../db/database';
import { dec, qCent, qRate, convertAmount, tryConvert, requirePositiveAmount, requireNonNegativeAmount } from '../domain/money';
import { isSupportedCurrency } from '../domain/currencies';
import { getRatesForDate, getLatestCachedRates } from './exchange-rate-service';
import { requireActiveKoinkatAccountId } from '../lib/active-koinkat-account';
import { applyAutoCaptureForTransaction } from './budget-service';
import type {
  Transaction,
  TransactionRow,
  AccountRow,
  SplitExternalReimbursement,
  SplitExternalReimbursementRow,
} from '../types/models';
import { toTransaction, toSplitExternalReimbursement } from '../types/models';
import type { TransactionType, CategoryType, CategorizationSource, SplitStatus, TransactionStatus } from '../types/enums';

// ── Constants ───────────────────────────────────────────────────────────────

/** System macro category used for fee-linked expense rows. */
const FEE_CATEGORY_NAME = 'Financial Fees';

// ── Param types ─────────────────────────────────────────────────────────────

export interface CreateTransactionParams {
  type: 'income' | 'expense';
  accountId: string;
  amount: string;
  currency: string;
  date?: string;
  categoryId?: string | null;
  note?: string | null;
  isBudgeted?: boolean;
  budgetEventId?: string | null;
  feeAmount?: string | null;
  /**
   * When true on an expense, marks the row as a split parent:
   *   - Sets split_status='open'.
   *   - Initializes net_spent_in_account_ccy = amount_in_account_ccy.
   *   - Prepends "[Split] " to the note for list visibility (decision Q5).
   *
   * Ignored for income rows. No-op if the feature isn't wired yet.
   */
  isSplit?: boolean;
}

export interface CreateTransferParams {
  sourceAccountId: string;
  destAccountId: string;
  amount: string;
  currency: string;
  date?: string;
  note?: string | null;
  feeAmount?: string | null;
}

export interface UpdateIncomeExpenseParams {
  accountId: string;
  amount: string;
  currency: string;
  date?: string;
  categoryId?: string | null;
  note?: string | null;
  isBudgeted?: boolean;
  budgetEventId?: string | null;
  feeAmount?: string | null;
  /**
   * Tri-state:
   *   - true:  ensure the row IS a split (flip on if not already). Existing
   *            repayments are preserved.
   *   - false: ensure the row is NOT a split. Fails if any repayments
   *            exist (call deleteSplitRepayment for each first).
   *   - undefined: leave split state as-is.
   */
  isSplit?: boolean;
}

export interface UpdateTransferParams {
  sourceAccountId: string;
  destAccountId: string;
  amount: string;
  currency: string;
  date?: string;
  note?: string | null;
  feeAmount?: string | null;
}

export interface ListTransactionsFilters {
  accountId?: string;
  type?: TransactionType | 'income_expense';
  month?: number;
  year?: number;
  /** Match a single category id (macro OR subcategory). */
  categoryId?: string;
  /**
   * Match the macro category (rolling up any subcategories beneath it).
   * Used by the Analysis page drill-down so clicking a macro row shows
   * all transactions across it and its subcategories.
   */
  macroCategoryId?: string;
  /** Only rows with `category_id IS NULL`. */
  uncategorized?: boolean;
  /** Only rows where `needs_review = 1` (used by the /review queue). */
  needsReview?: boolean;
  /** Only rows where `split_status = 'open'` (parent split expenses still pending reimbursement). */
  openSplitsOnly?: boolean;
  /** Only split-parent rows (`split_status IS NOT NULL` - both open and settled). */
  splitsOnly?: boolean;
  /** Only rows linked to a recurring series (`recurring_series_id IS NOT NULL`). */
  recurring?: boolean;
  /** Filter by bank-settlement status. Omit to show both pending and booked. */
  status?: TransactionStatus;
  /** Only rows where `type='income' AND relation_kind IS NULL AND transfer_pair_id IS NULL`.
   *  Used by the split detail "Link repayment" picker to show candidate incomes. */
  unlinkedIncomesOnly?: boolean;
  sortBy?: 'date' | 'amount' | 'recorded';
  sortDir?: 'asc' | 'desc';
  page?: number;
  perPage?: number;
  /** Skip the COUNT(*) query. For single-page consumers (drawers) that
   *  never paginate; `total` then equals the number of rows returned. */
  skipCount?: boolean;
}

export interface PaginatedTransactions {
  transactions: Transaction[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

// ── Joined row type for list queries ────────────────────────────────────────

interface TransactionJoinedRow extends TransactionRow {
  category_name: string | null;
  category_type: string | null;
  category_parent_id: string | null;
  category_icon: string | null;
  category_color: string | null;
  category_is_system: number | null;
  category_sort_order: number | null;
  account_name: string | null;
  account_currency: string | null;
  account_color: string | null;
  dest_account_name: string | null;
  dest_account_currency: string | null;
  dest_account_color: string | null;
}

// ── Internal helpers ────────────────────────────────────────────────────────

/** Get exchange rates for a date, throwing if unavailable. */
async function requireRates(dateStr: string): Promise<Record<string, string>> {
  const rates = await getRatesForDate(dateStr);
  if (!rates) {
    throw new Error(`Exchange rates not available for ${dateStr}. Please sync rates first.`);
  }
  return rates;
}

/** Fetch an account row from DB, scoped to the active profile. */
async function requireAccount(accountId: string, exec?: DbExecutor): Promise<AccountRow> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = exec ?? await getDb();
  const rows = await db.select<AccountRow[]>(
    'SELECT * FROM accounts WHERE id = ? AND koinkat_account_id = ?',
    [accountId, koinkatAccountId],
  );
  if (rows.length === 0) throw new Error(`Account not found: ${accountId}`);
  return rows[0];
}

/** Validate a transaction type is income or expense. */
function ensureIncomeOrExpense(type: string): 'income' | 'expense' {
  if (type !== 'income' && type !== 'expense') {
    throw new Error(`Invalid transaction type: ${type}. Use createTransfer() for transfers.`);
  }
  return type;
}

/** Validate and normalize a currency code. */
function ensureCurrency(currency: string): string {
  const upper = currency.toUpperCase();
  if (!isSupportedCurrency(upper)) {
    throw new Error(`Unsupported currency: ${upper}`);
  }
  return upper;
}

/** Update an account's balance in the DB. */
async function updateBalance(accountId: string, newBalance: Big, exec?: DbExecutor): Promise<void> {
  // Every caller passes an id pre-validated by requireAccount, but the
  // write itself carries the workspace filter too (invariant #2) so the
  // safety doesn't rest on the call-site discipline alone.
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = exec ?? await getDb();
  await db.execute(
    "UPDATE accounts SET current_balance = ?, updated_at = datetime('now') WHERE id = ? AND koinkat_account_id = ?",
    [qCent(newBalance).toFixed(2), accountId, koinkatAccountId],
  );
}

/** Reverse the balance effect of a single transaction. */
async function reverseBalanceEffect(txn: TransactionRow, exec?: DbExecutor): Promise<void> {
  if (txn.type === 'income' || txn.type === 'expense') {
    const acct = await requireAccount(txn.account_id, exec);
    const balance = dec(acct.current_balance);
    const amount = dec(txn.amount_in_account_ccy);
    if (txn.type === 'income') {
      await updateBalance(acct.id, balance.minus(amount), exec);
    } else {
      await updateBalance(acct.id, balance.plus(amount), exec);
    }
  } else if (txn.type === 'transfer') {
    // Reverse source: add back the outflow
    const src = await requireAccount(txn.account_id, exec);
    const srcBalance = dec(src.current_balance);
    const srcAmount = dec(txn.amount_in_account_ccy);
    await updateBalance(src.id, srcBalance.plus(srcAmount), exec);

    // Reverse dest: subtract the inflow
    if (txn.destination_account_id) {
      if (!txn.amount_in_dest_ccy) {
        throw new Error(
          `Transfer ${txn.id} has destination_account_id but no amount_in_dest_ccy; reversal aborted to preserve balance integrity.`,
        );
      }
      const dst = await requireAccount(txn.destination_account_id, exec);
      const dstBalance = dec(dst.current_balance);
      const dstAmount = dec(txn.amount_in_dest_ccy);
      await updateBalance(dst.id, dstBalance.minus(dstAmount), exec);
    }
  }
}

/**
 * Delete children linked to a parent transaction, reversing their balance
 * effects first (SQLite ON DELETE CASCADE does NOT trigger balance reversal).
 *
 * Generalization of the previous `deleteLinkedFees` helper - split-expense
 * parents can have both fee children and repayment children, so the caller
 * must opt-in to the specific kind(s) being purged:
 *
 *   - `{ kind: 'fee' }`: only fee children (used when editing a parent, so
 *     repayments survive).
 *   - `{ kind: 'repayment' }`: only repayments.
 *   - omit opts: purge all linked children (used when deleting the parent).
 */
async function deleteLinkedChildren(
  parentId: string,
  opts: { kind?: 'fee' | 'repayment' } = {},
  exec?: DbExecutor,
): Promise<void> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = exec ?? await getDb();
  let sql = 'SELECT * FROM transactions WHERE related_transaction_id = ? AND koinkat_account_id = ?';
  const params: unknown[] = [parentId, koinkatAccountId];
  if (opts.kind !== undefined) {
    sql += ' AND relation_kind = ?';
    params.push(opts.kind);
  }
  const children = await db.select<TransactionRow[]>(sql, params);
  for (const child of children) {
    await reverseBalanceEffect(child, exec);
    await db.execute(
      'DELETE FROM transactions WHERE id = ? AND koinkat_account_id = ?',
      [child.id, koinkatAccountId],
    );
  }
}

/**
 * Prepends the "[Split] " marker to a note so split expenses are visually
 * distinguishable in the transaction list. Idempotent - does not double-up
 * the marker if it's already present.
 */
function prependSplitMarker(note: string | null): string {
  const SPLIT_MARKER = '[Split] ';
  if (note == null || note.trim() === '') return SPLIT_MARKER.trimEnd();
  if (note.startsWith(SPLIT_MARKER) || note.startsWith('[Split]')) return note;
  return SPLIT_MARKER + note;
}

/**
 * Recomputes the derived `net_spent_in_account_ccy` for a split parent.
 *
 *   net = parent.amount_in_account_ccy − Σ(repayment.amount_in_account_ccy
 *                                          converted to parent account currency
 *                                          at the latest cached FX rates)
 *
 * Called from every repayment mutation (create / update / delete) and from
 * parent-edit paths when the parent's amount, currency, or account changes.
 *
 * Idempotent. Silently no-ops if the parent has no split_status.
 */
async function recomputeSplitNet(parentId: string, exec?: DbExecutor): Promise<void> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = exec ?? await getDb();
  const parentRows = await db.select<TransactionRow[]>(
    'SELECT * FROM transactions WHERE id = ? AND koinkat_account_id = ?',
    [parentId, koinkatAccountId],
  );
  if (parentRows.length === 0) return;
  const parent = parentRows[0];
  if (parent.split_status == null) return;

  const parentAccount = await requireAccount(parent.account_id, exec);
  const parentCcy = parentAccount.currency.toUpperCase();

  const repayments = await db.select<TransactionRow[]>(
    `SELECT * FROM transactions
      WHERE related_transaction_id = ?
        AND koinkat_account_id = ?
        AND relation_kind = 'repayment'`,
    [parentId, koinkatAccountId],
  );

  let totalReimbursed = new Big('0');

  if (repayments.length > 0) {
    // We need FX rates for each repayment's currency to convert back into
    // the parent account's currency. Use getLatestCachedRates() - the net
    // is a display-time quantity that changes as reimbursements drift in,
    // so consistency with the "what do I owe now" reading is more useful
    // than historical accuracy.
    const rates = await getLatestCachedRates(exec);

    for (const rep of repayments) {
      const repAccount = await requireAccount(rep.account_id, exec);
      const repCcy = repAccount.currency.toUpperCase();
      const repAmount = dec(rep.amount_in_account_ccy);

      if (repCcy === parentCcy) {
        totalReimbursed = totalReimbursed.plus(repAmount);
        continue;
      }

      const converted = rates
        ? tryConvert(repAmount, repCcy, parentCcy, rates)
        : null;
      if (converted === null) {
        console.warn(
          `[split] recomputeSplitNet: cannot convert ${repCcy}→${parentCcy} for repayment ${rep.id}; skipping.`,
        );
        continue;
      }
      totalReimbursed = totalReimbursed.plus(converted);
    }
  }

  // External (untracked) reimbursements (Phase 3). `amount_in_parent_ccy`
  // was pre-computed at insert time, so we just sum those values.
  const externalRows = await db.select<
    { amount_in_parent_ccy: string }[]
  >(
    `SELECT amount_in_parent_ccy
       FROM split_external_reimbursements
      WHERE parent_transaction_id = ?
        AND koinkat_account_id = ?`,
    [parentId, koinkatAccountId],
  );
  for (const ext of externalRows) {
    totalReimbursed = totalReimbursed.plus(dec(ext.amount_in_parent_ccy));
  }

  const gross = dec(parent.amount_in_account_ccy);
  const net = qCent(gross.minus(totalReimbursed));

  await db.execute(
    `UPDATE transactions
        SET net_spent_in_account_ccy = ?,
            updated_at = datetime('now')
      WHERE id = ? AND koinkat_account_id = ?`,
    [net.toFixed(2), parentId, koinkatAccountId],
  );
}

/** Fetch a single transaction row by ID, scoped to the active profile. */
async function requireTransactionRow(id: string, exec?: DbExecutor): Promise<TransactionRow> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = exec ?? await getDb();
  const rows = await db.select<TransactionRow[]>(
    'SELECT * FROM transactions WHERE id = ? AND koinkat_account_id = ?',
    [id, koinkatAccountId],
  );
  if (rows.length === 0) throw new Error(`Transaction not found: ${id}`);
  return rows[0];
}

/** Map a joined row into a Transaction with optional nested category/account. */
function toTransactionWithJoins(row: TransactionJoinedRow): Transaction {
  const txn = toTransaction(row);

  if (row.category_id && row.category_name !== null && row.category_type !== null) {
    txn.category = {
      id: row.category_id,
      name: row.category_name,
      type: row.category_type as CategoryType,
      parentId: row.category_parent_id,
      icon: row.category_icon,
      color: row.category_color,
      isSystem: row.category_is_system === 1,
      sortOrder: row.category_sort_order ?? 0,
      createdAt: '',
      updatedAt: '',
    };
  }

  if (row.account_name !== null) {
    txn.account = {
      id: row.account_id,
      name: row.account_name,
      currency: row.account_currency ?? '',
      color: row.account_color ?? '',
      currentBalance: '0',
      isPinned: false,
      isManual: true,
      createdAt: '',
      updatedAt: '',
    };
  }

  if (row.destination_account_id && row.dest_account_name !== null) {
    txn.destinationAccount = {
      id: row.destination_account_id,
      name: row.dest_account_name,
      currency: row.dest_account_currency ?? '',
      color: row.dest_account_color ?? '',
      currentBalance: '0',
      isPinned: false,
      isManual: true,
      createdAt: '',
      updatedAt: '',
    };
  }

  return txn;
}

// ── Fee creation (internal) ─────────────────────────────────────────────────

async function _createFeeExpense(params: {
  accountId: string;
  feeAmount: string;
  currency: string;
  txnDate: string;
  relatedTransactionId: string;
  isBudgeted: boolean;
  budgetEventId: string | null;
  parentType: string;
  parentAmount: string;
  parentCurrency: string;
  destinationAccountId?: string | null;
  /** Pre-fetched rates for `txnDate`, supplied by the caller BEFORE the
   *  transaction. Fetching here would re-enter the serialize queue (and hit
   *  the network) inside the txn and deadlock. */
  rates: Record<string, string>;
}, exec?: DbExecutor): Promise<Transaction | null> {
  const feeAmt = requireNonNegativeAmount(params.feeAmount);
  if (feeAmt.lte(dec('0'))) return null;

  const feeCurrency = ensureCurrency(params.currency);
  const parentCurrencyNorm = ensureCurrency(params.parentCurrency);

  const acct = await requireAccount(params.accountId, exec);
  const rates = params.rates;

  // Convert fee to account currency. feeAmt > 0 is guaranteed by the
  // early-return guard above, so the division is always safe.
  const { converted } = convertAmount(feeAmt, feeCurrency, acct.currency, rates);
  const rate = qRate(converted.div(feeAmt));

  // Deduct fee from account balance
  const newBalance = dec(acct.current_balance).minus(converted);
  await updateBalance(acct.id, newBalance, exec);

  // Find the system "Financial Fees" macro category (scoped to active profile)
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = exec ?? await getDb();
  const catRows = await db.select<{ id: string }[]>(
    `SELECT id FROM categories
      WHERE koinkat_account_id = ?
        AND name = ?
        AND type = 'expense'
        AND parent_id IS NULL
        AND is_system = 1
      LIMIT 1`,
    [koinkatAccountId, FEE_CATEGORY_NAME],
  );
  const feeCategoryId = catRows.length > 0 ? catRows[0].id : null;

  // Build contextual note
  const parentAmtFmt = qCent(dec(params.parentAmount)).toFixed(2);
  let accountLabel = acct.name;
  if (params.parentType === 'transfer' && params.destinationAccountId) {
    const dest = await requireAccount(params.destinationAccountId, exec);
    accountLabel = `${acct.name} -> ${dest.name}`;
  }
  const noteText = `Fee linked to ${params.parentType} on ${params.txnDate}. Account: ${accountLabel}; Amount: ${parentAmtFmt} ${parentCurrencyNorm}`;

  const id = crypto.randomUUID();
  const manualSource: CategorizationSource = 'user_manual';
  await db.execute(
    `INSERT INTO transactions
       (id, koinkat_account_id, account_id, destination_account_id, related_transaction_id,
        type, amount, currency, exchange_rate, amount_in_account_ccy,
        amount_in_dest_ccy, category_id, note, date, is_budgeted, budget_event_id,
        relation_kind,
        categorization_source, needs_review,
        recorded_at, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, 'expense', ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?,
             'fee',
             ?, 0,
             datetime('now'), datetime('now'), datetime('now'))`,
    [
      id,
      koinkatAccountId,
      params.accountId,
      params.relatedTransactionId,
      feeAmt.toFixed(2),
      feeCurrency,
      rate.toFixed(4),
      converted.toFixed(2),
      feeCategoryId,
      noteText,
      params.txnDate,
      params.isBudgeted ? 1 : 0,
      params.isBudgeted ? params.budgetEventId : null,
      manualSource,
    ],
  );

  const row = await requireTransactionRow(id, exec);
  return toTransaction(row);
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Create an income or expense transaction.
 * Converts amount to account currency, mutates account balance, inserts row.
 */
export async function createTransaction(params: CreateTransactionParams): Promise<Transaction> {
  const ttype = ensureIncomeOrExpense(params.type);
  const amt = requirePositiveAmount(params.amount);
  const ccy = ensureCurrency(params.currency);
  const txnDate = params.date ?? format(new Date(), 'yyyy-MM-dd');

  const acct = await requireAccount(params.accountId);
  const rates = await requireRates(txnDate);

  // Convert to account currency
  const { converted } = convertAmount(amt, ccy, acct.currency, rates);
  const rate = amt.gt(dec('0'))
    ? qRate(converted.div(amt))
    : qRate(dec('1'));

  // Pre-compute everything that doesn't write to the DB before we BEGIN
  // - rate fetches and validation should not hold a transaction open.
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const id = crypto.randomUUID();
  const isBudgeted = params.isBudgeted ?? true;

  // Manually-created transactions are categorized by the user directly,
  // so they're never part of the review queue.
  const manualSource: CategorizationSource = 'user_manual';

  // Split-expense initialization (Feature 1). Only applies to expenses.
  // Ignored silently for income rows (user error; the UI never offers the
  // option on income anyway).
  const isSplitParent = ttype === 'expense' && params.isSplit === true;
  const splitStatus: SplitStatus | null = isSplitParent ? 'open' : null;
  const netSpentInAccountCcy = isSplitParent ? converted.toFixed(2) : null;
  const rawNote = params.note ?? null;
  const finalNote = isSplitParent
    ? prependSplitMarker(rawNote)
    : rawNote;

  if (params.feeAmount != null && ttype !== 'expense') {
    throw new Error('Fees can only be attached to expense transactions');
  }

  await withTransaction(async (tx) => {
    // Mutate balance
    const balance = dec(acct.current_balance);
    if (ttype === 'income') {
      await updateBalance(acct.id, balance.plus(converted), tx);
    } else {
      await updateBalance(acct.id, balance.minus(converted), tx);
    }

    // event_link_pinned: any non-null budgetEventId at create time
    // means the user (or the form's auto-suggest, which the user can
    // clear before submitting) actively chose this link. Pin it so
    // auto-capture sweeps don't overwrite the choice later.
    const eventLinkPinned = params.budgetEventId != null ? 1 : 0;

    await tx.execute(
      `INSERT INTO transactions
         (id, koinkat_account_id, account_id, destination_account_id, related_transaction_id,
          type, amount, currency, exchange_rate, amount_in_account_ccy,
          amount_in_dest_ccy, category_id, note, date, is_budgeted, budget_event_id,
          split_status, net_spent_in_account_ccy,
          categorization_source, needs_review,
          event_link_pinned,
          recorded_at, created_at, updated_at)
       VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?,
               ?, ?,
               ?, 0,
               ?,
               datetime('now'), datetime('now'), datetime('now'))`,
      [
        id,
        koinkatAccountId,
        params.accountId,
        ttype,
        amt.toFixed(2),
        ccy,
        rate.toFixed(4),
        converted.toFixed(2),
        params.categoryId ?? null,
        finalNote,
        txnDate,
        isBudgeted ? 1 : 0,
        isBudgeted ? (params.budgetEventId ?? null) : null,
        splitStatus,
        netSpentInAccountCcy,
        manualSource,
        eventLinkPinned,
      ],
    );

    // Create linked fee if provided (fees only on expenses)
    if (params.feeAmount != null) {
      await _createFeeExpense({
        accountId: params.accountId,
        feeAmount: params.feeAmount,
        rates,
        currency: ccy,
        txnDate,
        relatedTransactionId: id,
        isBudgeted,
        budgetEventId: params.budgetEventId ?? null,
        parentType: ttype,
        parentAmount: amt.toFixed(2),
        parentCurrency: ccy,
        destinationAccountId: null,
      }, tx);
    }
  });

  // Auto-capture into a matching budget event, but only when the user
  // didn't already pick one (then the row is pinned above and the
  // helper would bail anyway). Wrapped so a capture failure never
  // blocks the create.
  if (params.budgetEventId == null) {
    try {
      await applyAutoCaptureForTransaction(id);
    } catch (err) {
      console.warn(
        `[transaction] applyAutoCaptureForTransaction failed for ${id}:`,
        err,
      );
    }
  }

  const row = await requireTransactionRow(id);
  return toTransaction(row);
}

/**
 * Create a transfer between two accounts.
 * Converts amount to each account's currency independently, mutates both balances.
 */
export async function createTransfer(params: CreateTransferParams): Promise<Transaction> {
  if (params.sourceAccountId === params.destAccountId) {
    throw new Error('Source and destination accounts must be different');
  }

  const amt = requirePositiveAmount(params.amount);
  const ccy = ensureCurrency(params.currency);
  const txnDate = params.date ?? format(new Date(), 'yyyy-MM-dd');

  const src = await requireAccount(params.sourceAccountId);
  const dst = await requireAccount(params.destAccountId);
  const rates = await requireRates(txnDate);

  // Convert to each account's currency
  const { converted: outflow } = convertAmount(amt, ccy, src.currency, rates);
  const { converted: inflow } = convertAmount(amt, ccy, dst.currency, rates);

  // Exchange rate stored as dest_ccy / src_ccy
  const rate = outflow.gt(dec('0'))
    ? qRate(inflow.div(outflow))
    : qRate(dec('1'));

  const koinkatAccountId = requireActiveKoinkatAccountId();
  const id = crypto.randomUUID();

  await withTransaction(async (tx) => {
    // Mutate balances
    await updateBalance(src.id, dec(src.current_balance).minus(outflow), tx);
    await updateBalance(dst.id, dec(dst.current_balance).plus(inflow), tx);

    await tx.execute(
      `INSERT INTO transactions
         (id, koinkat_account_id, account_id, destination_account_id, related_transaction_id,
          type, amount, currency, exchange_rate, amount_in_account_ccy,
          amount_in_dest_ccy, category_id, note, date, is_budgeted, budget_event_id,
          needs_review,
          recorded_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 'transfer', ?, ?, ?, ?, ?, NULL, ?, ?, 0, NULL,
               0,
               datetime('now'), datetime('now'), datetime('now'))`,
      [
        id,
        koinkatAccountId,
        params.sourceAccountId,
        params.destAccountId,
        amt.toFixed(2),
        ccy,
        rate.toFixed(4),
        outflow.toFixed(2),
        inflow.toFixed(2),
        params.note ?? null,
        txnDate,
      ],
    );

    // Create linked fee on source account if provided
    if (params.feeAmount != null) {
      await _createFeeExpense({
        accountId: params.sourceAccountId,
        feeAmount: params.feeAmount,
        rates,
        currency: ccy,
        txnDate,
        relatedTransactionId: id,
        isBudgeted: false,
        budgetEventId: null,
        parentType: 'transfer',
        parentAmount: amt.toFixed(2),
        parentCurrency: ccy,
        destinationAccountId: params.destAccountId,
      }, tx);
    }
  });

  const row = await requireTransactionRow(id);
  return toTransaction(row);
}

/**
 * Delete a transaction, reversing all balance effects.
 * Also deletes and reverses any linked fee transactions.
 */
export async function deleteTransaction(id: string): Promise<boolean> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<TransactionRow[]>(
    'SELECT * FROM transactions WHERE id = ? AND koinkat_account_id = ?',
    [id, koinkatAccountId],
  );
  if (rows.length === 0) return false;
  const txn = rows[0];

  await withTransaction(async (tx) => {
    // Delete ALL linked children (fees AND repayments) with balance reversal.
    // SQLite's ON DELETE CASCADE would delete rows without running the balance
    // math, which is exactly the invariant we must preserve.
    await deleteLinkedChildren(txn.id, {}, tx);

    // Reverse the main transaction's balance effect
    await reverseBalanceEffect(txn, tx);

    // Delete the transaction
    await tx.execute(
      'DELETE FROM transactions WHERE id = ? AND koinkat_account_id = ?',
      [id, koinkatAccountId],
    );

    // Deleting a repayment changes its parent's derived net - recompute so
    // budgets / category totals / the open-splits callout see the restored
    // share. (deleteSplitRepayment does this; the generic path must too.)
    if (txn.relation_kind === 'repayment' && txn.related_transaction_id) {
      await recomputeSplitNet(txn.related_transaction_id, tx);
    }
  });

  return true;
}

/**
 * Delete every transaction touching an account (as source or transfer
 * destination), reversing balance effects on the OTHER accounts involved so
 * their balances stay equal to the sum of their remaining rows.
 *
 * Exists for account deletion: without it, the FK `ON DELETE CASCADE` on
 * `transactions.account_id` / `destination_account_id` would drop transfer
 * rows without running any balance math, and cascade-delete repayment
 * children sitting on other accounts - permanently desyncing those balances.
 *
 * Must run inside the same `withTransaction` as the account DELETE.
 */
export async function purgeAccountTransactions(
  accountId: string,
  tx: DbExecutor,
): Promise<void> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const rows = await tx.select<TransactionRow[]>(
    `SELECT * FROM transactions
      WHERE koinkat_account_id = ?
        AND (account_id = ? OR destination_account_id = ?)`,
    [koinkatAccountId, accountId, accountId],
  );
  const inSet = new Set(rows.map((r) => r.id));

  // Split parents on OTHER accounts whose repayment children lived on this
  // account - their derived net must be refreshed once the children are gone.
  const parentsToRecompute = new Set<string>();

  for (const row of rows) {
    // A child whose parent is also being purged is handled by the parent's
    // deleteLinkedChildren pass below - skip to avoid double reversal.
    if (row.related_transaction_id && inSet.has(row.related_transaction_id)) {
      continue;
    }

    // Reverse + delete the row's own children first. This also covers
    // children living on OTHER accounts (e.g. a repayment income on account
    // B linked to a split parent on the account being deleted).
    await deleteLinkedChildren(row.id, {}, tx);
    await reverseBalanceEffect(row, tx);
    await tx.execute(
      'DELETE FROM transactions WHERE id = ? AND koinkat_account_id = ?',
      [row.id, koinkatAccountId],
    );

    if (row.relation_kind === 'repayment' && row.related_transaction_id) {
      parentsToRecompute.add(row.related_transaction_id);
    }
  }

  for (const parentId of parentsToRecompute) {
    await recomputeSplitNet(parentId, tx);
  }
}

/**
 * Fetch the fee child linked to a transaction, if any. Used by the edit
 * forms to pre-fill the Fee field: updates purge-and-recreate fee children,
 * so the form must round-trip the existing amount or the fee is lost.
 */
export async function getFeeChild(parentId: string): Promise<Transaction | null> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<TransactionRow[]>(
    `SELECT * FROM transactions
      WHERE related_transaction_id = ?
        AND koinkat_account_id = ?
        AND relation_kind = 'fee'
      LIMIT 1`,
    [parentId, koinkatAccountId],
  );
  return rows.length > 0 ? toTransaction(rows[0]) : null;
}

/**
 * Update an income or expense transaction.
 * Reverses old balance, recalculates with new values, applies new balance.
 */
export async function updateIncomeExpense(
  id: string,
  params: UpdateIncomeExpenseParams,
): Promise<Transaction> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const txn = await requireTransactionRow(id);
  if (txn.type === 'transfer') {
    throw new Error('Use updateTransfer() for transfer transactions');
  }

  const amt = requirePositiveAmount(params.amount);
  const ccy = ensureCurrency(params.currency);
  const txnDate = params.date ?? format(new Date(), 'yyyy-MM-dd');

  // Pre-fetch (reads/network) before BEGIN so the transaction window
  // only spans actual writes.
  const acct = await requireAccount(params.accountId);
  const rates = await requireRates(txnDate);

  const { converted } = convertAmount(amt, ccy, acct.currency, rates);
  const rate = amt.gt(dec('0'))
    ? qRate(converted.div(amt))
    : qRate(dec('1'));

  // Resolve budget fields
  const isBudgeted = params.isBudgeted ?? true;

  // Editing a transaction always marks it as manually confirmed so it
  // leaves the review queue if it was there.
  const manualSource: CategorizationSource = 'user_manual';

  // Resolve split-state transition (Feature 1).
  //   - isSplit undefined → leave existing split_status as-is.
  //   - isSplit true      → ensure split_status='open' (flip on if needed).
  //   - isSplit false     → ensure split_status=NULL (flip off if possible;
  //                         throws if repayments still exist).
  const db = await getDb();
  let nextSplitStatus: SplitStatus | null = (txn.split_status as SplitStatus | null) ?? null;
  let markNoteAsSplit = false;

  if (params.isSplit === true && txn.split_status == null) {
    // Expense-only. For income rows this is a no-op.
    if (txn.type === 'expense') {
      nextSplitStatus = 'open';
      markNoteAsSplit = true;
    }
  } else if (params.isSplit === false && txn.split_status != null) {
    const existingReps = await db.select<{ cnt: number }[]>(
      `SELECT COUNT(*) AS cnt FROM transactions
        WHERE related_transaction_id = ?
          AND koinkat_account_id = ?
          AND relation_kind = 'repayment'`,
      [id, koinkatAccountId],
    );
    if ((existingReps[0]?.cnt ?? 0) > 0) {
      throw new Error(
        'Cannot unmark as split while repayments exist. Delete repayments first.',
      );
    }
    nextSplitStatus = null;
  }

  if (params.feeAmount != null && txn.type !== 'expense') {
    throw new Error('Fees can only be attached to expense transactions');
  }

  const resolvedNote = markNoteAsSplit
    ? prependSplitMarker(params.note ?? null)
    : (params.note ?? null);

  // Update the transaction row. `net_spent_in_account_ccy` is set to the
  // fresh `converted` value as a starting point - we then call
  // recomputeSplitNet below to factor in any surviving repayments.
  const provisionalNet = nextSplitStatus != null ? converted.toFixed(2) : null;

  await withTransaction(async (tx) => {
    // Delete only fee children (preserve repayments; they survive a parent edit).
    await deleteLinkedChildren(txn.id, { kind: 'fee' }, tx);

    // Reverse the old balance effect
    await reverseBalanceEffect(txn, tx);

    // Apply new balance. Re-read the account so we see the post-reversal
    // balance (especially when the user kept the account the same).
    const acctAfter = await requireAccount(params.accountId, tx);
    const balance = dec(acctAfter.current_balance);
    if (txn.type === 'income') {
      await updateBalance(acctAfter.id, balance.plus(converted), tx);
    } else {
      await updateBalance(acctAfter.id, balance.minus(converted), tx);
    }

    // event_link_pinned: any explicit touch of budgetEventId in the
    // update params pins the row's link to whatever the user set
    // (including null = "no event"). When budgetEventId is undefined,
    // the column is left alone.
    const pinClause =
      params.budgetEventId !== undefined ? ', event_link_pinned = 1' : '';

    await tx.execute(
      `UPDATE transactions
       SET account_id = ?, amount = ?, currency = ?, exchange_rate = ?,
           amount_in_account_ccy = ?, amount_in_dest_ccy = NULL,
           category_id = ?, note = ?, date = ?,
           is_budgeted = ?, budget_event_id = ?,
           split_status = ?, net_spent_in_account_ccy = ?,
           categorization_source = ?, needs_review = 0${pinClause},
           updated_at = datetime('now')
       WHERE id = ? AND koinkat_account_id = ?`,
      [
        params.accountId,
        amt.toFixed(2),
        ccy,
        rate.toFixed(4),
        converted.toFixed(2),
        params.categoryId ?? null,
        resolvedNote,
        txnDate,
        isBudgeted ? 1 : 0,
        isBudgeted ? (params.budgetEventId ?? null) : null,
        nextSplitStatus,
        provisionalNet,
        manualSource,
        id,
        koinkatAccountId,
      ],
    );

    // If the row is now a split parent, recompute net from the repayments
    // that survived the edit (we only purged fees above).
    if (nextSplitStatus != null) {
      await recomputeSplitNet(id, tx);
    }

    // Create new fee if provided
    if (params.feeAmount != null) {
      await _createFeeExpense({
        accountId: params.accountId,
        feeAmount: params.feeAmount,
        rates,
        currency: ccy,
        txnDate,
        relatedTransactionId: id,
        isBudgeted,
        budgetEventId: params.budgetEventId ?? null,
        parentType: txn.type,
        parentAmount: amt.toFixed(2),
        parentCurrency: ccy,
        destinationAccountId: null,
      }, tx);
    }
  });

  const row = await requireTransactionRow(id);
  return toTransaction(row);
}

/**
 * Toggle whether a single expense counts toward the monthly recurring
 * budget (the `is_budgeted` flag). Used by the Review queue's per-row
 * "Budgeted" checkbox so a user can keep a one-off expense (e.g. annual
 * taxes) out of that month's budget totals without deleting it.
 *
 * No balance effect - this is metadata only. When set to false we also
 * clear `budget_event_id`, mirroring the invariant in createTransaction /
 * updateIncomeExpense that a non-budgeted row cannot carry a budget event.
 * Returns the refreshed transaction.
 */
export async function setTransactionBudgeted(
  id: string,
  isBudgeted: boolean,
): Promise<Transaction> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  await db.execute(
    `UPDATE transactions
        SET is_budgeted = ?,
            budget_event_id = CASE WHEN ? THEN budget_event_id ELSE NULL END,
            updated_at = datetime('now')
      WHERE id = ? AND koinkat_account_id = ?`,
    [isBudgeted ? 1 : 0, isBudgeted ? 1 : 0, id, koinkatAccountId],
  );
  const row = await requireTransactionRow(id);
  return toTransaction(row);
}

/**
 * Link (or unlink) a single income/expense to a budget event. Metadata
 * only - no balance effect - so this is a single auto-commit UPDATE and
 * deliberately avoids the heavy `updateIncomeExpense` transaction path
 * (which reverses + re-applies the balance and would clobber the row's
 * `categorization_source`). Used by the Review queue when a row is
 * confirmed with a budget event chosen.
 *
 * A non-null event implies the row is budgeted, so we also force
 * `is_budgeted = 1` in that case (mirrors the invariant in
 * createTransaction / updateIncomeExpense). Passing `null` only clears the
 * link and leaves `is_budgeted` untouched. Returns the refreshed row.
 */
export async function setTransactionBudgetEvent(
  id: string,
  eventId: string | null,
): Promise<Transaction> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  // Pin unconditionally - every caller of this function is an explicit
  // user UI action (Review per-row picker, etc.), so auto-capture must
  // not later overwrite the choice (including "no event").
  await db.execute(
    `UPDATE transactions
        SET budget_event_id = ?,
            is_budgeted = CASE WHEN ? IS NOT NULL THEN 1 ELSE is_budgeted END,
            event_link_pinned = 1,
            updated_at = datetime('now')
      WHERE id = ? AND koinkat_account_id = ?`,
    [eventId, eventId, id, koinkatAccountId],
  );
  const row = await requireTransactionRow(id);
  return toTransaction(row);
}

/**
 * Update a transfer transaction.
 * Reverses old balances on both accounts, recalculates with new values.
 */
export async function updateTransfer(
  id: string,
  params: UpdateTransferParams,
): Promise<Transaction> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const txn = await requireTransactionRow(id);
  if (txn.type !== 'transfer') {
    throw new Error('Transaction is not a transfer');
  }

  if (params.sourceAccountId === params.destAccountId) {
    throw new Error('Source and destination accounts must be different');
  }

  const amt = requirePositiveAmount(params.amount);
  const ccy = ensureCurrency(params.currency);
  const txnDate = params.date ?? format(new Date(), 'yyyy-MM-dd');

  // Pre-fetch reads/network before BEGIN so the transaction window
  // only spans actual writes.
  const src = await requireAccount(params.sourceAccountId);
  const dst = await requireAccount(params.destAccountId);
  const rates = await requireRates(txnDate);

  const { converted: outflow } = convertAmount(amt, ccy, src.currency, rates);
  const { converted: inflow } = convertAmount(amt, ccy, dst.currency, rates);
  const rate = outflow.gt(dec('0'))
    ? qRate(inflow.div(outflow))
    : qRate(dec('1'));

  await withTransaction(async (tx) => {
    // Delete only fee children (preserve repayments; they survive a parent edit).
    await deleteLinkedChildren(txn.id, { kind: 'fee' }, tx);

    // Reverse the old balance effect on both accounts
    await reverseBalanceEffect(txn, tx);

    // Apply new balances. Re-read source/dest after reversal in case the
    // same account is on both legs of the transfer (covers the case where
    // the user keeps the account but changes amount/currency).
    const srcAfter = await requireAccount(params.sourceAccountId, tx);
    await updateBalance(srcAfter.id, dec(srcAfter.current_balance).minus(outflow), tx);
    const dstAfter = await requireAccount(params.destAccountId, tx);
    await updateBalance(dstAfter.id, dec(dstAfter.current_balance).plus(inflow), tx);

    await tx.execute(
      `UPDATE transactions
       SET account_id = ?, destination_account_id = ?,
           amount = ?, currency = ?, exchange_rate = ?,
           amount_in_account_ccy = ?, amount_in_dest_ccy = ?,
           category_id = NULL, note = ?, date = ?,
           is_budgeted = 0, budget_event_id = NULL,
           needs_review = 0,
           updated_at = datetime('now')
       WHERE id = ? AND koinkat_account_id = ?`,
      [
        params.sourceAccountId,
        params.destAccountId,
        amt.toFixed(2),
        ccy,
        rate.toFixed(4),
        outflow.toFixed(2),
        inflow.toFixed(2),
        params.note ?? null,
        txnDate,
        id,
        koinkatAccountId,
      ],
    );

    // Create new fee on source if provided
    if (params.feeAmount != null) {
      await _createFeeExpense({
        accountId: params.sourceAccountId,
        feeAmount: params.feeAmount,
        rates,
        currency: ccy,
        txnDate,
        relatedTransactionId: id,
        isBudgeted: false,
        budgetEventId: null,
        parentType: 'transfer',
        parentAmount: amt.toFixed(2),
        parentCurrency: ccy,
        destinationAccountId: params.destAccountId,
      }, tx);
    }
  });

  const row = await requireTransactionRow(id);
  return toTransaction(row);
}

/* ── Split expense public API ───────────────────────────────────────────
 *
 * A "split expense" is a parent expense row the user fronted for a group.
 * Repayments from others are stored as linked income rows with
 * `relation_kind='repayment'`. The parent's `net_spent_in_account_ccy` is
 * a derived column, maintained by `recomputeSplitNet` on every repayment
 * mutation. Aggregation queries (budget / reporting / category) COALESCE
 * it against `amount_in_account_ccy`, so only the user's *net* share
 * counts toward budgets and category totals.
 *
 * Key invariant: the parent's balance math is unchanged - the gross
 * really did leave the account, and each repayment really landed on its
 * destination account. The net column is purely for aggregation.
 */

export interface AddSplitRepaymentParams {
  accountId: string;
  amount: string;
  currency: string;
  date?: string;
  note?: string | null;
}

/**
 * Add a repayment against a split parent. Creates a linked income row
 * (relation_kind='repayment') on the destination account, credits that
 * account's balance, and recomputes the parent's net spent.
 */
export async function addSplitRepayment(
  parentId: string,
  params: AddSplitRepaymentParams,
): Promise<Transaction> {
  const parent = await requireTransactionRow(parentId);
  if (parent.split_status == null) {
    throw new Error('Parent transaction is not a split expense');
  }
  if (parent.type !== 'expense') {
    throw new Error('Only expense rows can have repayments');
  }

  const amt = requirePositiveAmount(params.amount);
  const ccy = ensureCurrency(params.currency);
  const txnDate = params.date ?? format(new Date(), 'yyyy-MM-dd');

  const acct = await requireAccount(params.accountId);
  const rates = await requireRates(txnDate);

  const { converted } = convertAmount(amt, ccy, acct.currency, rates);
  const rate = amt.gt(dec('0'))
    ? qRate(converted.div(amt))
    : qRate(dec('1'));

  const koinkatAccountId = requireActiveKoinkatAccountId();
  const id = crypto.randomUUID();
  const manualSource: CategorizationSource = 'user_manual';

  await withTransaction(async (tx) => {
    // Credit the destination account (repayments are income).
    const balance = dec(acct.current_balance);
    await updateBalance(acct.id, balance.plus(converted), tx);

    await tx.execute(
      `INSERT INTO transactions
         (id, koinkat_account_id, account_id, destination_account_id, related_transaction_id,
          type, amount, currency, exchange_rate, amount_in_account_ccy,
          amount_in_dest_ccy, category_id, note, date, is_budgeted, budget_event_id,
          relation_kind,
          categorization_source, needs_review,
          recorded_at, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, 'income', ?, ?, ?, ?, NULL, NULL, ?, ?, 0, NULL,
               'repayment',
               ?, 0,
               datetime('now'), datetime('now'), datetime('now'))`,
      [
        id,
        koinkatAccountId,
        params.accountId,
        parentId,
        amt.toFixed(2),
        ccy,
        rate.toFixed(4),
        converted.toFixed(2),
        params.note ?? null,
        txnDate,
        manualSource,
      ],
    );

    await recomputeSplitNet(parentId, tx);
  });

  const row = await requireTransactionRow(id);
  return toTransaction(row);
}

export interface UpdateSplitRepaymentParams {
  accountId?: string;
  amount?: string;
  currency?: string;
  date?: string;
  note?: string | null;
}

/** Update a repayment; reverses old balance, applies new, recomputes parent net. */
export async function updateSplitRepayment(
  repaymentId: string,
  params: UpdateSplitRepaymentParams,
): Promise<Transaction> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const txn = await requireTransactionRow(repaymentId);
  if (txn.relation_kind !== 'repayment') {
    throw new Error('Transaction is not a repayment');
  }
  const parentId = txn.related_transaction_id;
  if (!parentId) {
    throw new Error('Repayment has no parent');
  }

  // Merge against existing values
  const nextAccountId = params.accountId ?? txn.account_id;
  const nextAmount = params.amount ?? txn.amount;
  const nextCurrency = params.currency ?? txn.currency;
  const nextDate = params.date ?? txn.date;
  const nextNote = params.note !== undefined ? params.note : txn.note;

  const amt = requirePositiveAmount(nextAmount);
  const ccy = ensureCurrency(nextCurrency);

  // Pre-fetch reads/network before BEGIN.
  const rates = await requireRates(nextDate);
  // We need the destination account's currency for the conversion. The
  // post-reversal balance is read inside the transaction below.
  const acctPre = await requireAccount(nextAccountId);
  const { converted } = convertAmount(amt, ccy, acctPre.currency, rates);
  const rate = amt.gt(dec('0'))
    ? qRate(converted.div(amt))
    : qRate(dec('1'));

  await withTransaction(async (tx) => {
    // Reverse old balance
    await reverseBalanceEffect(txn, tx);

    // Apply new balance against the post-reversal account row.
    const acctAfter = await requireAccount(nextAccountId, tx);
    await updateBalance(acctAfter.id, dec(acctAfter.current_balance).plus(converted), tx);

    await tx.execute(
      `UPDATE transactions
          SET account_id = ?, amount = ?, currency = ?, exchange_rate = ?,
              amount_in_account_ccy = ?, note = ?, date = ?,
              updated_at = datetime('now')
        WHERE id = ? AND koinkat_account_id = ?`,
      [
        nextAccountId,
        amt.toFixed(2),
        ccy,
        rate.toFixed(4),
        converted.toFixed(2),
        nextNote,
        nextDate,
        repaymentId,
        koinkatAccountId,
      ],
    );

    await recomputeSplitNet(parentId, tx);
  });

  const row = await requireTransactionRow(repaymentId);
  return toTransaction(row);
}

/** Delete a repayment; reverses balance and recomputes parent net. */
export async function deleteSplitRepayment(repaymentId: string): Promise<boolean> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const txn = await requireTransactionRow(repaymentId);
  if (txn.relation_kind !== 'repayment') {
    throw new Error('Transaction is not a repayment');
  }
  const parentId = txn.related_transaction_id;
  await withTransaction(async (tx) => {
    await reverseBalanceEffect(txn, tx);
    await tx.execute(
      'DELETE FROM transactions WHERE id = ? AND koinkat_account_id = ?',
      [repaymentId, koinkatAccountId],
    );
    if (parentId) await recomputeSplitNet(parentId, tx);
  });
  return true;
}

/** Flip a split parent's status flag. Does not affect the math. */
export async function setSplitStatus(
  parentId: string,
  status: SplitStatus,
): Promise<void> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const parent = await requireTransactionRow(parentId);
  if (parent.split_status == null) {
    throw new Error('Transaction is not a split expense');
  }
  const db = await getDb();
  await db.execute(
    `UPDATE transactions
        SET split_status = ?, updated_at = datetime('now')
      WHERE id = ? AND koinkat_account_id = ?`,
    [status, parentId, koinkatAccountId],
  );
}

/**
 * Retrofit an existing plain expense into a split expense. Initializes
 * net_spent_in_account_ccy to the current gross (no repayments yet).
 * No-op if already a split.
 */
export async function convertToSplit(parentId: string): Promise<Transaction> {
  const txn = await requireTransactionRow(parentId);
  if (txn.split_status != null) {
    return toTransaction(txn);
  }
  if (txn.type !== 'expense') {
    throw new Error('Only expense rows can become split expenses');
  }
  // Bank-pending rows can't be split: they're balance-neutral and may be
  // auto-removed before settling, which would orphan any split children.
  if (txn.status === 'pending') {
    throw new Error('Cannot split a bank-pending transaction until it settles');
  }
  const db = await getDb();
  await db.execute(
    `UPDATE transactions
        SET split_status = 'open',
            net_spent_in_account_ccy = ?,
            note = ?,
            updated_at = datetime('now')
      WHERE id = ? AND koinkat_account_id = ?`,
    [
      txn.amount_in_account_ccy,
      prependSplitMarker(txn.note ?? null),
      parentId,
      requireActiveKoinkatAccountId(),
    ],
  );
  const row = await requireTransactionRow(parentId);
  return toTransaction(row);
}

/**
 * Cancel a split parent and turn it back into a plain expense.
 *
 * Repayments are *unlinked* (relabelled back to ordinary income), not
 * deleted: the money really landed in those accounts, so balances are left
 * untouched. Their category was cleared when they were linked, so they go
 * back into the Review inbox to be re-categorized. External (untracked)
 * reimbursements were split-only metadata with no balance effect, so they're
 * removed. The parent's split state + net column are cleared (it now counts
 * at gross) and the "[Split] " note marker is stripped. All atomic.
 */
export async function convertFromSplit(parentId: string): Promise<Transaction> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const txn = await requireTransactionRow(parentId);
  if (txn.split_status == null) {
    return toTransaction(txn);
  }
  const cleanedNote = (txn.note ?? '').replace(/^\[Split\]\s*/, '') || null;

  await withTransaction(async (tx) => {
    // Unlink tracked repayments → ordinary income (keep balances).
    await tx.execute(
      `UPDATE transactions
          SET relation_kind = NULL,
              related_transaction_id = NULL,
              needs_review = 1,
              categorization_source = NULL,
              confirmed_at = NULL,
              updated_at = datetime('now')
        WHERE related_transaction_id = ?
          AND koinkat_account_id = ?
          AND relation_kind = 'repayment'`,
      [parentId, koinkatAccountId],
    );

    // Drop external (untracked) reimbursements - split-only metadata.
    await tx.execute(
      `DELETE FROM split_external_reimbursements
        WHERE parent_transaction_id = ? AND koinkat_account_id = ?`,
      [parentId, koinkatAccountId],
    );

    // Clear the parent's split state; net resets so it counts at gross.
    await tx.execute(
      `UPDATE transactions
          SET split_status = NULL,
              net_spent_in_account_ccy = NULL,
              note = ?,
              updated_at = datetime('now')
        WHERE id = ? AND koinkat_account_id = ?`,
      [cleanedNote, parentId, koinkatAccountId],
    );
  });

  const row = await requireTransactionRow(parentId);
  return toTransaction(row);
}

/**
 * Summary of open splits - used by the Dashboard callout ("N open splits,
 * €XX still owed to you") and the "Show only open splits" filter chip.
 *
 * `uncoveredByCurrency` is keyed by the parent account's currency and
 * holds the sum of (gross − net) per currency. For a simple EUR-only
 * setup this collapses to a single-entry record, but multi-currency
 * users will see per-currency entries and the UI can pick either to
 * surface natively or to convert at display time.
 */
export interface OpenSplitsSummary {
  count: number;
  /** { [currency]: total uncovered amount } */
  uncoveredByCurrency: Record<string, string>;
  /** IDs of open split parents (for feeding "show only" filters). */
  ids: string[];
}

/**
 * Count bank-pending transactions in the active workspace. Used by the
 * Dashboard to show a subtle "includes N pending" note next to the balance.
 * The displayed balance already reflects pending (it comes from the bank's
 * AVAILABLE figure), so this is a presentation-only hint - it does NOT add to
 * any total.
 */
export async function countPendingTransactions(): Promise<number> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n
       FROM transactions
      WHERE koinkat_account_id = ?
        AND status = 'pending'`,
    [koinkatAccountId],
  );
  return rows[0]?.n ?? 0;
}

export async function getOpenSplitsSummary(): Promise<OpenSplitsSummary> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<
    {
      id: string;
      amount_in_account_ccy: string;
      net_spent_in_account_ccy: string | null;
      account_currency: string;
    }[]
  >(
    `SELECT t.id,
            t.amount_in_account_ccy,
            t.net_spent_in_account_ccy,
            a.currency AS account_currency
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
      WHERE t.koinkat_account_id = ?
        AND t.split_status = 'open'`,
    [koinkatAccountId],
  );

  const uncoveredByCurrency: Record<string, Big> = {};
  for (const row of rows) {
    const net = dec(row.net_spent_in_account_ccy ?? row.amount_in_account_ccy);
    // Uncovered = gross − net = total reimbursements received back to the
    // user so far. For a split that's half-repaid, this is the "others
    // paid me back" amount; we flip it to show the remaining share the
    // user is still out-of-pocket for, which is `net` itself. The more
    // user-aligned number is: how much is the user still owed?
    //
    // That's: gross − net − (eventually more reimbursements) = 0 when
    // fully reimbursed. With the derived model we don't know how much
    // the user EXPECTS to be repaid - only what has arrived vs the gross
    // expense. So "owed to you" is better computed as (gross − net) and
    // reported as "you've recovered X so far on N open splits."
    //
    // Decision: report the NET (what the user is currently out-of-pocket
    // across open splits) since that's the most actionable "these are
    // unsettled" signal.
    const ccy = row.account_currency.toUpperCase();
    uncoveredByCurrency[ccy] = (uncoveredByCurrency[ccy] ?? new Big('0')).plus(net);
  }

  const uncoveredByCurrencyStr: Record<string, string> = {};
  for (const [ccy, sum] of Object.entries(uncoveredByCurrency)) {
    uncoveredByCurrencyStr[ccy] = qCent(sum).toFixed(2);
  }

  return {
    count: rows.length,
    uncoveredByCurrency: uncoveredByCurrencyStr,
    ids: rows.map((r) => r.id),
  };
}

/**
 * Flag an existing expense row as a split parent in one shot.
 *
 * Combines the behaviors the Review-page wizard needs in a single atomic
 * operation:
 *   - If the row is not already a split, flip split_status='open',
 *     initialize net_spent_in_account_ccy = amount_in_account_ccy, and
 *     prepend the "[Split]" marker to the note.
 *   - Assign the chosen category (null clears it).
 *   - Mark the row as user-confirmed so it leaves the review queue.
 *
 * Idempotent with convertToSplit: calling this on a row that's already
 * a split just updates its category + confirmation state.
 */
export async function flagExpenseAsSplit(
  expenseId: string,
  categoryId: string | null,
): Promise<Transaction> {
  const txn = await requireTransactionRow(expenseId);
  if (txn.type !== 'expense') {
    throw new Error('Only expense rows can become split expenses');
  }
  // Bank-pending rows can't be split (see convertToSplit).
  if (txn.status === 'pending') {
    throw new Error('Cannot split a bank-pending transaction until it settles');
  }
  const db = await getDb();
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const manualSource: CategorizationSource = 'user_manual';

  if (txn.split_status == null) {
    // First-time flag: flip the split state + prepend marker + init net.
    await db.execute(
      `UPDATE transactions
          SET split_status = 'open',
              net_spent_in_account_ccy = ?,
              note = ?,
              category_id = ?,
              categorization_source = ?,
              needs_review = 0,
              confirmed_at = datetime('now'),
              updated_at = datetime('now')
        WHERE id = ? AND koinkat_account_id = ?`,
      [
        txn.amount_in_account_ccy,
        prependSplitMarker(txn.note ?? null),
        categoryId,
        manualSource,
        expenseId,
        koinkatAccountId,
      ],
    );
  } else {
    // Already a split - just update category + confirm it out of review.
    await db.execute(
      `UPDATE transactions
          SET category_id = ?,
              categorization_source = ?,
              needs_review = 0,
              confirmed_at = datetime('now'),
              updated_at = datetime('now')
        WHERE id = ? AND koinkat_account_id = ?`,
      [categoryId, manualSource, expenseId, koinkatAccountId],
    );
  }

  const row = await requireTransactionRow(expenseId);
  return toTransaction(row);
}

/**
 * Relabel existing income rows as repayments of a split parent.
 *
 * Does NOT touch balances - the incomes already landed on their
 * destination accounts when they were imported. This function only
 * changes aggregation semantics: the rows are now excluded from
 * category/budget income totals (via the relation_kind filter) and
 * counted against the parent's net spent.
 *
 * Also confirms each income out of the review queue. After all links
 * are made, recomputes the parent's net_spent_in_account_ccy once.
 */
export async function linkIncomesAsRepayments(
  parentId: string,
  incomeIds: string[],
): Promise<{ linked: Transaction[] }> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const parent = await requireTransactionRow(parentId);
  if (parent.split_status == null) {
    throw new Error(
      'Parent is not a split expense. Call flagExpenseAsSplit first.',
    );
  }
  if (parent.type !== 'expense') {
    throw new Error('Parent must be an expense row');
  }
  if (incomeIds.length === 0) {
    return { linked: [] };
  }

  // Validate each income row UPFRONT so we don't BEGIN, partially commit,
  // and then throw mid-loop. requireTransactionRow is workspace-scoped,
  // so cross-workspace ids fail here.
  for (const incomeId of incomeIds) {
    const income = await requireTransactionRow(incomeId);
    if (income.type !== 'income') {
      throw new Error(`Row ${incomeId} is not an income transaction`);
    }
    if (income.relation_kind != null) {
      throw new Error(
        `Row ${incomeId} is already linked (relation_kind=${income.relation_kind})`,
      );
    }
  }

  const manualSource: CategorizationSource = 'user_manual';
  const linked: Transaction[] = [];

  await withTransaction(async (tx) => {
    for (const incomeId of incomeIds) {
      // Relabel only. Balance is already correct - the income row moved
      // the destination account's balance at import time.
      await tx.execute(
        `UPDATE transactions
            SET relation_kind = 'repayment',
                related_transaction_id = ?,
                category_id = NULL,
                categorization_source = ?,
                needs_review = 0,
                confirmed_at = datetime('now'),
                updated_at = datetime('now')
          WHERE id = ? AND koinkat_account_id = ?`,
        [parentId, manualSource, incomeId, koinkatAccountId],
      );
      const refreshed = await requireTransactionRow(incomeId, tx);
      linked.push(toTransaction(refreshed));
    }

    // One pass at the end - cheaper than recomputing per-row and gives a
    // consistent final value even if multiple incomes were linked.
    await recomputeSplitNet(parentId, tx);
  });

  return { linked };
}

/** List a split parent's repayment rows, ordered by date ascending. */
export async function listSplitRepayments(
  parentId: string,
): Promise<Transaction[]> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<TransactionRow[]>(
    `SELECT * FROM transactions
      WHERE related_transaction_id = ?
        AND koinkat_account_id = ?
        AND relation_kind = 'repayment'
      ORDER BY date ASC, recorded_at ASC`,
    [parentId, koinkatAccountId],
  );
  return rows.map(toTransaction);
}

/* ── External (untracked) reimbursements - Phase 3 ───────────────────── */

export interface AddExternalReimbursementParams {
  amount: string;
  currency: string;
  date?: string;
  source?: string | null;
  note?: string | null;
}

/**
 * Add an external reimbursement - a repayment via a rail the user doesn't
 * track in Koinkat (PayPal, MobilePay, cash). Does NOT touch any account
 * balance, but DOES reduce the parent's net spent via recomputeSplitNet.
 *
 * The amount is pre-converted into the parent account's currency at
 * insert time, so `recomputeSplitNet` can sum the stored values without
 * re-converting every time.
 */
export async function addExternalReimbursement(
  parentId: string,
  params: AddExternalReimbursementParams,
): Promise<SplitExternalReimbursement> {
  const parent = await requireTransactionRow(parentId);
  if (parent.split_status == null) {
    throw new Error('Parent transaction is not a split expense');
  }
  const parentAccount = await requireAccount(parent.account_id);
  const parentCcy = parentAccount.currency.toUpperCase();

  const amt = requirePositiveAmount(params.amount);
  const ccy = ensureCurrency(params.currency);
  const date = params.date ?? format(new Date(), 'yyyy-MM-dd');

  // Convert to parent account currency using the date's rate snapshot
  // - keeps the FX choice consistent with how regular income rows are
  // recorded, so a repayment dated in the past reflects that day's rate.
  let amountInParentCcy: Big;
  let rate: Big;
  if (ccy === parentCcy) {
    amountInParentCcy = amt;
    rate = dec('1');
  } else {
    const rates = await requireRates(date);
    const { converted } = convertAmount(amt, ccy, parentCcy, rates);
    amountInParentCcy = converted;
    rate = amt.gt(dec('0')) ? qRate(converted.div(amt)) : qRate(dec('1'));
  }

  const koinkatAccountId = requireActiveKoinkatAccountId();
  const id = crypto.randomUUID();
  await withTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO split_external_reimbursements
         (id, koinkat_account_id, parent_transaction_id, amount, currency,
          amount_in_parent_ccy, exchange_rate, date, source, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        koinkatAccountId,
        parentId,
        amt.toFixed(2),
        ccy,
        qCent(amountInParentCcy).toFixed(2),
        rate.toFixed(4),
        date,
        params.source ?? null,
        params.note ?? null,
      ],
    );

    await recomputeSplitNet(parentId, tx);
  });

  const db = await getDb();
  const rows = await db.select<SplitExternalReimbursementRow[]>(
    'SELECT * FROM split_external_reimbursements WHERE id = ? AND koinkat_account_id = ?',
    [id, koinkatAccountId],
  );
  return toSplitExternalReimbursement(rows[0]);
}

export async function deleteExternalReimbursement(id: string): Promise<boolean> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<SplitExternalReimbursementRow[]>(
    'SELECT * FROM split_external_reimbursements WHERE id = ? AND koinkat_account_id = ?',
    [id, koinkatAccountId],
  );
  if (rows.length === 0) return false;
  const parentId = rows[0].parent_transaction_id;
  await withTransaction(async (tx) => {
    await tx.execute(
      'DELETE FROM split_external_reimbursements WHERE id = ? AND koinkat_account_id = ?',
      [id, koinkatAccountId],
    );
    await recomputeSplitNet(parentId, tx);
  });
  return true;
}

export async function listExternalReimbursements(
  parentId: string,
): Promise<SplitExternalReimbursement[]> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<SplitExternalReimbursementRow[]>(
    `SELECT * FROM split_external_reimbursements
      WHERE parent_transaction_id = ?
        AND koinkat_account_id = ?
      ORDER BY date ASC, created_at ASC`,
    [parentId, koinkatAccountId],
  );
  return rows.map(toSplitExternalReimbursement);
}

/* ── SELECT helpers ──────────────────────────────────────────────────── */

const JOINED_SELECT = `
  t.*,
  c.name         AS category_name,
  c.type         AS category_type,
  c.parent_id    AS category_parent_id,
  c.icon         AS category_icon,
  c.color        AS category_color,
  c.is_system    AS category_is_system,
  c.sort_order   AS category_sort_order,
  a.name         AS account_name,
  a.currency     AS account_currency,
  a.color        AS account_color,
  da.name        AS dest_account_name,
  da.currency    AS dest_account_currency,
  da.color       AS dest_account_color
`;

const JOINED_FROM = `
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN accounts a ON a.id = t.account_id
  LEFT JOIN accounts da ON da.id = t.destination_account_id
`;

/**
 * Fetch a single transaction by ID with joined category + account info.
 */
export async function getTransactionById(id: string): Promise<Transaction | null> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const rows = await db.select<TransactionJoinedRow[]>(
    `SELECT ${JOINED_SELECT} ${JOINED_FROM}
     WHERE t.id = ? AND t.koinkat_account_id = ?`,
    [id, koinkatAccountId],
  );

  if (rows.length === 0) return null;
  return toTransactionWithJoins(rows[0]);
}

/**
 * List transactions with filtering, sorting, and pagination.
 */
export async function listTransactions(
  filters: ListTransactionsFilters = {},
): Promise<PaginatedTransactions> {
  const koinkatAccountId = requireActiveKoinkatAccountId();
  const db = await getDb();
  const page = Math.max(filters.page ?? 1, 1);
  const perPage = Math.min(Math.max(filters.perPage ?? 20, 1), 100);
  const sortBy = filters.sortBy ?? 'date';
  const sortDir = filters.sortDir ?? 'desc';

  // Build WHERE clauses - always scope by profile
  const whereClauses: string[] = ['t.koinkat_account_id = ?'];
  const whereParams: unknown[] = [koinkatAccountId];

  if (filters.accountId) {
    whereClauses.push('(t.account_id = ? OR t.destination_account_id = ?)');
    whereParams.push(filters.accountId, filters.accountId);
  }

  if (filters.type) {
    if (filters.type === 'income_expense') {
      whereClauses.push("t.type IN ('income', 'expense')");
    } else {
      whereClauses.push('t.type = ?');
      whereParams.push(filters.type);
    }
  }

  if (filters.year != null && filters.month != null) {
    // Filter by year-month range
    const startDate = `${filters.year}-${String(filters.month).padStart(2, '0')}-01`;
    const nextMonth = filters.month === 12 ? 1 : filters.month + 1;
    const nextYear = filters.month === 12 ? filters.year + 1 : filters.year;
    const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
    whereClauses.push('t.date >= ? AND t.date < ?');
    whereParams.push(startDate, endDate);
  } else if (filters.year != null) {
    const startDate = `${filters.year}-01-01`;
    const endDate = `${filters.year + 1}-01-01`;
    whereClauses.push('t.date >= ? AND t.date < ?');
    whereParams.push(startDate, endDate);
  }

  if (filters.categoryId) {
    whereClauses.push('t.category_id = ?');
    whereParams.push(filters.categoryId);
  }

  if (filters.macroCategoryId) {
    // Match the macro directly OR any of its subcategories. The subquery is
    // workspace-scoped too (invariant #2) - the outer query already filters
    // t.koinkat_account_id, but the category tree lookup must not match a
    // sibling workspace's hierarchy.
    whereClauses.push(
      '(t.category_id = ? OR t.category_id IN (SELECT id FROM categories WHERE parent_id = ? AND koinkat_account_id = ?))',
    );
    whereParams.push(filters.macroCategoryId, filters.macroCategoryId, koinkatAccountId);
  }

  if (filters.uncategorized) {
    whereClauses.push('t.category_id IS NULL');
  }

  if (filters.needsReview) {
    whereClauses.push('t.needs_review = 1');
  }

  if (filters.openSplitsOnly) {
    whereClauses.push("t.split_status = 'open'");
  }

  if (filters.splitsOnly) {
    whereClauses.push('t.split_status IS NOT NULL');
  }

  if (filters.recurring) {
    whereClauses.push('t.recurring_series_id IS NOT NULL');
  }

  if (filters.status) {
    whereClauses.push('t.status = ?');
    whereParams.push(filters.status);
  }

  if (filters.unlinkedIncomesOnly) {
    whereClauses.push("t.type = 'income'");
    whereClauses.push('t.relation_kind IS NULL');
    whereClauses.push('t.transfer_pair_id IS NULL');
  }

  const whereSQL = whereClauses.length > 0
    ? 'WHERE ' + whereClauses.join(' AND ')
    : '';

  // Count total. Skipped for single-page consumers (drawers) that never
  // paginate - counting the whole table to render a fixed page is wasted
  // work; `total` then reflects only the rows returned.
  let total = 0;
  if (!filters.skipCount) {
    const countRows = await db.select<{ cnt: number }[]>(
      `SELECT COUNT(*) AS cnt FROM transactions t ${whereSQL}`,
      whereParams,
    );
    total = countRows[0].cnt;
  }

  // Build ORDER BY
  const dir = sortDir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  let orderSQL: string;
  switch (sortBy) {
    case 'amount':
      orderSQL = `ORDER BY CAST(t.amount_in_account_ccy AS REAL) ${dir}, t.id DESC`;
      break;
    case 'recorded':
      orderSQL = `ORDER BY t.recorded_at ${dir}, t.id DESC`;
      break;
    default:
      orderSQL = `ORDER BY t.date ${dir}, t.id DESC`;
      break;
  }

  const offset = (page - 1) * perPage;
  const queryParams = [...whereParams, perPage, offset];

  const rows = await db.select<TransactionJoinedRow[]>(
    `SELECT ${JOINED_SELECT} ${JOINED_FROM}
     ${whereSQL}
     ${orderSQL}
     LIMIT ? OFFSET ?`,
    queryParams,
  );

  // totalPages derives from the FINAL total (rows.length under skipCount,
  // where it is always 1 since rows.length <= perPage) so the returned
  // pair can never disagree.
  const finalTotal = filters.skipCount ? rows.length : total;
  const totalPages = Math.max(Math.ceil(finalTotal / perPage), 1);

  return {
    transactions: rows.map(toTransactionWithJoins),
    total: finalTotal,
    page,
    perPage,
    totalPages,
  };
}
