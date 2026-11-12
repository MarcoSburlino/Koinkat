import { useEffect, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * Building blocks of the Settings page: an in-page side nav, sections
 * with a scope chip ("This workspace" / "All workspaces"), and rows with
 * the label + one line of help on the left and the control on the right.
 */

export interface SettingsNavItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

/** Sticky in-page nav that highlights the section in view. */
export function SettingsNav({ items }: { items: SettingsNavItem[] }) {
  const [active, setActive] = useState(items[0]?.id ?? '');
  // The caller rebuilds `items` each render; re-subscribe only when the
  // set of sections actually changes.
  const ids = items.map((i) => i.id).join('|');

  useEffect(() => {
    // Active = the last section whose top has passed just under the sticky
    // header; at the very bottom the last section wins even if it is too
    // short to ever reach the top.
    const onScroll = () => {
      const list = ids.split('|');
      const doc = document.scrollingElement ?? document.documentElement;
      if (doc.scrollTop + window.innerHeight >= doc.scrollHeight - 4) {
        setActive(list[list.length - 1] ?? '');
        return;
      }
      let current = list[0] ?? '';
      for (const id of list) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= 120) current = id;
      }
      setActive(current);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [ids]);

  return (
    <nav aria-label="Settings sections" className="hidden lg:block sticky top-20 self-start">
      <ul className="flex flex-col gap-0.5">
        {items.map(({ id, label, icon: Icon }) => (
          <li key={id}>
            <a
              href={`#${id}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className={`kk-nav-item${active === id ? ' kk-nav-active' : ''}`}
              aria-current={active === id ? 'true' : undefined}
            >
              <Icon size={16} strokeWidth={1.75} />
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function SettingsSection({
  id,
  title,
  description,
  scope,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  scope?: 'workspace' | 'app';
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mb-10" style={{ scrollMarginTop: 'calc(var(--header-h) + 16px)' }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <div>
          <h2
            id={`${id}-title`}
            style={{ color: 'var(--text)', fontSize: 'var(--fs-h3)', fontWeight: 'var(--fw-semibold)' }}
          >
            {title}
          </h2>
          {description && (
            <p className="mt-0.5" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}>
              {description}
            </p>
          )}
        </div>
        {scope && (
          <span className="kk-chip" data-tone={scope === 'app' ? 'accent' : undefined}>
            {scope === 'app' ? 'All workspaces' : 'This workspace'}
          </span>
        )}
      </div>
      <div
        className="rounded-lg"
        style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--elev-1)',
        }}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * One setting. `stacked` puts the control under the text (for wide
 * controls such as a list of banks or a form).
 */
export function SettingsRow({
  label,
  help,
  children,
  status,
  stacked = false,
  htmlFor,
}: {
  label: ReactNode;
  help?: ReactNode;
  children?: ReactNode;
  /** Short feedback shown under the label, e.g. "Saved". */
  status?: ReactNode;
  stacked?: boolean;
  htmlFor?: string;
}) {
  return (
    <div
      className={`kk-settings-row px-5 py-4 ${stacked ? 'flex flex-col gap-3' : 'grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,320px)] gap-x-8 gap-y-3 items-center'}`}
    >
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} style={{ color: 'var(--text)', fontSize: 'var(--fs-body)', fontWeight: 'var(--fw-medium)' }}>
            {label}
          </label>
        ) : (
          <p style={{ color: 'var(--text)', fontSize: 'var(--fs-body)', fontWeight: 'var(--fw-medium)' }}>{label}</p>
        )}
        {help && (
          <p className="mt-0.5" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}>
            {help}
          </p>
        )}
        {status && (
          <p className="mt-1" role="status" style={{ fontSize: 'var(--fs-body-sm)' }}>
            {status}
          </p>
        )}
      </div>
      {children && <div className={stacked ? '' : 'md:justify-self-end w-full md:w-auto'}>{children}</div>}
    </div>
  );
}

/** Two-to-four mutually exclusive options as one control (radiogroup). */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex p-0.5 rounded-lg w-full md:w-auto"
      style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => !selected && onChange(o.value)}
            className="flex-1 md:flex-none px-4 h-8 rounded-md cursor-pointer transition-colors"
            style={{
              backgroundColor: selected ? 'var(--surface)' : 'transparent',
              color: selected ? 'var(--text)' : 'var(--text-secondary)',
              boxShadow: selected ? 'var(--elev-1)' : 'none',
              border: selected ? '1px solid var(--border)' : '1px solid transparent',
              fontSize: 'var(--fs-body-sm)',
              fontWeight: selected ? 'var(--fw-semibold)' : 'var(--fw-medium)',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
