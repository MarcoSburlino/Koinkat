import { useLayoutEffect, useRef, useState } from 'react';
import { formatAmount } from '../../lib/format';

export interface Segment {
  key: string;
  label: string;
  /** Decimal string, for the tooltip/accessible name. */
  amount: string;
  /** Display-boundary share, 0-100 (already computed with Big). */
  share: number;
  color: string;
  /** Label colour inside the fill (see categoricalInk). */
  ink: string;
}

/**
 * Tall segmented bar - one whole split into parts (dataviz "figure").
 * 28px tall, 2px surface gap between blocks, 4px corners. A block prints
 * its share inside only when the label fits (measured, never clipped);
 * otherwise the legend, hover title and the table below carry it.
 * Labels inside a fill are white or near-black, never the series colour.
 */
export function SegmentedBar({
  segments,
  currency,
  decimalSeparator,
  onSelect,
}: {
  segments: Segment[];
  currency: string;
  decimalSeparator: string;
  onSelect?: (key: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const visible = segments.filter((s) => s.share > 0);
  // ~7px per character at 11px mono, plus 8px padding each side.
  const fits = (s: Segment) => (width * s.share) / 100 >= `${s.share.toFixed(0)}%`.length * 7 + 16;

  return (
    <div
      ref={ref}
      className="flex w-full gap-[2px]"
      style={{ height: 28 }}
      role="img"
      aria-label={visible.map((s) => `${s.label} ${s.share.toFixed(0)}%`).join(', ')}
      data-privacy-field
    >
      {visible.map((s) => (
        <button
          key={s.key}
          type="button"
          onClick={onSelect ? () => onSelect(s.key) : undefined}
          title={`${s.label} · ${formatAmount(s.amount, decimalSeparator)} ${currency} · ${s.share.toFixed(1)}%`}
          className="h-full flex items-center px-2 min-w-[3px] transition-[filter]"
          style={{
            width: `${s.share}%`,
            backgroundColor: s.color,
            borderRadius: 4,
            cursor: onSelect ? 'pointer' : 'default',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.filter = 'brightness(1.1)')}
          onMouseLeave={(e) => (e.currentTarget.style.filter = '')}
        >
          {fits(s) && (
            <span
              className="amount"
              style={{ color: s.ink, fontSize: 11, fontWeight: 'var(--fw-semibold)' }}
            >
              {s.share.toFixed(0)}%
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
