// Enable Banking service dispatcher.
//
// This module is the single public entry point for every bank-API call in
// the app. It dispatches between the real HTTP-driven implementation
// (`enable-banking-service-real.ts`) and the fixture-backed mock
// (`src/mocks/mock-enable-banking-service.ts`) based on the compile-time
// flags `__KOINKAT_ALLOW_MOCKS__` and `__KOINKAT_EB_MOCK_DEFAULT__`.
//
// Why a dispatcher and not `export * from ...`:
// - The mock was authored before the real service contract settled, so
//   its function names and shapes drifted (e.g. `startAuth(name, country,
//   redirectUrl)` vs `startAuthorization({bankName, bankCountry,
//   redirectUrl})`, `createSession(code)` vs `createSession(authId, code)`,
//   snake_case response fields vs camelCase).
// - This file normalizes every mock response to the exact shape the real
//   service returns, so `bank-sync-service.ts` + `BankLink.tsx` can call
//   the same functions with the same arguments regardless of mode.
//
// Callers import from here (`./enable-banking-service`). They should
// never import from `-real` or `../mocks/*` directly.

import * as realService from './enable-banking-service-real';
import * as mockService from '../mocks/mock-enable-banking-service';
import type {
  AspspEntry,
  EnableBankingAccount,
  BalanceEntry,
  EnableBankingTransaction,
} from './enable-banking-service-real';
import { EBRateLimitError, EBApiError } from './enable-banking-service-real';

// Re-export the shared public types so callers can `import type { ... }`
// from the dispatcher instead of reaching into `-real`.
export type {
  AspspEntry,
  EnableBankingAccount,
  BalanceEntry,
  EnableBankingTransaction,
};

// Re-export the rate-limit sentinel so bank-sync callers can branch on
// `err instanceof EBRateLimitError` without importing from `-real`. Same for
// `EBApiError`, so the sync layer can branch on ASPSP-side rejections.
export { EBRateLimitError, EBApiError };

// __KOINKAT_ALLOW_MOCKS__ is replaced with the literal `false` in
// production bundles. That short-circuits IS_MOCK to `false`, dead-codes
// every `if (IS_MOCK)` branch below, and leaves the `mockService`
// namespace import unreferenced - Rollup then tree-shakes the whole
// `src/mocks/` chunk out of the production bundle.
// __KOINKAT_EB_MOCK_DEFAULT__ is true only in demo builds.
const IS_MOCK = __KOINKAT_ALLOW_MOCKS__ && __KOINKAT_EB_MOCK_DEFAULT__;

// ── listBanks ──────────────────────────────────────────────────────────

export async function listBanks(country: string): Promise<AspspEntry[]> {
  if (IS_MOCK) {
    const list = await mockService.listBanks(country);
    return list.map((b) => ({ name: b.name, country: b.country }));
  }
  return realService.listBanks(country);
}

// ── verifyCredentials ──────────────────────────────────────────────────

export async function verifyCredentials(): Promise<string | null> {
  // In mock mode there are no real credentials to verify - always succeed.
  if (IS_MOCK) return null;
  return realService.verifyCredentials();
}

// ── startAuthorization ─────────────────────────────────────────────────
//
// Mock takes positional args and returns snake_case `authorization_id`.
// Real takes a param object and returns `authorizationId`. Normalize.

export async function startAuthorization(params: {
  bankName: string;
  bankCountry: string;
  redirectUrl: string;
  validUntilDays?: number;
}): Promise<{ url: string; authorizationId: string; state: string }> {
  if (IS_MOCK) {
    const res = await mockService.startAuth(
      params.bankName,
      params.bankCountry,
      params.redirectUrl,
    );
    // Mock mode bypasses the deep-link flow entirely; return a dummy state.
    return { url: res.url, authorizationId: res.authorization_id, state: crypto.randomUUID() };
  }
  return realService.startAuthorization(params);
}

// ── createSession ──────────────────────────────────────────────────────
//
// Mock's createSession takes only `code` (ignores authorizationId) and
// returns the raw fixture with snake_case fields. Real expects both args
// and returns normalized `{sessionId, accounts}`. Normalize the mock
// output to match.

export async function createSession(
  authorizationId: string,
  code: string,
): Promise<{ sessionId: string; accounts: EnableBankingAccount[] }> {
  if (IS_MOCK) {
    const raw = (await mockService.createSession(code)) as {
      session_id: string;
      accounts?: Array<{
        uid: string;
        iban?: string;
        currency?: string;
        account_id?: { iban?: string };
        name?: string;
        cash_account_type?: string;
      }>;
    };
    const accounts: EnableBankingAccount[] = (raw.accounts ?? []).map((a) => ({
      uid: a.uid,
      iban: a.account_id?.iban ?? a.iban,
      currency: a.currency ?? 'EUR',
      name: a.name,
      cashAccountType: a.cash_account_type,
    }));
    return { sessionId: raw.session_id, accounts };
  }
  return realService.createSession(authorizationId, code);
}

// ── getBalances ────────────────────────────────────────────────────────
//
// Mock's fixture can store balances in two shapes depending on how it
// was authored - either the raw Enable Banking shape (nested
// `balance_amount.amount`) or a flat shape. Handle both.

export async function getBalances(accountUid: string): Promise<BalanceEntry[]> {
  if (IS_MOCK) {
    const raw = (await mockService.getBalances(accountUid)) as unknown;
    const rawBalances: Array<Record<string, unknown>> = Array.isArray(raw)
      ? (raw as Array<Record<string, unknown>>)
      : (((raw as { balances?: Array<Record<string, unknown>> }).balances) ?? []);
    return rawBalances.map((b) => {
      const nested = b.balance_amount as
        | { amount?: string; currency?: string }
        | undefined;
      return {
        amount: nested?.amount ?? (b.amount as string),
        currency: nested?.currency ?? (b.currency as string),
        balanceType:
          (b.balance_type as string | undefined) ??
          (b.balanceType as string) ??
          'CLBD',
      };
    });
  }
  return realService.getBalances(accountUid);
}

// ── getTransactions ────────────────────────────────────────────────────
//
// Mock takes positional `(accountUid, dateFrom, dateTo, continuationKey?)`
// and returns `{ transactions, continuation_key }` with snake_case tx
// fields. Real takes `(accountUid, options)` with camelCase. Normalize.

export async function getTransactions(
  accountUid: string,
  options?: {
    continuationKey?: string;
    dateFrom?: string;
    dateTo?: string;
    transactionStatus?: 'booked' | 'pending';
  },
): Promise<{
  transactions: EnableBankingTransaction[];
  continuationKey?: string;
}> {
  if (IS_MOCK) {
    const raw = await mockService.getTransactions(
      accountUid,
      options?.dateFrom ?? '1970-01-01',
      options?.dateTo ?? '9999-12-31',
      options?.transactionStatus,
      options?.continuationKey,
    );
    const rawTxs: Array<Record<string, unknown>> = (raw.transactions ??
      []) as Array<Record<string, unknown>>;
    const transactions: EnableBankingTransaction[] = rawTxs.map((t) => {
      const amt = t.transaction_amount as
        | { amount?: string; currency?: string }
        | undefined;
      const creditor = t.creditor as { name?: string } | undefined;
      const debtor = t.debtor as { name?: string } | undefined;
      return {
        amount: amt?.amount ?? (t.amount as string),
        currency: amt?.currency ?? (t.currency as string),
        creditDebitIndicator: (t.credit_debit_indicator ??
          t.creditDebitIndicator) as 'CRDT' | 'DBIT',
        bookingDate: (t.booking_date as string) ?? (t.bookingDate as string),
        transactionDate:
          // Fixtures and EB API responses differ on the field name for the
          // value/transaction date. Try both snake_case forms (and the
          // camelCase normalised one) so mock mode actually populates
          // `transactionDate` when the fixture has it.
          (t.transaction_date as string | undefined) ??
          (t.value_date as string | undefined) ??
          (t.transactionDate as string | undefined),
        status: (t.status as string) ?? 'BOOK',
        creditorName: creditor?.name ?? (t.creditorName as string | undefined),
        debtorName: debtor?.name ?? (t.debtorName as string | undefined),
        remittanceInformation:
          (t.remittance_information as string[] | undefined) ??
          (t.remittanceInformation as string[] | undefined),
        entryReference:
          (t.entry_reference as string | undefined) ??
          (t.entryReference as string | undefined),
        transactionId:
          (t.transaction_id as string | undefined) ??
          (t.transactionId as string | undefined),
      };
    });
    return {
      transactions,
      continuationKey: raw.continuation_key ?? undefined,
    };
  }
  return realService.getTransactions(accountUid, options);
}

// ── getSessionStatus ───────────────────────────────────────────────────

export async function getSessionStatus(
  sessionId: string,
): Promise<{ status: string; accounts: Array<{ uid: string }> }> {
  if (IS_MOCK) {
    const res = await mockService.getSessionStatus(sessionId);
    return { status: res.status, accounts: [] };
  }
  return realService.getSessionStatus(sessionId);
}

// ── deleteSession ──────────────────────────────────────────────────────

export async function deleteSession(sessionId: string): Promise<void> {
  if (IS_MOCK) {
    await mockService.deleteSession(sessionId);
    return;
  }
  await realService.deleteSession(sessionId);
}
