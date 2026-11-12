import type { ReactNode } from 'react';
import { Card } from '../ui/Card';
import { UPPERCASE_LABEL } from '../../lib/label-styles';
import { ChartLegend, type LegendItem } from './ChartLegend';

/**
 * The one frame every chart sits in: title + optional one-line reading
 * hint on the left, legend (or a control) on the right, then the plot at
 * a fixed height. Keeps title/legend rhythm identical across pages.
 */
export function ChartCard({
  title,
  hint,
  legend,
  right,
  height,
  children,
  className = '',
  privacy = true,
}: {
  title: string;
  hint?: ReactNode;
  legend?: LegendItem[];
  right?: ReactNode;
  /** Plot height in px; omit to let children size themselves. */
  height?: number;
  children: ReactNode;
  className?: string;
  /** Blur the plot in privacy mode (tooltips and bar heights leak amounts). */
  privacy?: boolean;
}) {
  return (
    <Card className={className}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 mb-4">
        <div className="min-w-0">
          <p className="uppercase" style={UPPERCASE_LABEL}>
            {title}
          </p>
          {hint && (
            <p
              className="mt-1"
              style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}
            >
              {hint}
            </p>
          )}
        </div>
        {(legend || right) && (
          <div className="flex items-center gap-4">
            {legend && <ChartLegend items={legend} />}
            {right}
          </div>
        )}
      </div>
      <div
        className="w-full"
        style={height ? { height } : undefined}
        {...(privacy ? { 'data-privacy-field': true } : {})}
      >
        {children}
      </div>
    </Card>
  );
}
