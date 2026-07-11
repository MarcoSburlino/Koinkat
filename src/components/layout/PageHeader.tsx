import { UPPERCASE_LABEL } from '../../lib/label-styles';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  /**
   * Small uppercase kicker shown above the title (e.g. "OVERVIEW",
   * "SETTINGS"). Usually the section the page belongs to.
   */
  label?: string;
  /** Page title. */
  title: string;
  /**
   * When true, the title renders in `--font-display` (DM Serif Display).
   * Rule: EVERY top-level sidebar page (Dashboard, Review, Transactions,
   * Analysis, Summary, Budgets, Categories, Settings - plus Rules) sets
   * this, so navigating between primary pages keeps an identical header
   * rhythm. Only nested task pages (create/edit forms, split detail,
   * bank-link) leave it false and get the smaller DM Sans heading.
   */
  serif?: boolean;
  /** Optional one-line description below the title. */
  subtitle?: string;
  /**
   * Right-side slot - typically primary actions, sync pill, or filters.
   * Wraps below the title block on mobile.
   */
  right?: ReactNode;
  /** Extra classes on the root wrapper (e.g. override the default margin). */
  className?: string;
}

/**
 * Standard page header used on every routed page. Encapsulates the
 * repeated "label → title → subtitle → right-actions" pattern so pages
 * don't drift in typography and spacing over time.
 *
 * Example:
 *   <PageHeader
 *     serif
 *     label="Overview"
 *     title="Financial overview"
 *     right={<Button>Sync</Button>}
 *   />
 */
export function PageHeader({
  label,
  title,
  serif = false,
  subtitle,
  right,
  className = '',
}: PageHeaderProps) {
  return (
    <div
      className={`flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8 ${className}`}
    >
      <div className="min-w-0">
        {label && (
          <p
            className="uppercase mb-2"
            style={UPPERCASE_LABEL}
          >
            {label}
          </p>
        )}
        <h1
          style={{
            color: 'var(--text)',
            fontFamily: serif ? 'var(--font-display)' : 'var(--font-head)',
            fontSize: serif ? 'var(--fs-display)' : 'var(--fs-h2)',
            lineHeight: serif ? 'var(--lh-display)' : 'var(--lh-heading)',
            letterSpacing: serif ? 'var(--ls-display)' : 'var(--ls-normal)',
            fontWeight: serif ? 'var(--fw-regular)' : 'var(--fw-semibold)',
            margin: 0,
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            className="mt-1.5 max-w-2xl"
            style={{
              color: 'var(--text-secondary)',
              fontSize: 'var(--fs-body-sm)',
              lineHeight: 'var(--lh-body)',
            }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {right && <div className="flex items-center gap-2 flex-wrap">{right}</div>}
    </div>
  );
}
