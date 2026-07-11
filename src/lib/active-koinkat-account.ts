// Active koinkat account - the workspace the user is currently inside.
// Every domain service scopes its queries on this id. "Logging out" from
// the app header clears this key but leaves the active user untouched,
// returning the user to the account hub where they can pick another
// workspace or create a new one.

const KEY = 'koinkat_active_koinkat_account_id';

export function getActiveKoinkatAccountId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setActiveKoinkatAccountId(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
}

export function clearActiveKoinkatAccountId(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Require an active koinkat account. Throws if the user has not entered a
 * workspace yet. Domain services call this to scope their SQL queries.
 */
export function requireActiveKoinkatAccountId(): string {
  const id = getActiveKoinkatAccountId();
  if (!id) {
    throw new Error(
      'No active koinkat account. Pick or create one from the account hub.',
    );
  }
  return id;
}
