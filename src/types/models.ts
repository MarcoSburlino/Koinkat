import { DEFAULT_CALLBACK_URL } from '../lib/constants';
import type {
  TransactionType,
  CategoryType,
  CategorizationSource,
  BudgetRhythm,
  Theme,
  DecimalSeparator,
  ConnectionStatus,
  BankEnvironment,
  ConnectionType,
  SplitStatus,
  RelationKind,
  TransactionStatus,
  RecurrenceCadence,
  RecurringStatus,
  RecurringSeriesSource,
} from './enums';

// ── Enum validation helpers ─────────────────────────────────────────────

function parseEnum<T extends string>(
  val: string,
  valid: readonly T[],
  label: string,
): T {
  if ((valid as readonly string[]).includes(val)) return val as T;
  throw new Error(`Unknown ${label} value: "${val}"`);
}

function parseEnumNullable<T extends string>(
  val: string | null,
  valid: readonly T[],
  label: string,
): T | null {
  if (val === null) return null;
  return parseEnum(val, valid, label);
}

const TRANSACTION_TYPES: readonly TransactionType[] = ['income', 'expense', 'transfer'];
const CATEGORY_TYPES: readonly CategoryType[] = ['income', 'expense'];
const DECIMAL_SEPARATORS: readonly DecimalSeparator[] = ['.', ','];
const THEMES: readonly Theme[] = ['light', 'dark'];
const CONNECTION_STATUSES: readonly ConnectionStatus[] = ['pending', 'active', 'expired', 'error'];
const BANK_ENVIRONMENTS: readonly BankEnvironment[] = ['sandbox', 'production'];
const CONNECTION_TYPES: readonly ConnectionType[] = ['manual', 'sandbox', 'linked'];
const CATEGORIZATION_SOURCES: readonly CategorizationSource[] = [
  'rule_auto', 'mcc_auto', 'user_confirmed', 'user_manual', 'user_corrected',
];
const SPLIT_STATUSES: readonly SplitStatus[] = ['open', 'settled'];
const RELATION_KINDS: readonly RelationKind[] = ['fee', 'repayment'];
const TRANSACTION_STATUSES: readonly TransactionStatus[] = ['pending', 'booked'];
const RECURRENCE_CADENCES: readonly RecurrenceCadence[] = ['weekly', 'monthly', 'yearly'];
const RECURRING_STATUSES: readonly RecurringStatus[] = ['active', 'paused', 'ended'];
const RECURRING_SERIES_SOURCES: readonly RecurringSeriesSource[] = ['user', 'auto_suggested'];

// ── Clean interfaces (used throughout the app) ──────────────────────────

export interface Account {
  id: string;
  name: string;
  currency: string;
  color: string;
  currentBalance: string;
  isPinned: boolean;
  isManual: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  id: string;
  accountId: string;
  destinationAccountId: string | null;
  relatedTransactionId: string | null;
  type: TransactionType;
  amount: string;
  currency: string;
  exchangeRate: string;
  amountInAccountCcy: string;
  amountInDestCcy: string | null;
  categoryId: string | null;
  note: string | null;
  date: string;
  isBudgeted: boolean;
  budgetEventId: string | null;
  recordedAt: string;
  createdAt: string;
  updatedAt: string;
  /**
   * UUID linking the two rows of a confirmed transfer pair (when bank
   * imports created an income on one account and an expense on another
   * for the same transfer). Two rows sharing this UUID are one transfer.
   * Null = not part of a transfer pair.
   */
  transferPairId: string | null;
  /**
   * Timestamp the user took action on a transfer-detection suggestion
   * involving this row (confirm or dismiss). Null = never reviewed.
   * The detector only suggests rows that are still null here.
   */
  transferReviewedAt: string | null;
  // Categorization tracking (Phase 5 populates these)
  categorizationSource: CategorizationSource | null;
  appliedRuleId: string | null;
  needsReview: boolean;
  confirmedAt: string | null;
  merchantRaw: string | null;
  merchantNormalized: string | null;
  merchantCategoryCode: string | null;
  /**
   * Split expense state (Feature 1). Non-null only on parent expense
   * rows the user has opted into splitting with others. See
   * transaction-service.ts for lifecycle + invariants.
   */
  splitStatus: SplitStatus | null;
  /**
   * Discriminator for rows linked via relatedTransactionId. 'fee' for
   * child fee rows, 'repayment' for repayments against a split parent.
   * Null on plain rows or on split parents themselves.
   */
  relationKind: RelationKind | null;
  /**
   * Derived net expense in the parent account's currency - gross minus
   * the sum of repayments converted into the parent's currency. Service-
   * maintained. Non-null iff splitStatus is non-null. Aggregation
   * queries COALESCE this against amountInAccountCcy.
   */
  netSpentInAccountCcy: string | null;
  /**
   * Bank-import provenance: the raw joined remittance text exactly as
   * received from the bank. Null on manually-created rows and on legacy
   * rows imported before migration v9.
   */
  sourceDescription: string | null;
  /**
   * Bank-import provenance: the bank's booking date verbatim, preserved
   * because `date` now uses txn.transactionDate (value date) when
   * present. Null on manually-created rows and on legacy rows imported
   * before migration v9.
   */
  bookingDate: string | null;
  /**
   * Per-transaction pin for the budget-event link. Set to 1 whenever the
   * user manually picks or clears `budgetEventId` via the UI. Auto-
   * capture sweeps skip pinned rows in both directions (won't link,
   * won't unlink). Default false.
   */
  eventLinkPinned: boolean;
  /**
   * Bank-settlement status (migration v10). 'booked' for every existing,
   * manual, and settled row; 'pending' for a bank charge imported before
   * it settles. Pending rows are balance-neutral and excluded from all
   * aggregations until they flip to 'booked' in place.
   */
  status: TransactionStatus;
  /**
   * The bank's API transaction id for this entry, kept to help re-match a
   * pending row to its later booked entry. Banks often change it between
   * pending and booked, so it's a hint, not a sole key. Null on manual /
   * legacy rows.
   */
  bankTransactionId: string | null;
  /**
   * ISO timestamp bumped every sync a pending row is still present in the
   * bank's pending set. Used for disappearance detection (auto-removal).
   * Null once booked, and on manual / legacy rows.
   */
  pendingLastSeenAt: string | null;
  /**
   * Deterministic hash used to re-match the same pending entry across
   * syncs when it lacks a stable bank id. Cleared when the row books.
   * Null on manual / legacy rows. See computePendingFingerprint.
   */
  pendingFingerprint: string | null;
  /**
   * Recurring expense series this row belongs to (migration v11), or null.
   * Orthogonal to categoryId - a row keeps its normal category and may
   * also link to a series. Set silently by the importer on a confident
   * match, or by the user via the Recurring toggle.
   */
  recurringSeriesId: string | null;
  /**
   * Per-transaction lock for the recurring-series link. Set true whenever
   * the user manually sets or clears `recurringSeriesId` (mirrors
   * eventLinkPinned). Auto-matching never overrides a locked row.
   */
  recurringLocked: boolean;
  // Joined fields (optional)
  category?: Category;
  account?: Account;
  destinationAccount?: Account;
}

export interface Category {
  id: string;
  name: string;
  type: CategoryType;
  parentId: string | null;
  icon: string | null;
  color: string | null;
  isSystem: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  /**
   * Populated only when loading via `listCategoryTree()` - the macro
   * row's children array holds its user-created subcategories.
   */
  children?: Category[];
}

export interface RecurringBudget {
  id: string;
  year: number;
  startMonth: number;
  endMonth: number;
  rhythm: BudgetRhythm;
  limitAmount: string;
  currency: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetPeriod {
  id: string;
  recurringBudgetId: string;
  periodStart: string;
  periodEnd: string;
  limitAmount: string;
  currency: string;
  isCustomized: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetEvent {
  id: string;
  name: string;
  description: string | null;
  limitAmount: string;
  currency: string;
  isExpired: boolean;
  /** ISO date YYYY-MM-DD or null. Null together with endDate = "undated". */
  startDate: string | null;
  /** ISO date YYYY-MM-DD or null. Must be set iff startDate is set. */
  endDate: string | null;
  /** When true, this event folds into one recurring-budget month's spending. */
  sumToBudget: boolean;
  /** Target month as YYYY-MM-01. Required when sumToBudget is true. */
  sumToMonth: string | null;
  /**
   * When true, the picker's date-based pre-fill (getMatchingEventsForDate)
   * skips this event regardless of its date range. Transactions must be
   * linked explicitly via the picker. Default false.
   */
  manualOnly: boolean;
  /**
   * When true (and the event is dated + active), in-range expense
   * transactions are linked automatically by applyAutoCaptureForEvent /
   * applyAutoCaptureForTransaction. Manually-pinned links are always
   * preserved. Default false.
   */
  autoCapture: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * A recurring expense commitment (rent, transit pass, streaming, …).
 * Identity is `merchantNormalized + cadence`; `expectedAmount` is a tracked
 * attribute that can change (a price change still matches the same series).
 * See recurring-service.ts for the matcher, self-correction, and the two
 * groupings on Analysis / Budgets.
 */
export interface RecurringSeries {
  id: string;
  /** Identity anchor - the normalized merchant key. */
  merchantNormalized: string;
  /** User-friendly label (defaults from the merchant). */
  displayName: string;
  cadence: RecurrenceCadence;
  /** Learned/expected gap in days; self-corrects after a 2nd charge. */
  intervalDays: number;
  /** Optional linked/suggested category applied on a confident match. */
  categoryId: string | null;
  /** Latest expected amount (money string), or null until first charge. */
  expectedAmount: string | null;
  currency: string | null;
  status: RecurringStatus;
  lastChargeDate: string | null;
  nextExpectedDate: string | null;
  matchCount: number;
  lastMatchedAt: string | null;
  source: RecurringSeriesSource;
  createdAt: string;
  updatedAt: string;
}

export interface Settings {
  preferredCurrency: string;
  decimalSeparator: DecimalSeparator;
  theme: Theme;
}

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

export interface KoinkatAccount {
  id: string;
  userId: string;
  name: string;
  connectionType: ConnectionType;
  preferredCurrency: string;
  decimalSeparator: DecimalSeparator;
  theme: Theme;
  createdAt: string;
  updatedAt: string;
}

export interface ApiConfig {
  appId: string | null;
  privateKeyPem: string | null;
  environment: BankEnvironment;
  redirectUrl: string;
  isConfigured: boolean;
  isDemoMode: boolean;
}

export interface BankConnection {
  id: string;
  provider: string;
  aspspName: string;
  aspspCountry: string;
  sessionId: string | null;
  authorizationId: string | null;
  status: ConnectionStatus;
  validUntil: string | null;
  lastSyncedAt: string | null;
  errorMessage: string | null;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LinkedAccount {
  id: string;
  bankConnectionId: string;
  accountId: string;
  externalAccountUid: string;
  iban: string | null;
  lastSyncedAt: string | null;
  syncCursor: string | null;
  /**
   * User-chosen floor for the initial transaction sync. ISO YYYY-MM-DD.
   * Null = legacy row; fall back to the 180-day default. See
   * bank-sync-service.ts `syncTransactions` for usage.
   */
  syncStartDate: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Raw DB row types (snake_case from SQLite) ───────────────────────────

export interface AccountRow {
  id: string;
  name: string;
  currency: string;
  color: string;
  current_balance: string;
  is_pinned: number;
  is_manual: number;
  created_at: string;
  updated_at: string;
}

export interface CategoryRow {
  id: string;
  koinkat_account_id: string;
  name: string;
  type: string;
  parent_id: string | null;
  icon: string | null;
  color: string | null;
  is_system: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface SettingsRow {
  id: number;
  preferred_currency: string;
  decimal_separator: string;
  theme: string;
  created_at: string;
  updated_at: string;
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  created_at: string;
  updated_at: string;
}

export interface KoinkatAccountRow {
  id: string;
  user_id: string;
  name: string;
  connection_type: string;
  preferred_currency: string;
  decimal_separator: string;
  theme: string;
  created_at: string;
  updated_at: string;
}

export interface TransactionRow {
  id: string;
  account_id: string;
  destination_account_id: string | null;
  related_transaction_id: string | null;
  type: string;
  amount: string;
  currency: string;
  exchange_rate: string;
  amount_in_account_ccy: string;
  amount_in_dest_ccy: string | null;
  category_id: string | null;
  note: string | null;
  date: string;
  is_budgeted: number;
  budget_event_id: string | null;
  recorded_at: string;
  created_at: string;
  updated_at: string;
  transfer_pair_id: string | null;
  transfer_reviewed_at: string | null;
  categorization_source: string | null;
  applied_rule_id: string | null;
  needs_review: number;
  confirmed_at: string | null;
  merchant_raw: string | null;
  merchant_normalized: string | null;
  merchant_category_code: string | null;
  split_status: string | null;
  relation_kind: string | null;
  net_spent_in_account_ccy: string | null;
  source_description: string | null;
  booking_date: string | null;
  event_link_pinned: number;
  status: string;
  bank_transaction_id: string | null;
  pending_last_seen_at: string | null;
  pending_fingerprint: string | null;
  recurring_series_id: string | null;
  recurring_locked: number;
}

export interface ApiConfigRow {
  koinkat_account_id: string;
  app_id: string | null;
  private_key_pem: string | null;
  environment: string;
  redirect_url: string;
  is_configured: number;
  is_demo_mode: number;
  created_at: string;
  updated_at: string;
}

export interface BankConnectionRow {
  id: string;
  provider: string;
  aspsp_name: string;
  aspsp_country: string;
  session_id: string | null;
  authorization_id: string | null;
  status: string;
  valid_until: string | null;
  last_synced_at: string | null;
  error_message: string | null;
  is_demo: number;
  created_at: string;
  updated_at: string;
}

export interface LinkedAccountRow {
  id: string;
  bank_connection_id: string;
  account_id: string;
  external_account_uid: string;
  iban: string | null;
  last_synced_at: string | null;
  sync_cursor: string | null;
  sync_start_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface SplitExternalReimbursement {
  id: string;
  parentTransactionId: string;
  /** Amount in the native currency of the repayment (what the friend actually sent). */
  amount: string;
  /** ISO 4217 of the native amount. */
  currency: string;
  /** Amount converted to the parent expense's account currency. Pre-computed at write time. */
  amountInParentCcy: string;
  /** FX rate used for amountInParentCcy = amount * exchangeRate (approximate, for display). */
  exchangeRate: string;
  /** ISO date YYYY-MM-DD. */
  date: string;
  /** Free-text label - "PayPal", "MobilePay", "cash", etc. */
  source: string | null;
  /** Optional note (who paid, reference etc.). */
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SplitExternalReimbursementRow {
  id: string;
  koinkat_account_id: string;
  parent_transaction_id: string;
  amount: string;
  currency: string;
  amount_in_parent_ccy: string;
  exchange_rate: string;
  date: string;
  source: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export function toSplitExternalReimbursement(
  row: SplitExternalReimbursementRow,
): SplitExternalReimbursement {
  return {
    id: row.id,
    parentTransactionId: row.parent_transaction_id,
    amount: row.amount,
    currency: row.currency,
    amountInParentCcy: row.amount_in_parent_ccy,
    exchangeRate: row.exchange_rate,
    date: row.date,
    source: row.source,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface BudgetEventRow {
  id: string;
  koinkat_account_id: string;
  name: string;
  description: string | null;
  limit_amount: string;
  currency: string;
  is_expired: number;
  start_date: string | null;
  end_date: string | null;
  sum_to_budget: number;
  sum_to_month: string | null;
  manual_only: number;
  auto_capture: number;
  created_at: string;
  updated_at: string;
}

export interface RecurringSeriesRow {
  id: string;
  koinkat_account_id: string;
  merchant_normalized: string;
  display_name: string;
  cadence: string;
  interval_days: number;
  category_id: string | null;
  expected_amount: string | null;
  currency: string | null;
  status: string;
  last_charge_date: string | null;
  next_expected_date: string | null;
  match_count: number;
  last_matched_at: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

// ── Mapper functions ────────────────────────────────────────────────────

export function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    currency: row.currency,
    color: row.color,
    currentBalance: row.current_balance,
    isPinned: row.is_pinned === 1,
    isManual: row.is_manual === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    type: parseEnum(row.type, CATEGORY_TYPES, 'CategoryType'),
    parentId: row.parent_id,
    icon: row.icon,
    color: row.color,
    isSystem: row.is_system === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toSettings(row: SettingsRow): Settings {
  return {
    preferredCurrency: row.preferred_currency,
    decimalSeparator: parseEnum(row.decimal_separator, DECIMAL_SEPARATORS, 'DecimalSeparator'),
    theme: parseEnum(row.theme, THEMES, 'Theme'),
  };
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toKoinkatAccount(row: KoinkatAccountRow): KoinkatAccount {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    connectionType: parseEnum(row.connection_type, CONNECTION_TYPES, 'ConnectionType'),
    preferredCurrency: row.preferred_currency,
    decimalSeparator: parseEnum(row.decimal_separator, DECIMAL_SEPARATORS, 'DecimalSeparator'),
    theme: parseEnum(row.theme, THEMES, 'Theme'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toApiConfig(row: ApiConfigRow): ApiConfig {
  return {
    appId: row.app_id,
    privateKeyPem: row.private_key_pem,
    environment: parseEnum(row.environment, BANK_ENVIRONMENTS, 'BankEnvironment'),
    redirectUrl: row.redirect_url,
    isConfigured: row.is_configured === 1,
    isDemoMode: row.is_demo_mode === 1,
  };
}

export const EMPTY_API_CONFIG: ApiConfig = {
  appId: null,
  privateKeyPem: null,
  environment: 'production',
  // Defaults to Koinkat's shared callback page (see constants.ts). The
  // user still registers this exact URL on their own EB application, and
  // may replace it with a self-hosted page. Never default to the
  // koinkat:// deep-link constant here - EB rejects non-https:// redirect
  // URLs with REDIRECT_URI_NOT_ALLOWED.
  redirectUrl: DEFAULT_CALLBACK_URL,
  isConfigured: false,
  isDemoMode: false,
};

export function toBankConnection(row: BankConnectionRow): BankConnection {
  return {
    id: row.id,
    provider: row.provider,
    aspspName: row.aspsp_name,
    aspspCountry: row.aspsp_country,
    sessionId: row.session_id,
    authorizationId: row.authorization_id,
    status: parseEnum(row.status, CONNECTION_STATUSES, 'ConnectionStatus'),
    validUntil: row.valid_until,
    lastSyncedAt: row.last_synced_at,
    errorMessage: row.error_message,
    isDemo: row.is_demo === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toLinkedAccount(row: LinkedAccountRow): LinkedAccount {
  return {
    id: row.id,
    bankConnectionId: row.bank_connection_id,
    accountId: row.account_id,
    externalAccountUid: row.external_account_uid,
    iban: row.iban,
    lastSyncedAt: row.last_synced_at,
    syncCursor: row.sync_cursor,
    syncStartDate: row.sync_start_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toBudgetEvent(row: BudgetEventRow): BudgetEvent {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    limitAmount: row.limit_amount,
    currency: row.currency,
    isExpired: row.is_expired === 1,
    startDate: row.start_date,
    endDate: row.end_date,
    sumToBudget: row.sum_to_budget === 1,
    sumToMonth: row.sum_to_month,
    manualOnly: row.manual_only === 1,
    autoCapture: row.auto_capture === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toRecurringSeries(row: RecurringSeriesRow): RecurringSeries {
  return {
    id: row.id,
    merchantNormalized: row.merchant_normalized,
    displayName: row.display_name,
    cadence: parseEnum(row.cadence, RECURRENCE_CADENCES, 'RecurrenceCadence'),
    intervalDays: row.interval_days,
    categoryId: row.category_id ?? null,
    expectedAmount: row.expected_amount ?? null,
    currency: row.currency ?? null,
    status: parseEnum(row.status, RECURRING_STATUSES, 'RecurringStatus'),
    lastChargeDate: row.last_charge_date ?? null,
    nextExpectedDate: row.next_expected_date ?? null,
    matchCount: row.match_count,
    lastMatchedAt: row.last_matched_at ?? null,
    source: parseEnum(row.source, RECURRING_SERIES_SOURCES, 'RecurringSeriesSource'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    accountId: row.account_id,
    destinationAccountId: row.destination_account_id,
    relatedTransactionId: row.related_transaction_id,
    type: parseEnum(row.type, TRANSACTION_TYPES, 'TransactionType'),
    amount: row.amount,
    currency: row.currency,
    exchangeRate: row.exchange_rate,
    amountInAccountCcy: row.amount_in_account_ccy,
    amountInDestCcy: row.amount_in_dest_ccy,
    categoryId: row.category_id,
    note: row.note,
    date: row.date,
    isBudgeted: row.is_budgeted === 1,
    budgetEventId: row.budget_event_id,
    recordedAt: row.recorded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    transferPairId: row.transfer_pair_id ?? null,
    transferReviewedAt: row.transfer_reviewed_at ?? null,
    categorizationSource: parseEnumNullable(row.categorization_source, CATEGORIZATION_SOURCES, 'CategorizationSource'),
    appliedRuleId: row.applied_rule_id ?? null,
    needsReview: row.needs_review === 1,
    confirmedAt: row.confirmed_at ?? null,
    merchantRaw: row.merchant_raw ?? null,
    merchantNormalized: row.merchant_normalized ?? null,
    merchantCategoryCode: row.merchant_category_code ?? null,
    splitStatus: parseEnumNullable(row.split_status, SPLIT_STATUSES, 'SplitStatus'),
    relationKind: parseEnumNullable(row.relation_kind, RELATION_KINDS, 'RelationKind'),
    netSpentInAccountCcy: row.net_spent_in_account_ccy ?? null,
    sourceDescription: row.source_description ?? null,
    bookingDate: row.booking_date ?? null,
    eventLinkPinned: row.event_link_pinned === 1,
    status: parseEnum(row.status ?? 'booked', TRANSACTION_STATUSES, 'TransactionStatus'),
    bankTransactionId: row.bank_transaction_id ?? null,
    pendingLastSeenAt: row.pending_last_seen_at ?? null,
    pendingFingerprint: row.pending_fingerprint ?? null,
    recurringSeriesId: row.recurring_series_id ?? null,
    recurringLocked: row.recurring_locked === 1,
  };
}
