// Deep-link listener path. Used by the Tauri `plugin-deep-link` subscription
// in BankLink to receive the auth code back from the OS when the static
// callback page bounces to `koinkat://auth-callback?code=...`. Never sent to
// Enable Banking - EB only accepts https:// URLs as registered redirect URIs.
export const OAUTH_CALLBACK_URL = 'koinkat://auth-callback';

// Koinkat's shared HTTPS callback page - the pre-filled default for the
// redirect URL. The page is fully generic and holds no secrets: it reads
// `?code=&state=` and bounces them into `koinkat://auth-callback` (an
// intercepted code is useless without the user's own private key, and the
// CSRF state check binds the callback to the session that started it).
// Every user must still register this exact URL (trailing slash included -
// EB matches exactly) on THEIR OWN Enable Banking application; the field
// stays editable for users who prefer to host their own page.
export const DEFAULT_CALLBACK_URL =
  'https://marcosburlino.github.io/koinkat-callback/';

// PSD2 consent window requested from Enable Banking, in days. The regulation
// caps it at 180; we request 179 so the stored expiry can never claim the
// session is alive on a day the API would already reject. The SAME constant
// must drive both the POST /auth `valid_until` request and the local
// `bank_connections.valid_until` bookkeeping - they were once 179 vs 180,
// which made syncs fail with a confusing API error on the final day.
export const CONSENT_VALID_DAYS = 179;
