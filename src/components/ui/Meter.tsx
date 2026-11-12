import { getPercentageColor } from '../../lib/budget-colors';

/**
 * Progress meter shared by budgets, events and category shares.
 *
 * - The fill carries severity (on track -> warning -> over) unless a
 *   fixed `color` is passed (identity, e.g. a category share).
 * - The track is a light step of the SAME hue, so the state reads across
 *   the whole bar rather than only in the filled part.
 * - `marker` draws a tick at a percentage (e.g. how much of the month has
 *   gone), so spent-% and elapsed-% compare in one glance.
 *
 * `pct` is a display-boundary number (already computed with Big by the
 * caller); it is only used for a CSS width.
 */
export function Meter({
  pct,
  color,
  marker,
  markerLabel,
  size = 'md',
  label,
}: {
  pct: number;
  color?: string;
  marker?: number | null;
  markerLabel?: string;
  size?: 'xs' | 'sm' | 'md';
  /** Accessible name, e.g. "Spent 88% of the monthly limit". */
  label?: string;
}) {
  const fill = color ?? getPercentageColor(pct);
  const clamped = Math.min(Math.max(0, pct), 100);
  const h = size === 'md' ? 8 : size === 'sm' ? 6 : 4;
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={label}
      className="relative w-full"
      style={{ height: h }}
    >
      <div
        className="absolute inset-0 rounded-full"
        style={{ backgroundColor: `color-mix(in srgb, ${fill} 16%, var(--surface-alt))` }}
      />
      <div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{
          width: `${clamped}%`,
          backgroundColor: fill,
          transition: 'width var(--dur-slow) var(--ease-standard)',
        }}
      />
      {marker != null && (
        <div
          className="absolute"
          title={markerLabel}
          style={{
            left: `calc(${Math.min(Math.max(0, marker), 100)}% - 1px)`,
            top: -3,
            bottom: -3,
            width: 2,
            borderRadius: 1,
            backgroundColor: 'var(--text)',
            boxShadow: '0 0 0 2px var(--surface)',
          }}
        />
      )}
    </div>
  );
}
