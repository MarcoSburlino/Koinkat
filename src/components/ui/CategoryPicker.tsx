import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import { CategoryIcon } from './CategoryIcon';
import * as categoryService from '../../services/category-service';
import type { Category } from '../../types/models';
import type { CategoryType } from '../../types/enums';

interface CategoryPickerProps {
  value: string | null;
  onChange: (categoryId: string | null) => void;
  /** If set, filters the picker to categories of this type. */
  type?: CategoryType;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  /** Show a "-- None --" option at the top. Defaults to true. */
  allowNull?: boolean;
  /**
   * Fired when the user triggers the "+ New subcategory" shortcut at
   * the bottom of the picker. If absent, the shortcut is hidden.
   */
  onRequestNewSubcategory?: (parentId: string) => void;
}

/**
 * Searchable category dropdown with macro/subcategory grouping.
 * Mirrors the CurrencyPicker interaction model (click to open, search
 * to filter, click outside to dismiss) and adds a two-level indented
 * list where both macros and their children are selectable.
 *
 * Categories are loaded lazily on first open. Re-opens are free.
 */
export function CategoryPicker({
  value,
  onChange,
  type,
  label,
  placeholder,
  disabled = false,
  error,
  allowNull = true,
  onRequestNewSubcategory,
}: CategoryPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [loaded, setLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Lazy load the tree on first open - and refresh whenever `type`
  // changes so the filter stays in sync.
  const loadCategories = useCallback(async () => {
    const tree = await categoryService.listCategoryTree(type);
    // Flatten for easier rendering + filtering
    const flat: Category[] = [];
    for (const macro of tree) {
      flat.push(macro);
      for (const child of macro.children ?? []) flat.push(child);
    }
    setCategories(flat);
    setLoaded(true);
  }, [type]);

  useEffect(() => {
    setLoaded(false);
    if (open) loadCategories();
  }, [type, loadCategories]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open && !loaded) loadCategories();
  }, [open, loaded, loadCategories]);

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

  // Filter the flat list. When searching, we want to show:
  //   - matching macros (with their own icon)
  //   - matching subcategories (with their parent as a visible header)
  //   - if a macro matches, include ALL its children
  const byId = new Map(categories.map((c) => [c.id, c]));
  const filtered: Category[] = (() => {
    if (!search) return categories;
    const q = search.toLowerCase();
    const keepIds = new Set<string>();
    for (const c of categories) {
      if (c.name.toLowerCase().includes(q)) {
        keepIds.add(c.id);
        if (c.parentId === null) {
          // macro matched → keep all its children
          for (const child of categories) {
            if (child.parentId === c.id) keepIds.add(child.id);
          }
        } else if (c.parentId) {
          // child matched → keep its parent as a visible header
          keepIds.add(c.parentId);
        }
      }
    }
    return categories.filter((c) => keepIds.has(c.id));
  })();

  // Display label for the current value.
  const selected = value ? byId.get(value) : null;
  const displayLabel = (() => {
    if (!selected) return placeholder ?? 'Select category...';
    if (selected.parentId === null) return selected.name;
    const parent = byId.get(selected.parentId);
    return parent ? `${parent.name} / ${selected.name}` : selected.name;
  })();

  function handleSelect(categoryId: string | null) {
    onChange(categoryId);
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
              <CategoryIcon
                name={
                  selected.icon ??
                  (selected.parentId
                    ? byId.get(selected.parentId)?.icon ?? null
                    : null)
                }
                size={14}
                color="var(--text-muted)"
              />
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
                placeholder="Search categories..."
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
                  None
                </button>
              )}
              {!loaded ? (
                <p
                  className="text-sm px-3 py-2"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Loading categories...
                </p>
              ) : filtered.length === 0 ? (
                <p
                  className="text-sm px-3 py-2"
                  style={{ color: 'var(--text-muted)' }}
                >
                  No categories found.
                </p>
              ) : (
                filtered.map((c) => {
                  const isMacro = c.parentId === null;
                  const isSelected = c.id === value;
                  const iconName = isMacro
                    ? c.icon
                    : c.icon ?? byId.get(c.parentId!)?.icon ?? null;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleSelect(c.id)}
                      className="w-full text-left px-3 py-2 text-sm cursor-pointer flex items-center gap-2"
                      style={{
                        color: 'var(--text)',
                        backgroundColor: isSelected
                          ? 'var(--nav-active-bg)'
                          : 'transparent',
                        paddingLeft: isMacro ? '0.75rem' : '2rem',
                        fontWeight: isMacro
                          ? 'var(--fw-medium)'
                          : 'var(--fw-regular)',
                      }}
                    >
                      <CategoryIcon
                        name={iconName}
                        size={14}
                        color={
                          isMacro ? 'var(--text)' : 'var(--text-muted)'
                        }
                      />
                      <span className="truncate">{c.name}</span>
                    </button>
                  );
                })
              )}
            </div>
            {onRequestNewSubcategory && (
              <div
                className="p-2"
                style={{ borderTop: '1px solid var(--border)' }}
              >
                <p
                  className="text-xs px-1"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Tip: open the Categories page to add new subcategories
                  under any macro.
                </p>
              </div>
            )}
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
