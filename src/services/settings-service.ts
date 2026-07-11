import type { Settings } from '../types/models';
import type { Theme, DecimalSeparator } from '../types/enums';
import {
  requireActiveKoinkatAccountId,
  getActiveKoinkatAccountId,
} from '../lib/active-koinkat-account';
import {
  getKoinkatAccountById,
  updateKoinkatAccount,
} from './koinkat-account-service';

/**
 * Facade: the Settings struct is backed by the active koinkat account.
 * Kept so existing pages can keep their loadSettings()/updateSettings()
 * call sites without each knowing about koinkat-account-service directly.
 */

export async function loadSettings(): Promise<Settings> {
  const id = getActiveKoinkatAccountId();
  if (!id) {
    return { preferredCurrency: 'EUR', decimalSeparator: ',', theme: 'dark' };
  }
  const account = await getKoinkatAccountById(id);
  if (!account) {
    return { preferredCurrency: 'EUR', decimalSeparator: ',', theme: 'dark' };
  }
  // Coerce removed warm-variant themes to their base equivalents.
  let theme = account.theme as Theme | 'light-alt' | 'dark-alt';
  if (theme === 'light-alt') theme = 'light';
  else if (theme === 'dark-alt') theme = 'dark';
  if (theme !== account.theme) {
    await updateKoinkatAccount(id, { theme });
  }
  return {
    preferredCurrency: account.preferredCurrency,
    decimalSeparator: account.decimalSeparator,
    theme,
  };
}

export async function updateSettings(
  changes: Partial<{
    preferredCurrency: string;
    decimalSeparator: DecimalSeparator;
    theme: Theme;
  }>,
): Promise<void> {
  const id = requireActiveKoinkatAccountId();
  await updateKoinkatAccount(id, changes);
}
