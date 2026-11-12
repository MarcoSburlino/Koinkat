import { Swatch, type SwatchKind } from './ChartTooltip';

export interface LegendItem {
  label: string;
  color: string;
  kind?: SwatchKind;
}

/**
 * Inline legend that sits ABOVE the plot, next to the chart title, so
 * the key is read before the data instead of hunted for below it.
 * Text is ink; the swatch carries identity.
 */
export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Legend">
      {items.map((it) => (
        <li
          key={it.label}
          className="flex items-center gap-1.5"
          style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-body-sm)' }}
        >
          <Swatch color={it.color} kind={it.kind} />
          {it.label}
        </li>
      ))}
    </ul>
  );
}
