import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, CalendarRange } from 'lucide-react';
import * as budgetService from '../../services/budget-service';
import type { BudgetEvent } from '../../types/models';

interface BudgetEventPickerProps {
  value: string | null;
  onChange: (eventId: string | null) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  /** Show a "None" option at the top. Defaults to true. */
  allowNull?: boolean;
}

/**
 * Searchable budget-event dropdown. Mirrors CategoryPicker's interaction
 * model (click to open, search to filter, click outside to dismiss).
 *
 * Lists only active (non-expired) events scoped to the active koinkat
 * account. Events are loaded lazily on first open.
 */
export function BudgetEventPicker({
  value,
  onChange,
  label,
  placeholder,
  disabled = false,
  error,
  allowNull = true,
}: BudgetEventPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [events, setEvents] = useState<BudgetEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadEvents = useCallback(async () => {
    const all = await budgetService.listBudgetEvents();
    setEvents(all.filter((e) => !e.isExpired));
    setLoaded(true);
  }, []);

  // If the current value points at an event that isn't in the loaded
  // active list (e.g. it was archived after the link was set), still
  // try to surface its name. We fetch lazily, but only after first open
  // - the trigger button shows a fallback label until then.
  useEffect(() => {
    if (open && !loaded) loadEvents();
  }, [open, loaded, loadEvents]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const byId = new Map(events.map((e) => [e.id, e]));
  const filtered = (() => {
    if (!search) return events;
    const q = search.toLowerCase();
    return events.filter((e) => e.name.toLowerCase().includes(q));
  })();

  const selected = value ? byId.get(value) : null;
  const displayLabel = (() => {
    if (!value) return placeholder ?? 'No event';
    if (selected) return selected.name;
    // Value points to an event we haven't loaded yet (or that's archived).
    return loaded ? 'Unknown event' : 'Loading…';
  })();

  function handleSelect(eventId: string | null) {
    onChange(eventId);
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
            color: selected ? 'var(--input-fg)' : 'var(--text-muted)',
            border: `1px solid ${error ? 'var(--danger)' : 'var(--input-border)'}`,
          }}
        >
          <span className="inline-flex items-center gap-2 truncate">
            {selected && (
              <CalendarRange size={14} style={{ color: 'var(--text-muted)' }} />
            )}
            <span className="truncate">{displayLabel}</span>
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
              maxHeight: '340px',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              className="p-2"
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              <input
                ref={inputRef}
                type="text"
                placeholder="Search events..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-9 rounded-md px-3 text-sm outline-none"
                style={{
                  backgroundColor: 'var(--surface-alt)',
                  color: 'var(--input-fg)',
                  border: 'none',
                }}
              />
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: '260px' }}>
              {allowNull && !search && (
                <button
                  type="button"
                  onClick={() => handleSelect(null)}
                  className="w-full text-left px-3 py-2 text-sm cursor-pointer"
                  style={{
                    color: 'var(--text-muted)',
                    backgroundColor:
                      value === null ? 'var(--nav-active-bg)' : 'transparent',
                  }}
                >
                  No event
                </button>
              )}
              {!loaded ? (
                <p
                  className="text-sm px-3 py-2"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Loading events...
                </p>
              ) : filtered.length === 0 ? (
                <p
                  className="text-sm px-3 py-2"
                  style={{ color: 'var(--text-muted)' }}
                >
                  No events found.
                </p>
              ) : (
                filtered.map((e) => {
                  const isSelected = e.id === value;
                  const dateHint = formatDateHint(e.startDate, e.endDate);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => handleSelect(e.id)}
                      className="w-full text-left px-3 py-2 text-sm cursor-pointer flex items-center gap-2"
                      style={{
                        color: 'var(--text)',
                        backgroundColor: isSelected
                          ? 'var(--nav-active-bg)'
                          : 'transparent',
                        fontWeight: 'var(--fw-regular)',
                      }}
                    >
                      <CalendarRange
                        size={14}
                        style={{ color: 'var(--text-muted)' }}
                      />
                      <span className="truncate">{e.name}</span>
                      {dateHint && (
                        <span
                          className="ml-auto shrink-0 pl-2"
                          style={{
                            color: 'var(--text-muted)',
                            fontSize: 'var(--fs-rate)',
                          }}
                        >
                          {dateHint}
                        </span>
                      )}
                    </button>
                  );
                })
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

// Compact dated-event hint. Returns "" when either bound is missing.
// Examples (en-GB): "10–20 Apr 2026", "28 Dec 2025 – 3 Jan 2026".
function formatDateHint(start: string | null, end: string | null): string {
  if (!start || !end) return '';
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return '';
  const sameMonth =
    s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth();
  const sameYear = s.getFullYear() === e.getFullYear();
  if (sameMonth) {
    const monthYear = s.toLocaleDateString('en-GB', {
      month: 'short',
      year: 'numeric',
    });
    return `${s.getDate()}–${e.getDate()} ${monthYear}`;
  }
  if (sameYear) {
    const sPart = s.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
    });
    const ePart = e.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    return `${sPart} – ${ePart}`;
  }
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  return `${fmt(s)} – ${fmt(e)}`;
}
