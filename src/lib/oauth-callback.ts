import { OAUTH_CALLBACK_URL } from './constants';

export function parseAuthCallback(
  value: string,
  expected = OAUTH_CALLBACK_URL,
): { code: string; state: string | null } | null {
  try {
    const url = new URL(value);
    const target = new URL(expected);
    if (url.protocol !== target.protocol || url.host !== target.host ||
        url.pathname !== target.pathname || url.username || url.password || url.hash) return null;
    const code = url.searchParams.get('code');
    if (!code || url.searchParams.getAll('code').length !== 1 ||
        url.searchParams.getAll('state').length > 1) return null;
    return { code, state: url.searchParams.get('state') };
  } catch {
    return null;
  }
}
