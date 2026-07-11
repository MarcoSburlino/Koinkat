// Active user is tracked in localStorage so UI guards and services
// can check "who is logged in" without threading userId everywhere.
//
// The user is the top of the hierarchy:
//   User → KoinkatAccount → Account → Transaction
// Services that need workspace scoping use `active-koinkat-account.ts`
// instead - requireActiveKoinkatAccountId() is the one that gates
// domain queries. This file only answers "is someone logged in?"

const KEY = 'koinkat_active_user_id';

export function getActiveUserId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setActiveUserId(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
}

export function clearActiveUserId(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Require an active user. Throws if nobody is logged in.
 */
export function requireActiveUserId(): string {
  const id = getActiveUserId();
  if (!id) {
    throw new Error('No active user. Someone must log in or register first.');
  }
  return id;
}
