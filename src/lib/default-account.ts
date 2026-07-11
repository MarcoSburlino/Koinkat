import type { Account } from '../types/models';

/**
 * Shared default-account rule for the transaction entry forms:
 * pinned manual → first manual → pinned → first.
 *
 * Manual accounts are where hand-typed entries belong (bank-linked accounts
 * get their rows from sync), so both Create and Transfer must prefer them -
 * and must agree with each other, which they historically didn't.
 */
export function pickDefaultAccount(accounts: Account[]): Account {
  return (
    accounts.find((a) => a.isPinned && a.isManual) ??
    accounts.find((a) => a.isManual) ??
    accounts.find((a) => a.isPinned) ??
    accounts[0]
  );
}
