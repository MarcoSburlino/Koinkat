import { Repeat2 } from 'lucide-react';

/**
 * Small pill marking a transaction (or series) as recurring. Uses the
 * Repeat2 icon and a viz-tinted style intentionally distinct from the
 * category-change PENDING pill and the bank-pending status chip, so the
 * three never read as the same thing. Shared across Review / List / forms.
 */
export function RecurringBadge({
  label = 'Recurring',
  title,
  onClick,
}: {
  label?: string;
  title?: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      onClick={onClick}
      title={title ?? 'Recurring expense'}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full shrink-0${
        onClick ? ' cursor-pointer hover:opacity-80 transition-opacity' : ''
      }`}
      style={{
        backgroundColor: 'color-mix(in srgb, var(--viz-3, #7c3aed) 16%, transparent)',
        color: 'var(--viz-3, #7c3aed)',
        fontSize: 'var(--fs-rate)',
        letterSpacing: 'var(--ls-uppercase)',
        fontWeight: 'var(--fw-medium)',
        border: 'none',
      }}
    >
      <Repeat2 size={11} aria-hidden />
      {label}
    </Tag>
  );
}
