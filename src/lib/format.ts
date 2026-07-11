import Big from 'big.js';

/**
 * Format a numeric value with thousand separators and two decimals.
 * Port of: Koinkat Demo/app/utils/formatting.py - format_amount()
 */
export function formatAmount(
  value: string | Big,
  decimalSeparator: string = '.',
): string {
  const sep = decimalSeparator === ',' ? ',' : '.';
  const thousandSep = sep === '.' ? ',' : '.';

  let amt: Big;
  try {
    amt = value instanceof Big ? value.round(2) : new Big(value).round(2);
  } catch {
    return String(value);
  }

  const sign = amt.lt(new Big('0')) ? '-' : '';
  const abs = amt.abs();
  const parts = abs.toFixed(2).split('.');
  let whole = parts[0];
  const frac = parts[1];

  const groups: string[] = [];
  while (whole.length > 0) {
    groups.unshift(whole.slice(-3));
    whole = whole.slice(0, -3);
  }
  const intPart = groups.length > 0 ? groups.join(thousandSep) : '0';
  return `${sign}${intPart}${sep}${frac}`;
}

/**
 * Format a money value with currency code appended.
 * Port of: Koinkat Demo/app/utils/formatting.py - format_money()
 */
export function formatMoney(
  value: string | Big,
  currency?: string,
  decimalSeparator: string = '.',
): string {
  const base = formatAmount(value, decimalSeparator);
  return currency ? `${base} ${currency}` : base;
}
