/**
 * Shared month-name literals. Several pages (Analysis, Budgets,
 * TransactionList) build their own month-filter `<Select>` option arrays,
 * each previously inlining the same 12-element list. The option *shapes*
 * differ (Analysis prepends "All year" → '0', TransactionList prepends
 * "All months" → '', Budgets uses short labels with no "all" entry), so the
 * shared piece is just the name arrays; each page maps these into its own
 * option shape.
 */
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export const MONTH_NAMES_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/**
 * Build a month `<Select>` option list (values '1'..'12'). The pages'
 * option shapes differ only in the optional leading "all" entry and the
 * label length, so those are the two knobs:
 *
 *   monthFilterOptions({ value: '0', label: 'All year' })    // Analysis
 *   monthFilterOptions({ value: '', label: 'All months' })   // TransactionList
 *   monthFilterOptions(null, { short: true })                // Budgets
 */
/**
 * The calendar month before {year, month} (month is 1-12), rolling over
 * January into the previous year. Shared by the Dashboard month card and
 * the Analysis previous-period comparison.
 */
export function previousMonth(
  year: number,
  month: number,
): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export function monthFilterOptions(
  allEntry?: { value: string; label: string } | null,
  opts?: { short?: boolean },
): { value: string; label: string }[] {
  const names = opts?.short ? MONTH_NAMES_SHORT : MONTH_NAMES;
  const months = names.map((label, i) => ({ value: String(i + 1), label }));
  return allEntry ? [allEntry, ...months] : months;
}
