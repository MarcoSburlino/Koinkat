import { withTransaction } from '../db/database';
import { loadApiConfig, clearCredentials, deletePemSecret } from './api-config-service';
import { requireActiveKoinkatAccountId } from '../lib/active-koinkat-account';

/**
 * Check if sandbox mode is active for the current profile.
 */
export async function isSandboxMode(): Promise<boolean> {
  const config = await loadApiConfig();
  return config.isDemoMode;
}

/**
 * Exit sandbox mode for the current profile: clear sandbox credentials
 * and delete all sandbox-linked accounts, connections, and transactions
 * that belong to this profile.
 */
export async function deactivateSandbox(): Promise<void> {
  const koinkatAccountId = requireActiveKoinkatAccountId();

  // Atomic: a failure mid-way previously left a half-deactivated state
  // (e.g. accounts gone but is_demo_mode still set).
  await withTransaction(async (tx) => {
    // Delete this profile's bank-imported accounts (non-manual) and their dependents.
    // Transactions cascade with accounts in v1 schema.
    await tx.execute(
      'DELETE FROM linked_accounts WHERE koinkat_account_id = ?',
      [koinkatAccountId],
    );
    await tx.execute(
      'DELETE FROM bank_connections WHERE koinkat_account_id = ?',
      [koinkatAccountId],
    );
    await tx.execute(
      'DELETE FROM accounts WHERE koinkat_account_id = ? AND is_manual = 0',
      [koinkatAccountId],
    );

    // Clear credentials for this profile (resets is_demo_mode and is_configured).
    // With `tx` passed, clearCredentials skips the keychain IPC - an invoke
    // must not hold the serialize-queue transaction open.
    await clearCredentials(tx);
  });

  // Keychain cleanup AFTER the commit (best-effort; same pattern as
  // deleteKoinkatAccount).
  await deletePemSecret(koinkatAccountId);
}
