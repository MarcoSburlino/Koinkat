/**
 * Shared style objects for the small uppercase section labels used across
 * every page ("NET WORTH", "SPENT SO FAR", table headers, ...). These were
 * copy-pasted inline ~47 times before being consolidated here - import one
 * of these instead of re-typing the object.
 *
 *   UPPERCASE_LABEL      - standard section label (fs-body-sm + medium)
 *   UPPERCASE_LABEL_SM   - smaller variant for dense contexts (fs-rate)
 *   UPPERCASE_HEADER_CELL - table <th> variant; weight comes from the
 *                            element's `font-medium` class, not the style
 *
 * Pair with the `uppercase` Tailwind class on the element.
 */

export const UPPERCASE_LABEL = {
  color: 'var(--text-secondary)',
  fontSize: 'var(--fs-body-sm)',
  letterSpacing: 'var(--ls-uppercase)',
  fontWeight: 'var(--fw-medium)',
} as const;

export const UPPERCASE_LABEL_SM = {
  color: 'var(--text-secondary)',
  fontSize: 'var(--fs-rate)',
  letterSpacing: 'var(--ls-uppercase)',
} as const;

export const UPPERCASE_HEADER_CELL = {
  color: 'var(--text-secondary)',
  fontSize: 'var(--fs-body-sm)',
  letterSpacing: 'var(--ls-uppercase)',
} as const;
