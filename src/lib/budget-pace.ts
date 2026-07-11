import { dec } from '../domain/money';

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
