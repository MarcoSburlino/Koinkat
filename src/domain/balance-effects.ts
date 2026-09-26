import type Big from 'big.js';
import { dec } from './money';

/**
 * How one transaction moves account balances.
 *
 * This is the rule `transaction-service` applies when it writes balances
 * (and reverses on edit/delete), stated once as data so reporting can
 * rebuild a balance from the rows that moved it:
 *
 *   - pending rows move nothing (the bank's balance is the truth until they book);
 *   - income adds `amount_in_account_ccy` to its account, expense subtracts it;
 *   - a transfer subtracts `amount_in_account_ccy` from the source and adds
 *     `amount_in_dest_ccy` to the destination.
 *
 * It is NOT the income/expense rule. A balance moves by the GROSS amount of
 * a split parent, by every repayment, and by both halves of a transfer pair
 * - exactly the rows the income/expense aggregations leave out or net
 * (see `tx-sql.ts`). A reimbursement recorded outside any account
 * (`split_external_reimbursements`) lowers a split's net but moves no
 * balance, so a balance must never be derived from the net.
 */
export interface BalanceEffectRow {
  type: string;
  status: string | null;
  account_id: string;
  destination_account_id: string | null;
  amount_in_account_ccy: string;
  amount_in_dest_ccy: string | null;
}

export interface BalanceEffect {
  accountId: string;
  /** Signed change, in that account's currency. */
  delta: Big;
}

export function balanceEffects(row: BalanceEffectRow): BalanceEffect[] {
  if (row.status === 'pending') return [];
  const amount = dec(row.amount_in_account_ccy);
  switch (row.type) {
    case 'income':
      return [{ accountId: row.account_id, delta: amount }];
    case 'expense':
      return [{ accountId: row.account_id, delta: amount.neg() }];
    case 'transfer': {
      const effects: BalanceEffect[] = [{ accountId: row.account_id, delta: amount.neg() }];
      if (row.destination_account_id && row.amount_in_dest_ccy) {
        effects.push({
          accountId: row.destination_account_id,
          delta: dec(row.amount_in_dest_ccy),
        });
      }
      return effects;
    }
    default:
      return [];
  }
}
