import type { InputHTMLAttributes } from 'react';
import { useState } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helpText?: string;
}

export function Input({ label, error, helpText, id, className = '', onFocus, onBlur, ...props }: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
  const [focused, setFocused] = useState(false);

  // Focus ring per design system:
  //   border-color: var(--primary)
  //   box-shadow:   0 0 0 2px var(--focus-ring)
  // Applied via React state so we can avoid a global CSS override.
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
          htmlFor={inputId}
          className="font-medium"
          style={{
            color: 'var(--text-secondary)',
            fontSize: 'var(--fs-body-sm)',
          }}
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={`h-10 px-3 outline-none transition-[border-color,box-shadow] ${className}`}
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
      />
      {error && (
        <p style={{ color: 'var(--danger)', fontSize: 'var(--fs-body-sm)' }}>
          {error}
        </p>
      )}
      {helpText && !error && (
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body-sm)' }}>
          {helpText}
        </p>
      )}
    </div>
  );
}
