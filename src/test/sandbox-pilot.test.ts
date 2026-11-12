import { describe, expect, it } from 'vitest';
import pilot from '../../examples/sandbox/pilot.json';
import { dec, qCent } from '../domain/money';

describe('synthetic sandbox pilot', () => {
  it('has coherent positive decimal amounts and closing balances from an opening zero', () => {
    const account = pilot.accounts[0];
    let balance = dec('0');
    for (const row of account.transactions) {
      expect(typeof row.transaction_amount.amount).toBe('string');
      expect(dec(row.transaction_amount.amount).gt(0)).toBe(true);
      expect(row.transaction_amount.currency).toBe(account.info.currency);
      expect(row.status).toBe('BOOK');
      balance = row.credit_debit_indicator === 'CRDT'
        ? balance.plus(dec(row.transaction_amount.amount))
        : balance.minus(dec(row.transaction_amount.amount));
    }
    expect(account.transactions).toHaveLength(4);
    expect(new Set(account.transactions.map((row) => row.entry_reference)).size).toBe(4);
    for (const closing of account.balances) {
      expect(qCent(balance).toFixed(2)).toBe(closing.balance_amount.amount);
    }
  });
});
