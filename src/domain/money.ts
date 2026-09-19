import Big from 'big.js';

// Configure big.js: round half-up (standard financial rounding)
Big.RM = Big.roundHalfUp;
Big.DP = 20;
// Push the exponential-notation thresholds out past anything we can produce.
// Defaults are NE = -7 / PE = 21, so a cross rate below 1e-7 (reachable for
// pairs like IRR->KWD) would stringify as "7.1e-8" and land in a TEXT column
// in exponential form. Persistence sites use .toFixed(), which is always
// normal notation, but this closes the path for any incidental String(big).
Big.NE = -30;
Big.PE = 40;

/**
 * Decimal places used when PERSISTING an exchange rate.
 *
 * This is deliberately not 4. A cross rate is `toRate / fromRate`, which for
 * a weak-to-strong pair is far below 0.0001 - VND->USD is 1/25000 = 0.00004,
 * which at 4 dp rounds to ZERO and silently zeroes the converted amount.
 * 12 dp keeps at least six significant digits for every ISO pair in
 * circulation, including the extremes (IRR->KWD is ~7.1e-6).
 *
 * Display formatting is a separate concern - see `qRate`.
 */
export const RATE_DP = 12;

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

/**
 * Quantize to 4 decimal places - for DISPLAYING a rate only.
 *
 * Never use this to compute or persist a conversion: rounding a cross rate
 * to 4 dp before multiplying destroys the amount for any pair whose rate is
 * below 0.0001. Use `crossRate` / `convertAmount` to calculate and
 * `qStoredRate` to persist.
 */
export function qRate(value: Big): Big {
  return value.round(4);
}

/** Quantize a rate for persistence. See {@link RATE_DP}. */
export function qStoredRate(value: Big): Big {
  return value.round(RATE_DP);
}

/**
 * Serialize a rate for a DB column. Always normal notation, never exponential.
 */
export function rateToStorage(value: Big): string {
  return qStoredRate(value).toFixed(RATE_DP);
}

/**
 * A rate is usable only if it is a finite, strictly positive decimal.
 *
 * This lives in TypeScript because the DB cannot enforce it: `amount` and
 * `exchange_rate` are TEXT columns carrying `CHECK (x > 0)`, and SQLite
 * compares a TEXT value against the integer 0 across storage classes, where
 * TEXT always sorts higher. So '0.0000', '-5' and even 'abc' all satisfy
 * those CHECKs. schema-v2.sql is hash-locked and cannot be corrected in
 * place, which makes this function the only real guard.
 */
export function isUsableRate(value: Big | null | undefined): value is Big {
  if (value === null || value === undefined) return false;
  try {
    return value.gt(new Big('0'));
  } catch {
    return false;
  }
}

/** Throw unless `value` is a usable rate. `label` names the failing pair. */
export function requireUsableRate(value: Big | null | undefined, label: string): Big {
  if (!isUsableRate(value)) {
    throw new Error(
      `Refusing to write a non-positive exchange rate for ${label} (got ${String(value)}).`,
    );
  }
  return value;
}

/**
 * The exact cross rate between two currencies, at full precision.
 *
 * Conversion pivots on USD: cross = toRate / fromRate. The result is NOT
 * quantized - callers multiply with it and round only the resulting amount.
 * Throws if `fromRate` is zero.
 */
export function crossRate(fromRate: Big, toRate: Big): Big {
  if (fromRate.eq(new Big('0'))) {
    throw new Error('Cannot convert using a zero source rate');
  }
  return toRate.div(fromRate);
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
  // Name the currency that is actually missing. `dec(undefined)` would
  // throw "[big.js] Invalid number", which tells the user nothing about
  // which rate to go and fetch.
  const fromStr = rates[fromCurrency.toLowerCase()];
  const toStr = rates[toCurrency.toLowerCase()];
  const missing = [
    fromStr ? null : fromCurrency.toUpperCase(),
    toStr ? null : toCurrency.toUpperCase(),
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `No exchange rate available for ${missing.join(' and ')}. ` +
        `Cannot convert ${fromCurrency.toUpperCase()} to ${toCurrency.toUpperCase()}.`,
    );
  }
  const fromRate = dec(fromStr);
  const toRate = dec(toStr);
  // Full precision through the multiply; round ONLY the final amount.
  // Quantizing the cross rate first is what made 1,000,000 VND -> USD
  // return 0.00 instead of 40.00 (1/25000 = 0.00004, which is 0.0000 at 4 dp).
  const rate = crossRate(fromRate, toRate);
  // A zero/negative target rate would otherwise persist as a zero
  // exchange_rate, which the DB's CHECK cannot catch. Fail before the
  // caller writes anything.
  requireUsableRate(rate, `${fromCurrency}->${toCurrency}`);
  const converted = qCent(amount.mul(rate));
  return { converted, rate };
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
  return tryConvertWithRate(amount, fromCurrency, toCurrency, rates)?.converted ?? null;
}

/**
 * As {@link tryConvert}, but also returns the exact rate applied.
 *
 * Use this anywhere the rate is persisted: re-deriving it as
 * `converted.div(amount)` reintroduces the cent-rounding error into the
 * stored `exchange_rate`.
 */
export function tryConvertWithRate(
  amount: Big,
  fromCurrency: string,
  toCurrency: string,
  rates: Record<string, string> | null,
): { converted: Big; rate: Big } | null {
  const src = fromCurrency.toLowerCase();
  const tgt = toCurrency.toLowerCase();
  if (src === tgt) return { converted: qCent(amount), rate: dec('1') };
  if (!rates) return null;
  const fromRateStr = rates[src];
  const toRateStr = rates[tgt];
  if (!fromRateStr || !toRateStr) return null;
  try {
    const fromRate = dec(fromRateStr);
    const toRate = dec(toRateStr);
    if (fromRate.eq(new Big('0'))) return null;
    // Full precision through the multiply; round ONLY the final amount.
    const rate = crossRate(fromRate, toRate);
    if (!isUsableRate(rate)) return null;
    return { converted: qCent(amount.mul(rate)), rate };
  } catch {
    return null;
  }
}
