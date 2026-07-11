import { parseISO, format } from 'date-fns';

/**
 * Shared date-display formatters. Review, TransactionList, Analysis and
 * Budgets each carried their own near-identical copy of these before they
 * were consolidated here - import instead of re-implementing.
 *
 * All take the app's storage format (ISO `YYYY-MM-DD`, dates only, no
 * timezone) and return display strings.
 */

/** `05 Jun 2026` - the standard row date (Review, TransactionList). */
export function formatFullDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** `05 Jun 26` - dense variant for drawers and tight tables. */
export function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}

/** `Jun 5, 2026` - event/series day labels. Falls back to the raw string. */
export function formatDayLabel(yyyymmdd: string): string {
  try {
    return format(parseISO(yyyymmdd), 'MMM d, yyyy');
  } catch {
    return yyyymmdd;
  }
}

/** `June 2026` - month labels from a `YYYY-MM-01` key. */
export function formatMonthLabel(yyyymm01: string): string {
  try {
    return format(parseISO(yyyymm01), 'MMMM yyyy');
  } catch {
    return yyyymm01;
  }
}
