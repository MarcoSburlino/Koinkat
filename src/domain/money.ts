import Big from 'big.js';

// Configure big.js: round half-up (standard financial rounding)
Big.RM = Big.roundHalfUp;
Big.DP = 20;

/** Parse a value to Big. Rejects JS number type to prevent float contamination. */
export function dec(value: string | Big): Big {
  if (typeof value === 'number') {
    throw new Error('dec() rejects number type to prevent float contamination. Use strings.');
  }
  return new Big(value);
}

/** Quantize to 2 decimal places (cents). */
export function qCent(value: Big): Big {
  return value.round(2);
}

/** Quantize to 4 decimal places (exchange rates). */
export function qRate(value: Big): Big {
  return value.round(4);
}

/** Parse and validate positive amount, return quantized to cents. */
export function requirePositiveAmount(value: string): Big {
  const d = qCent(dec(value));
  if (d.lte(new Big('0'))) throw new Error('Amount must be positive');
  return d;
}

/** Parse and validate non-negative amount, return quantized to cents. */
export function requireNonNegativeAmount(value: string): Big {
  const d = qCent(dec(value));
  if (d.lt(new Big('0'))) throw new Error('Amount must not be negative');
  return d;
}

/**
 * Convert amount between currencies using rates object.
 * Conversion uses USD as pivot: cross_rate = toRate / fromRate
 *
 * Throws if either currency is missing from the rates object. Prefer
 * `tryConvert` at aggregation sites where a single missing rate should
 * not crash the whole computation.
 */
export function convertAmount(
  amount: Big,
  fromCurrency: string,
  toCurrency: string,
  rates: Record<string, string>,
): { converted: Big; rate: Big } {
  if (fromCurrency.toLowerCase() === toCurrency.toLowerCase()) {
    return { converted: qCent(amount), rate: dec('1') };
  }
  const fromRate = dec(rates[fromCurrency.toLowerCase()]);
  const toRate = dec(rates[toCurrency.toLowerCase()]);
  const crossRate = qRate(toRate.div(fromRate));
  const converted = qCent(amount.mul(crossRate));
  return { converted, rate: crossRate };
}

/**
 * Safe variant of {@link convertAmount} for aggregation sites that sum
 * cross-currency rows. Returns `null` when the conversion cannot be done
 * (rates missing, unknown currency, etc.) instead of throwing.
 *
 * Call sites must NEVER add the raw (un-converted) amount to a
 * target-currency total when this returns `null` - a DKK amount added to
 * a EUR total as if it were EUR inflates the total by ~13×. The correct
 * behaviour is to SKIP the row and surface that some amounts couldn't be
 * reconciled via a separate flag on the aggregation result.
 */
export function tryConvert(
  amount: Big,
  fromCurrency: string,
  toCurrency: string,
  rates: Record<string, string> | null,
): Big | null {
  const src = fromCurrency.toLowerCase();
  const tgt = toCurrency.toLowerCase();
  if (src === tgt) return qCent(amount);
  if (!rates) return null;
  const fromRateStr = rates[src];
  const toRateStr = rates[tgt];
  if (!fromRateStr || !toRateStr) return null;
  try {
    const fromRate = dec(fromRateStr);
    const toRate = dec(toRateStr);
    if (fromRate.eq(new Big('0'))) return null;
    const crossRate = qRate(toRate.div(fromRate));
    return qCent(amount.mul(crossRate));
  } catch {
    return null;
  }
}
