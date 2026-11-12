import { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import Big from 'big.js';
import { Card } from '../ui/Card';
import { UPPERCASE_LABEL } from '../../lib/label-styles';
import { formatAmount } from '../../lib/format';
import { dec } from '../../domain/money';
import { distinctAccountColors } from '../../lib/account-colors';
import type { AccountOverview } from '../../services/reporting-service';

/**
 * Net worth hero: the one headline figure, the split across accounts as
 * a single segmented bar (part-to-whole at a glance, replacing the donut
 * that turned into one solid ring whenever accounts shared a colour),
 * then one row per account with its share. Each account is listed once.
 */
export function NetWorthCard({
  overview,
  accountCount,
  pendingCount,
  decimalSeparator,
}: {
  overview: AccountOverview | null;
  accountCount: number;
  pendingCount: number;
  decimalSeparator: string;
}) {
  const rows = useMemo(() => {
    if (!overview) return [];
    const colors = distinctAccountColors(overview.entries.map((e) => e.color));
    // Shares of the POSITIVE converted total; negative or unconvertible
    // balances get no segment (a bar cannot draw a negative part) but
    // still list with their figure.
    const positive = overview.entries.map((e) =>
      e.convertedAmount && dec(e.convertedAmount).gt(0) ? dec(e.convertedAmount) : new Big('0'),
    );
    const total = positive.reduce((s, v) => s.plus(v), new Big('0'));
    return overview.entries.map((e, i) => ({
      entry: e,
      color: colors[i],
      // display-boundary: a CSS width / printed percentage.
      share: total.gt(0) ? positive[i].div(total).times(100).toNumber() : 0,
    }));
  }, [overview]);

  const empty = !overview || accountCount === 0;

  return (
    <Card highlight className="h-full flex flex-col">
      <p className="uppercase mb-3" style={UPPERCASE_LABEL}>
        Net worth
      </p>
      {empty ? (
        <div className="flex flex-col items-start gap-3">
          <span className="amount amount-lg" style={{ color: 'var(--text-muted)' }}>
            --
          </span>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}>
            No accounts yet. Add one below to see your balance.
          </p>
        </div>
      ) : (
        <>
          <div data-privacy-field className="flex items-baseline gap-1">
            <span
              className="amount"
              style={{
                color: 'var(--text)',
                fontSize: '2.25rem',
                fontWeight: 'var(--fw-semibold)',
                lineHeight: 1.1,
                fontVariantNumeric: 'proportional-nums',
              }}
            >
              {formatAmount(overview.totalBalance, decimalSeparator)}
            </span>
            <span className="currency-code">{overview.currency}</span>
          </div>
          <p className="mt-1" style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-body-sm)' }}>
            Across {accountCount} account{accountCount !== 1 ? 's' : ''}
            {overview.unconvertibleCurrencies.length > 0 &&
              ` (${overview.entries.filter((e) => e.conversionFailed).length} excluded - rates unavailable)`}
            {pendingCount > 0 && ` · includes ${pendingCount} pending`}
          </p>

          {/* Segmented bar: one whole, split into accounts. */}
          <div
            className="flex w-full mt-5 mb-5 gap-[2px]"
            style={{ height: 10 }}
            role="img"
            aria-label={rows
              .filter((r) => r.share > 0)
              .map((r) => `${r.entry.name} ${r.share.toFixed(0)}%`)
              .join(', ')}
            data-privacy-field
          >
            {rows
              .filter((r) => r.share > 0)
              .map((r, i, arr) => (
                <div
                  key={r.entry.accountId}
                  title={`${r.entry.name} · ${r.share.toFixed(1)}%`}
                  style={{
                    width: `${r.share}%`,
                    minWidth: 3,
                    backgroundColor: r.color,
                    borderTopLeftRadius: i === 0 ? 9999 : 0,
                    borderBottomLeftRadius: i === 0 ? 9999 : 0,
                    borderTopRightRadius: i === arr.length - 1 ? 9999 : 0,
                    borderBottomRightRadius: i === arr.length - 1 ? 9999 : 0,
                  }}
                />
              ))}
          </div>

          <ul className="flex flex-col gap-2.5" data-privacy-field>
            {rows.map(({ entry, color, share }) => (
              <li key={entry.accountId} className="flex items-center gap-3 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                <span className="truncate min-w-0 flex-1" style={{ color: 'var(--text)', fontSize: 'var(--fs-body)' }}>
                  {entry.name}
                </span>
                {entry.isCrossCurrency && !entry.conversionFailed && (
                  <span
                    className="amount shrink-0 hidden sm:flex items-center gap-1"
                    style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-rate)' }}
                  >
                    {formatAmount(entry.nativeAmount, decimalSeparator)} {entry.nativeCurrency}
                    <ArrowRight size={11} />
                  </span>
                )}
                <span
                  className="amount shrink-0 flex items-baseline"
                  style={{
                    color: dec(entry.nativeAmount).lt(0) ? 'var(--expense)' : 'var(--text)',
                    fontSize: 'var(--fs-body)',
                  }}
                >
                  {entry.conversionFailed ? (
                    <>
                      {formatAmount(entry.nativeAmount, decimalSeparator)}
                      <span className="currency-code">{entry.nativeCurrency}</span>
                    </>
                  ) : (
                    <>
                      {formatAmount(entry.isCrossCurrency ? entry.convertedAmount : entry.nativeAmount, decimalSeparator)}
                      <span className="currency-code">{entry.isCrossCurrency ? entry.convertedCurrency : entry.nativeCurrency}</span>
                    </>
                  )}
                </span>
                <span
                  className="amount shrink-0 text-right"
                  style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-rate)', width: 44 }}
                  title={entry.conversionFailed ? `No ${entry.convertedCurrency} exchange rate available` : undefined}
                >
                  {entry.conversionFailed ? 'no rate' : share > 0 ? `${share.toFixed(share < 1 ? 1 : 0)}%` : '-'}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
