import type { SelectHTMLAttributes } from 'react';
import { useState } from 'react';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
}

export function Select({ label, error, options, id, className = '', onFocus, onBlur, ...props }: SelectProps) {
  const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
  const [focused, setFocused] = useState(false);

  const borderColor = error
    ? 'var(--danger)'
    : focused
      ? 'var(--primary)'
      : 'var(--input-border)';
  const boxShadow = focused ? '0 0 0 3px var(--focus-ring)' : 'none';

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label
          htmlFor={selectId}
          className="font-medium"
          style={{
            color: 'var(--text-secondary)',
            fontSize: 'var(--fs-body-sm)',
          }}
        >
          {label}
        </label>
      )}
      <select
        id={selectId}
        className={`h-10 px-3 outline-none cursor-pointer transition-[border-color,box-shadow] ${className}`}
        style={{
          borderRadius: 'var(--radius-1)',
          backgroundColor: 'var(--input-bg)',
          color: 'var(--input-fg)',
          fontSize: 'var(--fs-body)',
          border: `1px solid ${borderColor}`,
          boxShadow,
          transitionDuration: 'var(--dur-quick)',
          transitionTimingFunction: 'var(--ease-standard)',
        }}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && (
        <p style={{ color: 'var(--danger)', fontSize: 'var(--fs-body-sm)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
