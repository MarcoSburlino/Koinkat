import Big from 'big.js';
import { calculateSchema, type Calculation } from './schemas.js';

Big.DP = 40;
Big.RM = Big.roundHalfUp;
Big.NE = -50;
Big.PE = 80;

export function dec(value: string): Big {
  if (typeof value !== 'string') throw new Error('Amounts must be decimal strings');
  return new Big(value);
}

export interface Rates { date: string; values: Record<string, string> }

export function convert(amount: string, from: string, to: string, rates: Rates | null): Big | null {
  if (from === to) return dec(amount).round(2);
  const source = rates?.values[from.toLowerCase()];
  const target = rates?.values[to.toLowerCase()];
  if (!source || !target) return null;
  try {
    const a = dec(source), b = dec(target);
    if (a.lte(0) || b.lte(0)) return null;
    // Keep the cross rate at full precision; round only the resulting amount.
    return dec(amount).times(b.div(a)).round(2);
  } catch { return null; }
}

export function calculate(input: Calculation) {
  const { operation, operands, decimalPlaces } = calculateSchema.parse(input);
  const values = operands.map(v => dec(v.value));
  const units = operands.map(v => v.currency ?? null);
  const first = values[0]!;
  const sameUnit = () => {
    if (units.some(u => u !== units[0])) throw new Error('Operands must have matching currencies or all be unitless');
  };
  const pair = () => { if (values.length !== 2) throw new Error('This operation requires exactly two operands'); };
  let result: Big;
  let unit: string | null = units[0]!;
  switch (operation) {
    case 'sum': sameUnit(); result = values.reduce((a, b) => a.plus(b), dec('0')); break;
    case 'subtract':
      if (values.length < 2) throw new Error('Subtraction requires at least two operands');
      sameUnit(); result = values.slice(1).reduce((a, b) => a.minus(b), first); break;
    case 'average': sameUnit(); result = values.reduce((a, b) => a.plus(b), dec('0')).div(values.length); break;
    case 'multiply':
      pair();
      if (units.filter(Boolean).length > 1) throw new Error('Multiplication accepts at most one monetary operand');
      unit = units.find(Boolean) ?? null;
      result = first.times(values[1]!); break;
    case 'divide':
      pair();
      if (units[1] !== null && units[1] !== units[0]) throw new Error('Cannot divide by an incompatible currency');
      unit = units[1] === null ? units[0]! : null;
      result = first.div(values[1]!); break;
    case 'percentage_of':
      pair(); sameUnit(); unit = 'percent'; result = first.div(values[1]!).times(100); break;
    case 'percentage_change':
      pair(); sameUnit(); unit = 'percent'; result = values[1]!.minus(first).div(first.abs()).times(100); break;
  }
  return { operation, value: result.toFixed(decimalPlaces), unit, rounding: 'half-up', decimalPlaces };
}
