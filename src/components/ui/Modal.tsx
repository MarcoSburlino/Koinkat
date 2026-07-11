import { useEffect, useCallback, type ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /**
   * Width preset. Default ('md') preserves the historical max-w-md; 'lg'
   * and 'xl' give the extra room needed by wizards with multi-column row
   * content.
   */
  size?: 'md' | 'lg' | 'xl';
}

const SIZE_CLASSES: Record<NonNullable<ModalProps['size']>, string> = {
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export function Modal({
  open,
  onClose,
  title,
  children,
  size = 'md',
}: ModalProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      className="kk-modal-backdrop fixed inset-0 flex items-center justify-center p-4"
      style={{
        backgroundColor: 'var(--overlay-scrim)',
        zIndex: 'var(--z-modal)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`kk-modal-panel w-full ${SIZE_CLASSES[size]} p-6 max-h-[90vh] overflow-y-auto`}
        style={{
          borderRadius: 'var(--radius-3)',
          backgroundColor: 'var(--surface)',
          boxShadow: 'var(--elev-3)',
        }}
      >
        {title && (
          <h2
            className="text-lg font-semibold mb-4"
            style={{ color: 'var(--text)', fontFamily: 'var(--font-sans)' }}
          >
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>
  );
}
