import { useState, type ReactNode } from 'react';
import { Info, AlertTriangle, X } from 'lucide-react';

interface InfoBannerProps {
  /**
   * When set, the banner is dismissible. Dismissal persists in
   * localStorage under this key; subsequent renders check the key
   * and hide the banner if previously dismissed.
   *
   * Omit to make the banner non-dismissible (no X button rendered).
   */
  storageKey?: string;
  /** Optional bold heading rendered above the body. */
  title?: string;
  /** Body content - free-form children. */
  children: ReactNode;
  /**
   * Visual variant. 'info' (default) uses neutral surface + muted icon.
   * 'warning' uses warning-tinted surface + warning icon (matches the
   * transfer-pair detection banner pattern).
   */
  variant?: 'info' | 'warning';
  /** Optional className on the outer wrapper. */
  className?: string;
}

export function InfoBanner({
  storageKey,
  title,
  children,
  variant = 'info',
  className = '',
}: InfoBannerProps) {
  const [dismissed, setDismissed] = useState(() =>
    storageKey ? localStorage.getItem(storageKey) === '1' : false,
  );

  if (dismissed) return null;

  function handleDismiss() {
    if (storageKey) localStorage.setItem(storageKey, '1');
    setDismissed(true);
  }

  const isWarning = variant === 'warning';
  const Icon = isWarning ? AlertTriangle : Info;

  const style = isWarning
    ? {
        backgroundColor: 'color-mix(in srgb, var(--warning) 12%, var(--surface))',
        border: '1px solid color-mix(in srgb, var(--warning) 35%, var(--border))',
      }
    : {
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
      };

  const iconColor = isWarning ? 'var(--warning)' : 'var(--text-muted)';

  return (
    <div
      className={`relative flex items-start gap-3 rounded-lg px-4 py-3 ${className}`}
      style={style}
    >
      <Icon size={16} className="shrink-0 mt-0.5" style={{ color: iconColor }} />
      <div className="flex-1 pr-6">
        {title && (
          <p
            className="text-xs font-semibold mb-1"
            style={{ color: 'var(--text)' }}
          >
            {title}
          </p>
        )}
        <div
          className="text-xs leading-relaxed"
          style={{ color: 'var(--text-muted)' }}
        >
          {children}
        </div>
      </div>
      {storageKey && (
        <button
          onClick={handleDismiss}
          className="absolute top-2.5 right-2.5 p-0.5 rounded cursor-pointer"
          style={{ color: 'var(--text-muted)' }}
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
