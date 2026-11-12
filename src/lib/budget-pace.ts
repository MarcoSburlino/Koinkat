import { dec, qCent } from '../domain/money';

/**
 * Pace numbers for spending against a monthly limit, shared by the
 * Dashboard "This month" card and the Budgets focused-month card so the
 * two can never drift.
 *
 * Conventions: `daysLeft` counts today inclusively (spending "today's
 * share" is still allowed), `monthElapsedPct` is the position of the
 * "today" tick on progress bars, and `safePerDay` is remaining ÷ daysLeft
 * as a decimal string - null when nothing remains (over budget).
 */
export function monthPace(
  remaining: string,
  now: Date = new Date(),
): {
  daysInMonth: number;
  daysLeft: number;
  monthElapsedPct: number;
  safePerDay: string | null;
} {
  const daysInMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
  ).getDate();
  const dayOfMonth = now.getDate();
  const daysLeft = daysInMonth - dayOfMonth + 1;
  const monthElapsedPct = (dayOfMonth / daysInMonth) * 100;
  const remainingD = dec(remaining);
  const safePerDay = remainingD.gt(0)
    ? remainingD.div(daysLeft).toFixed(2)
    : null;
  return { daysInMonth, daysLeft, monthElapsedPct, safePerDay };
}

/**
 * Where the month is heading: today's running total plus a TYPICAL day's
 * spend for every day still to come. "Typical" is the median of the days
 * so far (zero-spend days included), not the mean: rent or an insurance
 * premium lands once, and a mean would replay it every remaining day -
 * a 950 rent on the 2nd turned a normal month into a 4 000 projection.
 *
 * Returns null when `today` is not inside the month described by `days`
 * (a past month already has its real total; a future one has no data).
 * `days` is the per-day series from `calculatePeriodDailySpending`, so the
 * projection starts from the exact figure the rest of the page shows.
 */
export function projectMonthEnd(
  days: { date: string; spent: string; cumulative: string }[],
  today: string,
): { total: string; typicalDay: string; todayIndex: number } | null {
  const idx = days.findIndex((d) => d.date === today);
  if (idx < 0) return null;
  const sorted = days
    .slice(0, idx + 1)
    .map((d) => dec(d.spent))
    .sort((a, b) => a.cmp(b));
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? sorted[mid] : sorted[mid - 1].plus(sorted[mid]).div(2);
  const remainingDays = days.length - idx - 1;
  const total = dec(days[idx].cumulative).plus(median.times(remainingDays));
  return {
    total: qCent(total).toFixed(2),
    typicalDay: qCent(median).toFixed(2),
    todayIndex: idx,
  };
}

/** Local calendar date as YYYY-MM-DD (not UTC: "today" is the user's day). */
export function localIsoDate(now: Date = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}
