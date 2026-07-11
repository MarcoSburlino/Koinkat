import type { ElementType, ReactNode, CSSProperties } from 'react';

/**
 * Wraps any monetary (or otherwise sensitive) value so privacy mode can
 * blank it. Privacy mode hides every DOM node carrying `data-privacy-field`;
 * rendering an amount without that attribute leaks it (CLAUDE.md invariant #7).
 *
 * Use this for new amount nodes instead of hand-adding the attribute, so the
 * marker can never be forgotten. Polymorphic via `as` (defaults to `span`)
 * so it can stand in for a `<strong>`, `<p>`, `<td>`, etc. without changing
 * the surrounding layout.
 */
export function PrivacyField({
  as: Tag = 'span',
  className,
  style,
  title,
  children,
}: {
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  title?: string;
  children: ReactNode;
}) {
  return (
    <Tag className={className} style={style} title={title} data-privacy-field>
      {children}
    </Tag>
  );
}
