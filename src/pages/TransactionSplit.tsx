import { UPPERCASE_LABEL,UPPERCASE_LABEL_SM } from '../lib/label-styles';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type Big from 'big.js';
import { ArrowLeft, Trash2, Plus, Link2, Search } from 'lucide-react';
import { dec } from '../domain/money';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { CurrencyPicker } from '../components/ui/CurrencyPicker';
import { InfoBanner } from '../components/ui/InfoBanner';
import { PageHeader } from '../components/layout/PageHeader';
import { useFormatting } from '../lib/use-formatting';
import * as transactionService from '../services/transaction-service';
import * as accountService from '../services/account-service';
import type { Account, Transaction, SplitExternalReimbursement } from '../types/models';

function todayString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function TransactionSplit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { formatAmount } = useFormatting();

  const [parent, setParent] = useState<Transaction | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [repayments, setRepayments] = useState<Transaction[]>([]);
  const [externalReps, setExternalReps] = useState<SplitExternalReimbursement[]>(
    [],
  );
  // Candidate incomes for linking - populated by listTransactions with
  // unlinkedIncomesOnly. Excludes anything already linked to any parent.
  const [candidateIncomes, setCandidateIncomes] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  // Picker state for linking an existing imported income.
  const [candidateSearch, setCandidateSearch] = useState('');
  const [linkingId, setLinkingId] = useState<string | null>(null);

  // External-repayment form state (only used when the external toggle is on).
  const [isExternal, setIsExternal] = useState(false);
  const [addSource, setAddSource] = useState('');
  const [addAmount, setAddAmount] = useState('');
  const [addCurrency, setAddCurrency] = useState('EUR');
  // Seed the external-form currency to the first account's currency exactly
  // once. Without this guard, `load()` (which re-runs after every add/delete)
  // would reset a deliberate EUR selection back to the default, because an
  // untouched default and a real EUR choice are indistinguishable.
  const currencyDefaultedRef = useRef(false);
  const [addDate, setAddDate] = useState(todayString);
  const [addNote, setAddNote] = useState('');
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);

  // Delete confirmations - repayments are Transaction rows, external
  // reimbursements are SplitExternalReimbursement rows. The UI tracks
  // both separately so the confirmation modal can route the right delete.
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null);
  const [deleteExtTarget, setDeleteExtTarget] =
    useState<SplitExternalReimbursement | null>(null);

  // "Convert to normal expense" state.
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState('');
  const [confirmConvertOpen, setConfirmConvertOpen] = useState(false);

  // "Mark settled / Reopen" in-flight guard.
  const [toggling, setToggling] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [txn, accts] = await Promise.all([
        transactionService.getTransactionById(id),
        accountService.listAccounts(),
      ]);
      setParent(txn);
      setAccounts(accts);

      if (txn && txn.splitStatus != null) {
        const [reps, ext, cands] = await Promise.all([
          transactionService.listSplitRepayments(id),
          transactionService.listExternalReimbursements(id),
          // Pull up to 100 of the most recent unlinked incomes in the
          // workspace as link candidates. A search box below narrows
          // visually; 100 is enough to cover a few months of typical
          // activity without being overwhelming.
          transactionService.listTransactions({
            unlinkedIncomesOnly: true,
            sortBy: 'date',
            sortDir: 'desc',
            perPage: 100,
          }),
        ]);
        setRepayments(reps);
        setExternalReps(ext);
        setCandidateIncomes(cands.transactions);
      }

      // Default the external-form currency to the first-account currency
      // once, so the picker isn't stuck on a nonsensical default but a
      // later user choice (including EUR) is never overwritten.
      if (!currencyDefaultedRef.current && accts.length > 0) {
        currencyDefaultedRef.current = true;
        setAddCurrency(accts[0].currency);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleLinkExistingIncome(incomeId: string) {
    if (!parent) return;
    setLinkingId(incomeId);
    setAddError('');
    try {
      await transactionService.linkIncomesAsRepayments(parent.id, [incomeId]);
      await load();
    } catch (err) {
      setAddError(
        err instanceof Error ? err.message : 'Failed to link repayment.',
      );
    } finally {
      setLinkingId(null);
    }
  }

  async function handleAddExternalReimbursement(e: React.FormEvent) {
    e.preventDefault();
    setAddError('');
    if (!parent) return;
    // Validate through big.js, never raw Number() (which accepts "1e-10" and
    // truncates "1,234"). The trimmed string - not a float - is what's stored.
    let amtPositive = false;
    try {
      amtPositive = dec(addAmount.trim()).gt(0);
    } catch {
      amtPositive = false;
    }
    if (!addAmount.trim() || !amtPositive) {
      return setAddError('Enter a positive amount.');
    }
    if (!addCurrency) return setAddError('Currency is required.');
    if (!addDate) return setAddError('Date is required.');

    setAdding(true);
    try {
      await transactionService.addExternalReimbursement(parent.id, {
        amount: addAmount.trim(),
        currency: addCurrency,
        date: addDate,
        source: addSource.trim() || null,
        note: addNote.trim() || null,
      });
      setAddAmount('');
      setAddNote('');
      setAddSource('');
      await load();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add repayment.');
    } finally {
      setAdding(false);
    }
  }

  async function handleDeleteRepayment() {
    if (!deleteTarget) return;
    try {
      await transactionService.deleteSplitRepayment(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setDeleteTarget(null);
      setAddError(
        err instanceof Error ? err.message : 'Failed to delete repayment.',
      );
    }
  }

  async function handleDeleteExternalReimbursement() {
    if (!deleteExtTarget) return;
    try {
      await transactionService.deleteExternalReimbursement(deleteExtTarget.id);
      setDeleteExtTarget(null);
      await load();
    } catch (err) {
      setDeleteExtTarget(null);
      setAddError(
        err instanceof Error ? err.message : 'Failed to delete reimbursement.',
      );
    }
  }

  async function handleToggleStatus() {
    if (!parent || toggling) return;
    setToggling(true);
    setAddError('');
    const next = parent.splitStatus === 'open' ? 'settled' : 'open';
    try {
      await transactionService.setSplitStatus(parent.id, next);
      await load();
    } catch (err) {
      setAddError(
        err instanceof Error ? err.message : 'Failed to update split status.',
      );
    } finally {
      setToggling(false);
    }
  }

  async function handleConvertToNormal() {
    if (!parent) return;
    setConverting(true);
    setConvertError('');
    try {
      await transactionService.convertFromSplit(parent.id);
      // The split detail view no longer applies - return to the edit page
      // that linked here.
      navigate(`/transactions/${parent.id}/edit`);
    } catch (err) {
      setConvertError(err instanceof Error ? err.message : String(err));
      setConverting(false);
    }
  }

  if (loading) {
    return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading...</p>;
  }

  if (!parent) {
    return <p className="text-sm" style={{ color: 'var(--danger)' }}>Transaction not found.</p>;
  }

  if (parent.splitStatus == null) {
    return (
      <div>
        <button
          onClick={() => navigate(`/transactions/${parent.id}/edit`)}
          className="flex items-center gap-1.5 text-sm mb-4 cursor-pointer transition-colors hover:opacity-80"
          style={{ color: 'var(--text-muted)' }}
        >
          <ArrowLeft size={16} />
          Back to transaction
        </button>
        <Card>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            This transaction is not a split expense. Go back and tick "Split this expense with
            others" to enable repayment tracking.
          </p>
        </Card>
      </div>
    );
  }

  const parentAccount = accounts.find((a) => a.id === parent.accountId);

  // Apply the search filter to the candidate-income picker. We match on
  // raw merchant, note, date, and amount so users can type any of them
  // to narrow quickly. Lower-case compare for case-insensitivity.
  const filteredCandidates = candidateIncomes.filter((c) => {
    if (!candidateSearch.trim()) return true;
    const q = candidateSearch.toLowerCase();
    const merchant = (c.merchantRaw ?? c.note ?? '').toLowerCase();
    const accountName =
      accounts.find((a) => a.id === c.accountId)?.name.toLowerCase() ?? '';
    return (
      merchant.includes(q) ||
      accountName.includes(q) ||
      c.date.includes(q) ||
      c.amount.includes(q)
    );
  });

  const net = dec(parent.netSpentInAccountCcy ?? parent.amountInAccountCcy).toFixed(2);
  const reimbursed = dec(parent.amountInAccountCcy).minus(dec(net)).toFixed(2);
  const isSettled = parent.splitStatus === 'settled';

  // Per-currency reimbursement breakdown across BOTH tracked repayments
  // and external (untracked) ones. Native currencies only - conversion
  // to the parent's currency is handled at summary level via `net`.
  const perCurrency: Record<string, Big> = {};
  for (const rep of repayments) {
    perCurrency[rep.currency] = (perCurrency[rep.currency] ?? dec('0')).plus(dec(rep.amount));
  }
  for (const ext of externalReps) {
    perCurrency[ext.currency] =
      (perCurrency[ext.currency] ?? dec('0')).plus(dec(ext.amount));
  }
  const currencyEntries = Object.entries(perCurrency);
  const totalRepaymentCount = repayments.length + externalReps.length;

  return (
    <div>
      {/* Deterministic destination: this page is reached from at least four
          entry points (post-create redirect, list badge, edit button, Review
          wizard), so history-based Back lands somewhere different each time -
          including the spent create form. */}
      <button
        onClick={() => navigate('/transactions')}
        className="flex items-center gap-1.5 text-sm mb-4 cursor-pointer transition-colors hover:opacity-80"
        style={{ color: 'var(--text-muted)' }}
      >
        <ArrowLeft size={16} />
        Back to transactions
      </button>

      <PageHeader
        label="Split expense"
        title={parent.note?.replace(/^\[Split\]\s*/, '') || 'Split expense'}
        right={
          <div className="flex gap-2">
            <Button
              variant={isSettled ? 'secondary' : 'primary'}
              onClick={handleToggleStatus}
              disabled={toggling}
            >
              {toggling ? 'Saving...' : isSettled ? 'Reopen' : 'Mark settled'}
            </Button>
          </div>
        }
      />

      <InfoBanner
        storageKey="koinkat.splitDetailBannerDismissed"
        title="How splits work"
        className="mb-4"
      >
        Your <strong>net expense</strong> below is computed as gross minus everything that has
        been repaid. Budgets and category breakdowns count only the net. You can add repayments
        at any time; the math recalculates automatically.
      </InfoBanner>

      {/* Parent summary + KPI */}
      <Card className="mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <p
              className="uppercase mb-1"
              style={UPPERCASE_LABEL_SM}
            >
              Gross payment
            </p>
            <div data-privacy-field>
              <span
                className="amount"
                style={{
                  color: 'var(--text)',
                  fontFamily: 'var(--font-head)',
                  fontSize: 'var(--fs-h2)',
                  fontWeight: 'var(--fw-semibold)',
                }}
              >
                {formatAmount(parent.amount)}
              </span>
              <span className="currency-code">{parent.currency}</span>
            </div>
            <p
              className="mt-1"
              style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-rate)' }}
            >
              Paid from {parentAccount?.name ?? 'account'} on {parent.date}
            </p>
          </div>

          <div>
            <p
              className="uppercase mb-1"
              style={UPPERCASE_LABEL_SM}
            >
              Reimbursed so far
            </p>
            <div data-privacy-field>
              <span
                className="amount"
                style={{
                  color: 'var(--income)',
                  fontFamily: 'var(--font-head)',
                  fontSize: 'var(--fs-h2)',
                  fontWeight: 'var(--fw-semibold)',
                }}
              >
                {formatAmount(reimbursed)}
              </span>
              <span className="currency-code">{parentAccount?.currency ?? parent.currency}</span>
            </div>
            <p
              className="mt-1"
              style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-rate)' }}
            >
              {totalRepaymentCount} repayment{totalRepaymentCount !== 1 ? 's' : ''}
              {externalReps.length > 0 && ` (${externalReps.length} external)`}
              {currencyEntries.length > 1 && (
                <span data-privacy-field>
                  {' '}·{' '}
                  {currencyEntries
                    .map(([c, a]) => `${formatAmount(a.toFixed(2))} ${c}`)
                    .join(' + ')}
                </span>
              )}
            </p>
          </div>

          <div>
            <p
              className="uppercase mb-1"
              style={UPPERCASE_LABEL_SM}
            >
              Net expense so far
            </p>
            <div data-privacy-field>
              <span
                className="amount"
                style={{
                  color: 'var(--expense)',
                  fontFamily: 'var(--font-head)',
                  fontSize: 'var(--fs-h2)',
                  fontWeight: 'var(--fw-semibold)',
                }}
              >
                {formatAmount(net)}
              </span>
              <span className="currency-code">{parentAccount?.currency ?? parent.currency}</span>
            </div>
            <p
              className="mt-1"
              style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-rate)' }}
            >
              This counts toward your budget
            </p>
          </div>
        </div>
      </Card>

      {/* Repayments list */}
      <Card className="mb-4">
        <p
          className="uppercase mb-3"
          style={UPPERCASE_LABEL}
        >
          Repayments
        </p>
        {totalRepaymentCount === 0 ? (
          <p className="text-center py-6" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}>
            No repayments yet. Add the first one below.
          </p>
        ) : (
          <div className="flex flex-col divide-y" style={{ borderColor: 'var(--border)' }}>
            {repayments.map((rep) => {
              const repAcct = accounts.find((a) => a.id === rep.accountId);
              return (
                <div
                  key={rep.id}
                  className="flex items-center justify-between py-3"
                  style={{ borderTopColor: 'var(--border)' }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span
                        className="amount"
                        data-privacy-field
                        style={{
                          color: 'var(--income)',
                          fontWeight: 'var(--fw-semibold)',
                        }}
                      >
                        +{formatAmount(rep.amount)}
                      </span>
                      <span className="currency-code">{rep.currency}</span>
                      {/* Parenthetical only when the bank booked this row in
                          a different currency than its destination account
                          (cross-currency card charge). In the common
                          same-currency case, the parenthetical would just
                          repeat the native amount, so we hide it. */}
                      {repAcct &&
                        rep.currency.toUpperCase() !== repAcct.currency.toUpperCase() && (
                          <span
                            data-privacy-field
                            style={{
                              color: 'var(--text-muted)',
                              fontSize: 'var(--fs-rate)',
                            }}
                          >
                            (~{formatAmount(rep.amountInAccountCcy)} {repAcct.currency})
                          </span>
                        )}
                    </div>
                    <p
                      className="mt-0.5 truncate"
                      style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-rate)' }}
                    >
                      {rep.date} · {repAcct?.name ?? 'account'}
                      {rep.note && ` · ${rep.note}`}
                    </p>
                  </div>
                  <button
                    onClick={() => setDeleteTarget(rep)}
                    className="p-1.5 rounded cursor-pointer hover:opacity-80 transition-opacity"
                    style={{ color: 'var(--danger)' }}
                    title="Delete repayment"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
            {externalReps.map((ext) => (
              <div
                key={ext.id}
                className="flex items-center justify-between py-3"
                style={{ borderTopColor: 'var(--border)' }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span
                      className="amount"
                      data-privacy-field
                      style={{
                        color: 'var(--income)',
                        fontWeight: 'var(--fw-semibold)',
                      }}
                    >
                      +{formatAmount(ext.amount)}
                    </span>
                    <span className="currency-code">{ext.currency}</span>
                    <span
                      className="px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor: 'color-mix(in srgb, var(--text-muted) 15%, transparent)',
                        color: 'var(--text-muted)',
                        fontSize: 'var(--fs-rate)',
                        fontWeight: 'var(--fw-medium)',
                      }}
                      title="Does not affect any account balance"
                    >
                      external
                    </span>
                    {ext.currency !== (parentAccount?.currency ?? parent.currency) && (
                      <span
                        data-privacy-field
                        style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-rate)' }}
                      >
                        (~{formatAmount(ext.amountInParentCcy)} {parentAccount?.currency ?? parent.currency})
                      </span>
                    )}
                  </div>
                  <p
                    className="mt-0.5 truncate"
                    style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-rate)' }}
                  >
                    {ext.date}
                    {ext.source && ` · via ${ext.source}`}
                    {ext.note && ` · ${ext.note}`}
                  </p>
                </div>
                <button
                  onClick={() => setDeleteExtTarget(ext)}
                  className="p-1.5 rounded cursor-pointer hover:opacity-80 transition-opacity"
                  style={{ color: 'var(--danger)' }}
                  title="Delete external reimbursement"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Add repayment - picker by default, external manual form when toggled */}
      {!isSettled && (
        <Card className="mb-4">
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <p
              className="uppercase"
              style={UPPERCASE_LABEL}
            >
              Add repayment
            </p>
            <label
              className="flex items-center gap-2 cursor-pointer text-sm"
              style={{ color: 'var(--text-muted)' }}
            >
              <input
                type="checkbox"
                checked={isExternal}
                onChange={(e) => {
                  setIsExternal(e.target.checked);
                  setAddError('');
                }}
              />
              Repayment via external service (PayPal, MobilePay, cash)
            </label>
          </div>

          {isExternal ? (
            <form
              onSubmit={handleAddExternalReimbursement}
              className="flex flex-col gap-3"
            >
              <p
                style={{
                  color: 'var(--text-muted)',
                  fontSize: 'var(--fs-rate)',
                  fontStyle: 'italic',
                }}
              >
                External repayments don't exist as bank transactions; type
                the amount manually. No account balance is touched.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Source (optional)"
                  value={addSource}
                  onChange={(e) => setAddSource(e.target.value)}
                  placeholder="e.g. PayPal, MobilePay, cash"
                />
                <Input
                  label="Amount"
                  type="number"
                  step="any"
                  min="0"
                  value={addAmount}
                  onChange={(e) => setAddAmount(e.target.value)}
                  placeholder="0.00"
                />
                <CurrencyPicker
                  label="Currency"
                  value={addCurrency}
                  onChange={setAddCurrency}
                />
                <Input
                  label="Date"
                  type="date"
                  value={addDate}
                  onChange={(e) => setAddDate(e.target.value)}
                />
              </div>
              <Input
                label="From (optional note)"
                value={addNote}
                onChange={(e) => setAddNote(e.target.value)}
                placeholder="e.g. Friend A"
              />
              {addError && (
                <p className="text-sm" style={{ color: 'var(--danger)' }}>
                  {addError}
                </p>
              )}
              <div>
                <Button type="submit" disabled={adding}>
                  <Plus size={14} /> {adding ? 'Adding...' : 'Add repayment'}
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-col gap-3">
              <p
                style={{
                  color: 'var(--text-muted)',
                  fontSize: 'var(--fs-rate)',
                  fontStyle: 'italic',
                }}
              >
                Pick an existing income that matches the repayment you
                received. Balances aren't touched; the money already
                landed when the bank synced it.
              </p>

              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: 'var(--text-muted)' }}
                />
                <input
                  type="text"
                  value={candidateSearch}
                  onChange={(e) => setCandidateSearch(e.target.value)}
                  placeholder="Search by merchant, account, date, amount..."
                  className="w-full pl-9 pr-3 py-2 rounded text-sm"
                  style={{
                    backgroundColor: 'var(--input-bg)',
                    color: 'var(--text)',
                    border: '1px solid var(--border)',
                  }}
                />
              </div>

              {candidateIncomes.length === 0 ? (
                <p
                  className="py-4 text-center"
                  style={{
                    color: 'var(--text-muted)',
                    fontSize: 'var(--fs-body-sm)',
                  }}
                >
                  No unlinked income transactions available. New ones will
                  appear here the next time your bank syncs.
                </p>
              ) : filteredCandidates.length === 0 ? (
                <p
                  className="py-4 text-center"
                  style={{
                    color: 'var(--text-muted)',
                    fontSize: 'var(--fs-body-sm)',
                  }}
                >
                  No incomes match your search.
                </p>
              ) : (
                <div
                  className="rounded-lg overflow-y-auto"
                  style={{
                    border: '1px solid var(--border)',
                    maxHeight: 320,
                  }}
                >
                  {filteredCandidates.map((c, idx) => {
                    const acct = accounts.find((a) => a.id === c.accountId);
                    const merchant =
                      c.merchantRaw ?? c.note ?? '(no merchant)';
                    const isLast = idx === filteredCandidates.length - 1;
                    const isLinking = linkingId === c.id;
                    return (
                      <div
                        key={c.id}
                        className="flex items-center gap-3 p-3"
                        style={{
                          borderBottom: isLast
                            ? 'none'
                            : '1px solid var(--border)',
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <p
                            className="truncate mb-0.5"
                            style={{
                              color: 'var(--text)',
                              fontSize: 'var(--fs-body)',
                              fontWeight: 'var(--fw-medium)',
                            }}
                            title={merchant}
                          >
                            {merchant}
                          </p>
                          <div
                            className="flex items-center gap-2 flex-wrap"
                            style={{
                              color: 'var(--text-muted)',
                              fontSize: 'var(--fs-body-sm)',
                            }}
                          >
                            <span>{c.date}</span>
                            {acct && (
                              <span className="inline-flex items-center gap-1.5 truncate max-w-[140px]">
                                <span
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{ backgroundColor: acct.color }}
                                />
                                <span className="truncate">{acct.name}</span>
                              </span>
                            )}
                            <span
                              className="amount amount-sm"
                              style={{ color: 'var(--income)' }}
                              data-privacy-field
                            >
                              +{formatAmount(c.amount)}
                            </span>
                            <span className="currency-code">{c.currency}</span>
                          </div>
                        </div>
                        <Button
                          variant="secondary"
                          disabled={isLinking || linkingId !== null}
                          onClick={() => handleLinkExistingIncome(c.id)}
                        >
                          <Link2 size={14} />
                          {isLinking ? 'Linking...' : 'Link'}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}

              {addError && (
                <p className="text-sm" style={{ color: 'var(--danger)' }}>
                  {addError}
                </p>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Delete confirmation - tracked repayment. A centered Modal (not an
          inline Card): on long pages the inline card mounted below the fold,
          so clicking a top row's trash appeared to do nothing. */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete repayment?"
      >
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          Delete the{' '}
          <span data-privacy-field>
            <strong style={{ color: 'var(--text)' }}>
              {deleteTarget ? `${formatAmount(deleteTarget.amount)} ${deleteTarget.currency}` : ''}
            </strong>
          </span>{' '}
          repayment? The destination account's balance will be reduced by the
          reimbursed amount and your net expense will update.
        </p>
        <div className="flex gap-3 justify-end">
          <Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button variant="danger" onClick={handleDeleteRepayment}>Delete</Button>
        </div>
      </Modal>

      {/* Delete confirmation - external reimbursement */}
      <Modal
        open={deleteExtTarget !== null}
        onClose={() => setDeleteExtTarget(null)}
        title="Delete external reimbursement?"
      >
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          Delete the{' '}
          <span data-privacy-field>
            <strong style={{ color: 'var(--text)' }}>
              {deleteExtTarget ? `${formatAmount(deleteExtTarget.amount)} ${deleteExtTarget.currency}` : ''}
            </strong>
          </span>{' '}
          external reimbursement? No account balance will change (external
          repayments don't affect balances); your net expense will increase by
          the deleted amount.
        </p>
        <div className="flex gap-3 justify-end">
          <Button variant="ghost" onClick={() => setDeleteExtTarget(null)}>Cancel</Button>
          <Button variant="danger" onClick={handleDeleteExternalReimbursement}>
            Delete
          </Button>
        </div>
      </Modal>

      {/* Convert to normal expense - always available */}
      <Card>
        <p
          className="uppercase mb-2"
          style={UPPERCASE_LABEL_SM}
        >
          Convert to normal expense
        </p>
        <p className="text-sm mb-3" style={{ color: 'var(--text)' }}>
          Stop tracking this as a split and turn it back into a normal expense.
          {repayments.length > 0 && (
            <>
              {' '}Its {repayments.length} linked repayment
              {repayments.length !== 1 ? 's' : ''} will become ordinary
              (uncategorized) income in your Review inbox - balances are
              unchanged.
            </>
          )}
          {externalReps.length > 0 && (
            <>
              {' '}{externalReps.length} external reimbursement
              {externalReps.length !== 1 ? 's' : ''} will be removed.
            </>
          )}
          {' '}The expense will then count at its full amount.
        </p>
        <div className="flex justify-end">
          <Button
            variant="danger"
            onClick={() => { setConvertError(''); setConfirmConvertOpen(true); }}
            disabled={converting}
          >
            Convert to normal expense
          </Button>
        </div>
      </Card>

      {/* Convert confirmation - this permanently deletes manually-typed
          external reimbursements and sends repayments back to Review, so it
          must not fire on a single accidental click. */}
      <Modal
        open={confirmConvertOpen}
        onClose={() => setConfirmConvertOpen(false)}
        title="Convert to normal expense?"
      >
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          {repayments.length > 0 && (
            <>
              {repayments.length} linked repayment
              {repayments.length !== 1 ? 's' : ''} will return to the Review
              inbox as ordinary income (balances unchanged).{' '}
            </>
          )}
          {externalReps.length > 0 && (
            <>
              {externalReps.length} external reimbursement
              {externalReps.length !== 1 ? 's' : ''} will be{' '}
              <strong style={{ color: 'var(--danger)' }}>permanently deleted</strong>{' '}
              - there is no way to restore them except re-typing.{' '}
            </>
          )}
          The expense will count at its full amount again.
        </p>
        {convertError && (
          <p className="text-sm mb-4" style={{ color: 'var(--danger)' }}>
            {convertError}
          </p>
        )}
        <div className="flex gap-3 justify-end">
          <Button variant="ghost" onClick={() => setConfirmConvertOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleConvertToNormal}
            disabled={converting}
          >
            {converting ? 'Converting...' : 'Convert'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
