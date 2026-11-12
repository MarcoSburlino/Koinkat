import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { ChartCard } from '../charts/ChartCard';
import { TrendChart, type TrendPoint } from '../charts/TrendChart';
import { formatAmount } from '../../lib/format';
import { dec } from '../../domain/money';
import { buildYearlySummary } from '../../services/reporting-service';
import { useAppStore } from '../../stores/app-store';
import type { Account } from '../../types/models';

/**
 * This year's month-end balance across all accounts, from the same
 * yearly summary the Summary page uses (so both pages agree), plus the
 * change since 1 January as a signed figure.
 */
export function BalanceTrendCard({
  accounts,
  preferredCurrency,
  decimalSeparator,
}: {
  accounts: Account[];
  preferredCurrency: string;
  decimalSeparator: string;
}) {
  const dataVersion = useAppStore((s) => s.dataVersion);
  const [points, setPoints] = useState<TrendPoint[] | null>(null);
  const [change, setChange] = useState<string | null>(null);
  const year = new Date().getFullYear();

  useEffect(() => {
    if (accounts.length === 0) return;
    let cancelled = false;
    const month = new Date().getMonth() + 1;
    buildYearlySummary({ year, preferredCurrency, accounts })
      .then((data) => {
        if (cancelled) return;
        const rows = data.rows.filter((r) => r.month <= month);
        setPoints(rows.map((r) => ({ label: r.label, value: r.balance })));
        const last = rows[rows.length - 1];
        setChange(last ? dec(last.balance).minus(dec(data.totals.startingBalance)).toFixed(2) : null);
      })
      .catch((err) => {
        console.error('[Dashboard] balance trend failed:', err);
        if (!cancelled) setPoints([]);
      });
    return () => {
      cancelled = true;
    };
  }, [accounts, preferredCurrency, year, dataVersion]);

  const up = change !== null && dec(change).gte(0);

  return (
    <ChartCard
      className="h-full"
      title={`Balance in ${year}`}
      hint={
        change !== null ? (
          <span data-privacy-field>
            <span className="amount" style={{ color: up ? 'var(--income)' : 'var(--expense)' }}>
              {up ? '+' : ''}
              {formatAmount(change, decimalSeparator)} {preferredCurrency}
            </span>{' '}
            since 1 January
          </span>
        ) : (
          'Month-end balance across all accounts.'
        )
      }
      right={
        <Link
          to="/summary"
          className="inline-flex items-center gap-1 hover:underline"
          style={{ color: 'var(--nav-active-fg)', fontSize: 'var(--fs-body-sm)' }}
        >
          Summary <ArrowRight size={13} />
        </Link>
      }
    >
      {points === null ? (
        <div style={{ height: 220, backgroundColor: 'var(--surface-alt)', opacity: 0.4 }} className="rounded" />
      ) : points.length === 0 ? (
        <p className="py-16 text-center" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}>
          No history yet this year.
        </p>
      ) : (
        <TrendChart
          points={points}
          currency={preferredCurrency}
          decimalSeparator={decimalSeparator}
          seriesLabel="Balance"
          height={220}
        />
      )}
    </ChartCard>
  );
}
