import { describe, it, expect } from 'vitest';
import Big from 'big.js';
import {
  dec,
  qCent,
  qRate,
  requirePositiveAmount,
  requireNonNegativeAmount,
  convertAmount,
  tryConvert,
} from './money';

const eqBig = (a: Big, b: Big) => a.eq(b);

describe('dec', () => {
  it('parses a string into Big', () => {
    expect(eqBig(dec('100'), new Big('100'))).toBe(true);
  });

  it('passes through an existing Big as an equal value', () => {
    const input = new Big('42');
    expect(eqBig(dec(input), new Big('42'))).toBe(true);
  });

  it('rejects JS number inputs to prevent float contamination', () => {
    expect(() => dec(100 as unknown as string)).toThrow(/rejects number/);
  });

  it('parses zero', () => {
    expect(eqBig(dec('0'), new Big('0'))).toBe(true);
    expect(eqBig(dec('0.00'), new Big('0'))).toBe(true);
  });

  it('parses negative values', () => {
    expect(eqBig(dec('-50.25'), new Big('-50.25'))).toBe(true);
  });
});

describe('qCent - half-up rounding to 2 decimals', () => {
  it('rounds the half-up boundary upward (positive)', () => {
    expect(eqBig(qCent(new Big('0.005')), new Big('0.01'))).toBe(true);
  });

  it('rounds below half downward', () => {
    expect(eqBig(qCent(new Big('0.004')), new Big('0.00'))).toBe(true);
  });

  it('rounds 0.015 to 0.02', () => {
    expect(eqBig(qCent(new Big('0.015')), new Big('0.02'))).toBe(true);
  });

  it('rounds negative half away from zero (-0.005 -> -0.01)', () => {
    expect(eqBig(qCent(new Big('-0.005')), new Big('-0.01'))).toBe(true);
  });

  it('passes already-quantized values through unchanged', () => {
    expect(eqBig(qCent(new Big('1.23')), new Big('1.23'))).toBe(true);
  });
});

describe('qRate - half-up rounding to 4 decimals', () => {
  it('rounds 0.00005 up to 0.0001', () => {
    expect(eqBig(qRate(new Big('0.00005')), new Big('0.0001'))).toBe(true);
  });

  it('rounds 0.00004 down to 0.0000', () => {
    expect(eqBig(qRate(new Big('0.00004')), new Big('0'))).toBe(true);
  });

  it('rounds 0.00015 up to 0.0002', () => {
    expect(eqBig(qRate(new Big('0.00015')), new Big('0.0002'))).toBe(true);
  });

  it('rounds negative half away from zero (-0.00005 -> -0.0001)', () => {
    expect(eqBig(qRate(new Big('-0.00005')), new Big('-0.0001'))).toBe(true);
  });

  it('passes already-quantized values through unchanged', () => {
    expect(eqBig(qRate(new Big('1.2345')), new Big('1.2345'))).toBe(true);
  });
});

describe('requirePositiveAmount', () => {
  it('accepts a positive whole-number string', () => {
    expect(eqBig(requirePositiveAmount('100'), new Big('100'))).toBe(true);
  });

  it('accepts the smallest positive cent value', () => {
    expect(eqBig(requirePositiveAmount('0.01'), new Big('0.01'))).toBe(true);
  });

  it('quantizes before validating (100.005 -> 100.01)', () => {
    expect(eqBig(requirePositiveAmount('100.005'), new Big('100.01'))).toBe(true);
  });

  it('rounds 0.005 up across the positivity threshold', () => {
    expect(eqBig(requirePositiveAmount('0.005'), new Big('0.01'))).toBe(true);
  });

  it('throws on zero', () => {
    expect(() => requirePositiveAmount('0')).toThrow(/positive/);
  });

  it('throws on a negative value', () => {
    expect(() => requirePositiveAmount('-50')).toThrow(/positive/);
  });

  it('throws when input quantizes to zero (0.004 -> 0.00 fails)', () => {
    expect(() => requirePositiveAmount('0.004')).toThrow(/positive/);
  });
});

describe('requireNonNegativeAmount', () => {
  it('accepts a positive value', () => {
    expect(eqBig(requireNonNegativeAmount('100'), new Big('100'))).toBe(true);
  });

  it('accepts zero', () => {
    expect(eqBig(requireNonNegativeAmount('0'), new Big('0'))).toBe(true);
    expect(eqBig(requireNonNegativeAmount('0.00'), new Big('0'))).toBe(true);
  });

  it('throws on a negative cent', () => {
    expect(() => requireNonNegativeAmount('-0.01')).toThrow(/negative/);
  });

  it('throws on a larger negative value', () => {
    expect(() => requireNonNegativeAmount('-100')).toThrow(/negative/);
  });

  // -0.001 quantizes to 0.00 (closer to 0 than to -0.01), which passes >= 0.
  it('accepts -0.001 because qCent rounds it to 0', () => {
    expect(eqBig(requireNonNegativeAmount('-0.001'), new Big('0'))).toBe(true);
  });
});

describe('convertAmount', () => {
  it('short-circuits same-currency conversion (rate = 1, amount qCented)', () => {
    const result = convertAmount(new Big('100'), 'EUR', 'EUR', {});
    expect(eqBig(result.converted, new Big('100'))).toBe(true);
    expect(eqBig(result.rate, new Big('1'))).toBe(true);
  });

  it('treats same-currency as case-insensitive', () => {
    const result = convertAmount(new Big('100'), 'EUR', 'eur', {});
    expect(eqBig(result.converted, new Big('100'))).toBe(true);
    expect(eqBig(result.rate, new Big('1'))).toBe(true);
  });

  it('computes 100 EUR -> DKK with the canonical rates', () => {
    // 6.8734 / 0.9215 = 7.45892566... -> qRate (5th digit = 2) -> 7.4589
    // 100 * 7.4589 = 745.89 -> qCent -> 745.89
    const rates = { eur: '0.9215', dkk: '6.8734' };
    const result = convertAmount(new Big('100'), 'EUR', 'DKK', rates);
    expect(eqBig(result.rate, new Big('7.4589'))).toBe(true);
    expect(eqBig(result.converted, new Big('745.89'))).toBe(true);
  });

  it('throws when source currency is missing from rates', () => {
    expect(() =>
      convertAmount(new Big('100'), 'GBP', 'EUR', { eur: '1' }),
    ).toThrow();
  });

  it('throws when target currency is missing from rates', () => {
    expect(() =>
      convertAmount(new Big('100'), 'EUR', 'GBP', { eur: '1' }),
    ).toThrow();
  });

  it('lowercases the input currency before rate lookup', () => {
    const rates = { eur: '0.9215', dkk: '6.8734' };
    const upper = convertAmount(new Big('100'), 'EUR', 'DKK', rates);
    const lower = convertAmount(new Big('100'), 'eur', 'dkk', rates);
    const mixed = convertAmount(new Big('100'), 'Eur', 'Dkk', rates);
    expect(eqBig(upper.converted, lower.converted)).toBe(true);
    expect(eqBig(upper.converted, mixed.converted)).toBe(true);
    expect(eqBig(upper.rate, lower.rate)).toBe(true);
  });

  it('throws when the rates object is keyed in uppercase (lookup misses)', () => {
    expect(() =>
      convertAmount(new Big('100'), 'EUR', 'DKK', {
        EUR: '0.9215',
        DKK: '6.8734',
      } as Record<string, string>),
    ).toThrow();
  });
});

describe('tryConvert', () => {
  it('short-circuits same-currency conversion even when rates is null', () => {
    const result = tryConvert(new Big('100'), 'EUR', 'EUR', null);
    expect(result).not.toBeNull();
    expect(eqBig(result as Big, new Big('100'))).toBe(true);
  });

  it('returns null when rates is null and currencies differ', () => {
    expect(tryConvert(new Big('100'), 'EUR', 'DKK', null)).toBeNull();
  });

  it('returns just the converted Big (not an object) when both rates exist', () => {
    const rates = { eur: '0.9215', dkk: '6.8734' };
    const result = tryConvert(new Big('100'), 'EUR', 'DKK', rates);
    expect(result).not.toBeNull();
    expect(eqBig(result as Big, new Big('745.89'))).toBe(true);
  });

  it('returns null instead of throwing when source currency is missing', () => {
    expect(tryConvert(new Big('100'), 'GBP', 'EUR', { eur: '1' })).toBeNull();
  });

  it('returns null instead of throwing when target currency is missing', () => {
    expect(tryConvert(new Big('100'), 'EUR', 'GBP', { eur: '1' })).toBeNull();
  });

  it('returns null when the source rate is zero (division-by-zero guard)', () => {
    expect(
      tryConvert(new Big('100'), 'EUR', 'USD', { eur: '0', usd: '1.0000' }),
    ).toBeNull();
  });

  it('returns the same converted amount as convertAmount when both succeed', () => {
    const rates = { eur: '0.9215', dkk: '6.8734' };
    const tried = tryConvert(new Big('100'), 'EUR', 'DKK', rates);
    const direct = convertAmount(new Big('100'), 'EUR', 'DKK', rates);
    expect(tried).not.toBeNull();
    expect(eqBig(tried as Big, direct.converted)).toBe(true);
  });
});

describe('rounding mode regression', () => {
  // Pins half-up (away from zero) globally. Banker's rounding (half-even)
  // would round 0.025 down to 0.02; half-up rounds it up to 0.03.
  it('qCent uses half-up, not banker\'s rounding (0.025 -> 0.03)', () => {
    expect(eqBig(qCent(new Big('0.025')), new Big('0.03'))).toBe(true);
  });
});
