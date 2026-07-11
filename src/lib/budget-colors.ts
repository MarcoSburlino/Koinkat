/**
 * Shared progress-color helpers for the Budgets page. Previously
 * duplicated between Budgets.tsx and BudgetEvents.tsx; dedup'd here
 * when the two pages were merged.
 *
 * Semantic ramp per design system §Progress bars:
 *   0–79%  → income (green, on track)
 *   80–99% → warning (amber, close to the edge)
 *   100%+  → danger (red, over-budget)
 */

/** Color keyed directly on a percentage value. */
export function getPercentageColor(pct: number): string {
  if (pct > 100) return 'var(--danger)';
  if (pct >= 80) return 'var(--warning)';
  return 'var(--income)';
}
