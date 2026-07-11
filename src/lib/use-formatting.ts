import { useCallback } from 'react';
import type Big from 'big.js';
import { useAppStore } from '../stores/app-store';
import { formatAmount as fmtAmount, formatMoney as fmtMoney } from './format';

/**
 * Money-formatting helpers pre-bound to the active workspace's
 * `decimalSeparator`, so pages stop threading `settings.decimalSeparator`
 * through every `formatAmount`/`formatMoney` call (and can't accidentally
 * use the wrong separator). Pure wrapper over `lib/format.ts` - no change to
 * the formatting logic itself. Adopt opportunistically; both styles coexist.
 */
export function useFormatting() {
  const decimalSeparator = useAppStore((s) => s.settings.decimalSeparator);

  const formatAmount = useCallback(
    (value: string | Big) => fmtAmount(value, decimalSeparator),
    [decimalSeparator],
  );

  const formatMoney = useCallback(
    (value: string | Big, currency?: string) =>
      fmtMoney(value, currency, decimalSeparator),
    [decimalSeparator],
  );

  return { formatAmount, formatMoney, decimalSeparator };
}
