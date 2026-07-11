import { SignJWT, importPKCS8 } from 'jose';
import { fetch } from '@tauri-apps/plugin-http';
import { loadApiConfig } from './api-config-service';
import { CONSENT_VALID_DAYS } from '../lib/constants';

const BASE_URL = 'https://api.enablebanking.com';

/**
 * Thrown when Enable Banking rejects a request with HTTP 429
 * (ASPSP_RATE_LIMIT_EXCEEDED). Daily-multiplicity rate limits are a
 * normal protocol-level signal, not a bug - callers in the background
 * sync loop should catch this specifically, log a clean line, and let
 * the next sync cycle retry. Never surface it to the UI as an error.
 */
export class EBRateLimitError extends Error {
  constructor(detail?: string) {
    super(
      detail
        ? `Enable Banking rate limit hit: ${detail}`
        : 'Enable Banking rate limit hit',
    );
    this.name = 'EBRateLimitError';
  }
}

/**
 * Thrown for any non-2xx, non-429 Enable Banking response. Carries the HTTP
 * status and, when the body is EB's `{code,message,detail,error}` envelope,
 * the parsed `error` code (e.g. 'ASPSP_ERROR') so callers can branch on the
 * failure kind without brittle string matching.
 *
 * IMPORTANT: the `message` is kept byte-identical to the plain Error this
 * replaced (`Enable Banking API error <status>: <body>`). The onboarding /
 * sync UI and `humanizeCredentialError` read `.message` (and substrings of
 * it) verbatim, so the surface text must not change.
 */
export class EBApiError extends Error {
  readonly status: number;
  /** Parsed EB `error` code, or null when the body isn't the JSON envelope. */
  readonly code: string | null;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Enable Banking API error ${status}: ${body}`);
    this.name = 'EBApiError';
    this.status = status;
    this.body = body;
    let parsed: string | null = null;
    try {
      const json = JSON.parse(body) as { error?: unknown };
      if (typeof json.error === 'string') parsed = json.error;
    } catch {
      // Non-JSON body (e.g. an HTML gateway error) - leave code null.
    }
    this.code = parsed;
  }
}

// ── Credential loading ──────────────────────────────────────────────────

async function loadCredentials(): Promise<{
  appId: string;
  privateKeyPem: string;
  environment: string;
} | null> {
  const config = await loadApiConfig();
  if (!config.appId || !config.privateKeyPem) return null;
  return {
    appId: config.appId,
    privateKeyPem: config.privateKeyPem,
    environment: config.environment,
  };
}

// ── JWT generation ──────────────────────────────────────────────────────

async function generateJwt(): Promise<string> {
  const creds = await loadCredentials();
  if (!creds) throw new Error('Enable Banking credentials not configured');

  const privateKey = await importPKCS8(creds.privateKeyPem, 'RS256');
  const now = Math.floor(Date.now() / 1000);

  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: creds.appId })
    .setIssuer('enablebanking.com')
    .setAudience('api.enablebanking.com')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  return jwt;
}

// ── HTTP helpers ────────────────────────────────────────────────────────

/**
 * Shared non-OK handling for all three EB verbs (previously duplicated in
 * each). A 429 is the protocol-level rate limit → EBRateLimitError (caught by
 * the sync loop, never surfaced as an error). Any other non-2xx throws a
 * generic error carrying the body text. `acceptNotFound` lets DELETE treat a
 * 404 as success (the session may already be gone). Returns normally when the
 * response is OK or an accepted 404.
 */
async function ensureEBOk(res: Response, acceptNotFound = false): Promise<void> {
  if (res.status === 429) {
    throw new EBRateLimitError(await res.text());
  }
  if (acceptNotFound && res.status === 404) return;
  if (!res.ok) {
    throw new EBApiError(res.status, await res.text());
  }
}

async function apiGet<T>(path: string): Promise<T> {
  const jwt = await generateJwt();
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
  });
  await ensureEBOk(res);
  return res.json() as Promise<T>;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const jwt = await generateJwt();
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  await ensureEBOk(res);
  return res.json() as Promise<T>;
}

async function apiDelete(path: string): Promise<void> {
  const jwt = await generateJwt();
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
  });
  await ensureEBOk(res, true);
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Map the common credential failures to actionable copy. The raw messages
 * (jose's PKCS8 parse errors, EB response bodies) land verbatim in the UI
 * at the most fragile onboarding moment - translate the ones we can
 * recognize, keep the raw text as a suffix for support/debugging.
 */
function humanizeCredentialError(raw: string): string {
  const lower = raw.toLowerCase();
  if (
    lower.includes('pkcs8') ||
    lower.includes('pkcs #8') ||
    lower.includes('invalid pem') ||
    lower.includes('importpkcs8') ||
    (lower.includes('key') && lower.includes('parse'))
  ) {
    return (
      "This doesn't look like a valid private key. Pick the PRIVATE key " +
      '.pem file generated alongside the public key you uploaded to ' +
      `Enable Banking. (${raw})`
    );
  }
  if (lower.includes(' 401') || lower.includes(' 403')) {
    return (
      'Enable Banking rejected the credentials. Check the Application ID ' +
      'and that the matching public key is registered and active in the ' +
      `Control Panel. (${raw})`
    );
  }
  if (
    lower.includes('failed to fetch') ||
    lower.includes('network') ||
    lower.includes('timed out') ||
    lower.includes('connection')
  ) {
    return `Couldn't reach Enable Banking - check your internet connection and try again. (${raw})`;
  }
  return raw;
}

/**
 * Verify credentials by calling GET /application.
 * Returns the error message on failure (null on success).
 */
export async function verifyCredentials(): Promise<string | null> {
  try {
    await apiGet('/application');
    return null;
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return humanizeCredentialError(raw);
  }
}

export interface AspspEntry {
  name: string;
  country: string;
}

export async function listBanks(country: string): Promise<AspspEntry[]> {
  const data = await apiGet<{ aspsps: AspspEntry[] }>(
    `/aspsps?country=${encodeURIComponent(country.toUpperCase())}`,
  );
  return data.aspsps ?? [];
}

export async function startAuthorization(params: {
  bankName: string;
  bankCountry: string;
  redirectUrl: string;
  validUntilDays?: number;
}): Promise<{ url: string; authorizationId: string; state: string }> {
  const validDays = params.validUntilDays ?? CONSENT_VALID_DAYS;
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + validDays);

  const state = crypto.randomUUID();

  const body = {
    aspsp: {
      name: params.bankName,
      country: params.bankCountry.toUpperCase(),
    },
    redirect_url: params.redirectUrl,
    psu_type: 'personal',
    state,
    access: {
      valid_until: validUntil.toISOString(),
      balances: true,
      transactions: true,
    },
  };

  const data = await apiPost<{ url: string; authorization_id: string }>(
    '/auth',
    body,
  );
  return { url: data.url, authorizationId: data.authorization_id, state };
}

export interface EnableBankingAccount {
  uid: string;
  iban?: string;
  currency: string;
  name?: string;
  cashAccountType?: string;
}

export async function createSession(
  authorizationId: string,
  code: string,
): Promise<{
  sessionId: string;
  accounts: EnableBankingAccount[];
}> {
  const data = await apiPost<{
    session_id: string;
    accounts: Array<{
      uid: string;
      iban?: string;
      currency?: string;
      account_id?: { iban?: string };
      name?: string;
      cash_account_type?: string;
    }>;
  }>('/sessions', { authorization_id: authorizationId, code });

  const accounts: EnableBankingAccount[] = (data.accounts ?? []).map((a) => ({
    uid: a.uid,
    iban: a.account_id?.iban ?? a.iban,
    currency: a.currency ?? 'EUR',
    name: a.name,
    cashAccountType: a.cash_account_type,
  }));

  return { sessionId: data.session_id, accounts };
}

export interface BalanceEntry {
  amount: string;
  currency: string;
  balanceType: string;
}

export async function getBalances(
  accountUid: string,
): Promise<BalanceEntry[]> {
  const data = await apiGet<{
    balances: Array<{
      balance_amount: { amount: string; currency: string };
      balance_type: string;
    }>;
  }>(`/accounts/${encodeURIComponent(accountUid)}/balances`);

  return (data.balances ?? []).map((b) => ({
    amount: b.balance_amount.amount,
    currency: b.balance_amount.currency,
    balanceType: b.balance_type,
  }));
}

export interface EnableBankingTransaction {
  amount: string;
  currency: string;
  creditDebitIndicator: 'CRDT' | 'DBIT';
  bookingDate: string;
  transactionDate?: string;
  /**
   * Per-entry settlement status as reported by the bank. PSD2 typically
   * uses 'BOOK' (booked/settled) and 'PDNG' (pending). The reconciler
   * interprets these; see bank-sync-service.ts.
   */
  status: string;
  creditorName?: string;
  debtorName?: string;
  remittanceInformation?: string[];
  entryReference?: string;
  /**
   * The bank's transaction id when the API supplies one separately from
   * `entry_reference`. Stored as a re-match hint for the pending->booked
   * flip. Often absent / unstable on pending entries.
   */
  transactionId?: string;
}

export async function getTransactions(
  accountUid: string,
  options?: {
    continuationKey?: string;
    /** YYYY-MM-DD, inclusive. If omitted, Enable Banking uses bank defaults. */
    dateFrom?: string;
    /** YYYY-MM-DD, inclusive. If omitted, Enable Banking uses bank defaults. */
    dateTo?: string;
    /**
     * Filter the fetch to a single settlement status. PSD2's
     * `transaction_status` query param - 'booked' or 'pending'. Omit to
     * let the bank return its default (usually booked only).
     */
    transactionStatus?: 'booked' | 'pending';
  },
): Promise<{
  transactions: EnableBankingTransaction[];
  continuationKey?: string;
}> {
  let path = `/accounts/${encodeURIComponent(accountUid)}/transactions`;
  const params = new URLSearchParams();
  if (options?.continuationKey) params.set('continuation_key', options.continuationKey);
  if (options?.dateFrom) params.set('date_from', options.dateFrom);
  if (options?.dateTo) params.set('date_to', options.dateTo);
  // Enable Banking's `transaction_status` filter expects ISO 20022 status
  // CODES (BOOK / PDNG), NOT the lowercase 'booked' / 'pending' words. Sending
  // the lowercase form makes the bank return an empty set, so booked imports
  // silently come back with zero rows while the (separate) balance call still
  // succeeds. Map to the code here; callers keep the friendly union.
  if (options?.transactionStatus) {
    const code = options.transactionStatus === 'pending' ? 'PDNG' : 'BOOK';
    params.set('transaction_status', code);
  }
  const qs = params.toString();
  if (qs) path += `?${qs}`;

  const data = await apiGet<{
    transactions: Array<{
      transaction_amount: { amount: string; currency: string };
      credit_debit_indicator: string;
      booking_date: string;
      /** When the transaction actually happened (e.g. the card purchase). */
      transaction_date?: string;
      /** Value date for interest calculation - often equals booking_date. */
      value_date?: string;
      status: string;
      creditor?: { name?: string };
      debtor?: { name?: string };
      remittance_information?: string[];
      entry_reference?: string;
      transaction_id?: string;
    }>;
    continuation_key?: string;
  }>(path);

  const transactions: EnableBankingTransaction[] = (
    data.transactions ?? []
  ).map((t) => ({
    amount: t.transaction_amount.amount,
    currency: t.transaction_amount.currency,
    creditDebitIndicator: t.credit_debit_indicator as 'CRDT' | 'DBIT',
    bookingDate: t.booking_date,
    // Prefer the REAL transaction date. `transaction_date` is when the user
    // transacted; `value_date` is the interest value date, which many banks
    // set to the booking/settlement date - mapping only value_date made
    // every import fall back to the booking date, so rows showed the day
    // the bank posted them instead of the day of the purchase. (The mock
    // dispatcher already read transaction_date ?? value_date; the real
    // client was the one missing the field.)
    transactionDate: t.transaction_date ?? t.value_date,
    status: t.status,
    creditorName: t.creditor?.name,
    debtorName: t.debtor?.name,
    remittanceInformation: t.remittance_information,
    entryReference: t.entry_reference,
    transactionId: t.transaction_id,
  }));

  return { transactions, continuationKey: data.continuation_key };
}

export async function getSessionStatus(
  sessionId: string,
): Promise<{ status: string; accounts: Array<{ uid: string }> }> {
  return apiGet(`/sessions/${encodeURIComponent(sessionId)}`);
}

export async function deleteSession(sessionId: string): Promise<void> {
  await apiDelete(`/sessions/${encodeURIComponent(sessionId)}`);
}
