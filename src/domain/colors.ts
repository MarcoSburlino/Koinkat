export const ACCOUNT_COLORS = [
  { slug: 'blue', hex: '#2563eb', label: 'Blue' },
  { slug: 'green', hex: '#16a34a', label: 'Green' },
  { slug: 'red', hex: '#e53935', label: 'Red' },
  { slug: 'amber', hex: '#f59e0b', label: 'Amber' },
  { slug: 'purple', hex: '#7c3aed', label: 'Purple' },
  { slug: 'magenta', hex: '#d946ef', label: 'Magenta' },
  { slug: 'lightgreen', hex: '#65d89a', label: 'Light Green' },
  { slug: 'lightblue', hex: '#38bdf8', label: 'Light Blue' },
  { slug: 'default', hex: '#6b7280', label: 'Default' },
] as const;

export type AccountColorSlug = (typeof ACCOUNT_COLORS)[number]['slug'];

export const DEFAULT_COLOR = '#2563eb';

export function getColorLabel(hex: string): string {
  const found = ACCOUNT_COLORS.find(
    (c) => c.hex.toLowerCase() === hex.toLowerCase(),
  );
  return found?.label ?? 'Custom';
}
