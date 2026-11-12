import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, convert, dec } from '../src/money.js';
import { calculateSchema } from '../src/schemas.js';

function calc(operation: string, values: string[], currencies?: (string | undefined)[]) {
  return calculate(calculateSchema.parse({ operation, operands: values.map((value, i) => ({ value, currency: currencies?.[i] })) }));
}

test('decimal calculations avoid floating point drift and preserve large values', () => {
  assert.equal(calc('sum', ['0.1', '0.2']).value, '0.30');
  assert.equal(calc('sum', ['99999999999999999999.99', '0.01']).value, '100000000000000000000.00');
  assert.equal(calc('subtract', ['100', '30', '5']).value, '65.00');
  assert.equal(calc('average', ['1', '2', '2']).value, '1.67');
  assert.equal(calc('multiply', ['12.50', '0.8'], ['EUR', undefined]).value, '10.00');
  assert.equal(calc('divide', ['100', '3']).value, '33.33');
  assert.equal(calc('percentage_of', ['25', '200'], ['EUR', 'EUR']).value, '12.50');
  assert.equal(calc('percentage_change', ['100', '125']).value, '25.00');
  assert.equal(calc('percentage_change', ['-100', '-80']).value, '20.00');
});

test('division by zero, mixed currencies, incompatible units and executable input fail', () => {
  assert.throws(() => calc('divide', ['1', '0']));
  assert.throws(() => calc('percentage_change', ['0', '1']));
  assert.throws(() => calc('sum', ['1', '2'], ['EUR', 'DKK']), /matching currencies/);
  assert.throws(() => calc('sum', ['1', '2'], ['EUR', undefined]), /matching currencies/);
  assert.throws(() => calc('multiply', ['1', '2'], ['EUR', 'EUR']), /at most one/);
  assert.throws(() => calc('divide', ['1', '2'], [undefined, 'EUR']), /incompatible/);
  assert.throws(() => calc('divide', ['1', '2', '3']), /exactly two/);
  assert.throws(() => calc('sum', ['process.exit()']));
  assert.throws(() => calc('sum', ['1e1000000000']));
  assert.throws(() => dec(0.1 as unknown as string), /decimal strings/);
});

test('conversion retains weak currency rates and handles unavailable/invalid rates', () => {
  const rates = { date: '2026-11-01', values: { usd: '1', vnd: '25000', eur: '0.8', broken: '0' } };
  assert.equal(convert('1000000', 'VND', 'USD', rates)?.toFixed(2), '40.00');
  assert.equal(convert('1000000', 'VND', 'EUR', rates)?.toFixed(2), '32.00');
  assert.equal(convert('1', 'EUR', 'EUR', null)?.toFixed(2), '1.00');
  assert.equal(convert('1', 'EUR', 'JPY', rates), null);
  assert.equal(convert('1', 'EUR', 'USD', { date: rates.date, values: { eur: '-1', usd: '1' } }), null);
});
