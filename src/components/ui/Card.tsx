import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  highlight?: boolean;
  children: ReactNode;
}

export function Card({ highlight = false, className = '', children, ...props }: CardProps) {
  return (
    <div
      className={`p-5 ${className}`}
      style={{
        borderRadius: 'var(--radius-2)',
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: highlight ? 'var(--elev-2)' : 'var(--elev-1)',
      }}
      {...props}
    >
      {children}
    </div>
  );
}
