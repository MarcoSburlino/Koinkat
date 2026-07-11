import { useState, useRef, useEffect } from 'react';
import { ISO_4217_CURRENCIES, CURRENCY_CODES } from '../../domain/currencies';
import { ChevronDown } from 'lucide-react';

interface CurrencyPickerProps {
  value: string;
  onChange: (code: string) => void;
  label?: string;
  disabled?: boolean;
  error?: string;
}

export function CurrencyPicker({
  value,
  onChange,
  label,
  disabled = false,
  error,
}: CurrencyPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = CURRENCY_CODES.filter((code) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      code.toLowerCase().includes(q) ||
      ISO_4217_CURRENCIES[code].toLowerCase().includes(q)
    );
  });

  function handleSelect(code: string) {
    onChange(code);
    setOpen(false);
    setSearch('');
  }

  return (
    <div className="flex flex-col gap-1.5" ref={containerRef}>
      {label && (
        <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>
          {label}
        </span>
      )}
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (!disabled) {
              setOpen(!open);
              setTimeout(() => inputRef.current?.focus(), 0);
            }
          }}
          className="w-full h-11 rounded-lg px-3 text-sm text-left flex items-center justify-between cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            backgroundColor: 'var(--input-bg)',
            color: 'var(--input-fg)',
            border: `1px solid ${error ? 'var(--danger)' : 'var(--input-border)'}`,
          }}
        >
          <span>
            {value ? `${value}: ${ISO_4217_CURRENCIES[value] ?? ''}` : 'Select currency...'}
          </span>
          <ChevronDown size={16} style={{ color: 'var(--text-muted)' }} />
        </button>

        {open && (
          <div
            className="absolute top-full left-0 right-0 mt-1 rounded-lg overflow-hidden"
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              boxShadow: 'var(--elev-3)',
              zIndex: 'var(--z-dropdown)',
              maxHeight: '280px',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div className="p-2" style={{ borderBottom: '1px solid var(--border)' }}>
              <input
                ref={inputRef}
                type="text"
                placeholder="Search currencies..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-9 rounded-md px-3 text-sm outline-none"
                style={{
                  backgroundColor: 'var(--surface-2)',
                  color: 'var(--input-fg)',
                  border: 'none',
                }}
              />
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: '230px' }}>
              {filtered.length === 0 ? (
                <p
                  className="text-sm px-3 py-2"
                  style={{ color: 'var(--text-muted)' }}
                >
                  No currencies found
                </p>
              ) : (
                filtered.map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => handleSelect(code)}
                    className="w-full text-left px-3 py-2 text-sm transition-colors hover:opacity-80 cursor-pointer"
                    style={{
                      color: 'var(--text)',
                      backgroundColor:
                        code === value ? 'var(--nav-active-bg)' : 'transparent',
                    }}
                  >
                    <span className="font-medium">{code}</span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      {' '}&mdash; {ISO_4217_CURRENCIES[code]}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
      {error && (
        <p className="text-xs" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
