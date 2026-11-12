import { categoricalColor, CATEGORICAL_SLOTS } from './chart-style';

/**
 * Make account colours distinguishable in a chart. Accounts keep their
 * own colour when it is unique; when two or more share one (the default
 * colour is shared by every account created without picking), the first
 * keeps it and each later one takes the next validated categorical slot
 * not already in use. Input order must be stable (account order), so an
 * account keeps its chart colour while balances change.
 */
export function distinctAccountColors(colors: string[]): string[] {
  const norm = (c: string) => c.trim().toLowerCase();
  const seen = new Set<string>();
  const taken = new Set(colors.map(norm));
  let slot = 0;
  const nextSlot = (): string => {
    while (slot < CATEGORICAL_SLOTS) {
      const c = categoricalColor(slot++);
      if (!taken.has(norm(c))) {
        taken.add(norm(c));
        return c;
      }
    }
    return categoricalColor(CATEGORICAL_SLOTS); // "Other" once slots run out
  };
  return colors.map((c) => {
    const k = norm(c);
    if (!k || seen.has(k)) return nextSlot();
    seen.add(k);
    return c;
  });
}
