import { describe, it, expect, vi } from 'vitest';

// The real Enable Banking client signs a JWT and calls Tauri's HTTP plugin.
// Stub the signing, the credentials and the transport so the test is about
// one thing: how a transaction in the API response is mapped.
vi.mock('jose', () => ({
  importPKCS8: vi.fn(async () => ({})),
  SignJWT: class {
    setProtectedHeader() { return this; }
    setIssuer() { return this; }
    setAudience() { return this; }
    setIssuedAt() { return this; }
    setExpirationTime() { return this; }
    async sign() { return 'test-jwt'; }
  },
}));
vi.mock('./api-config-service', () => ({
  loadApiConfig: vi.fn(async () => ({
    appId: 'app',
    privateKeyPem: 'pem',
    environment: 'sandbox',
  })),
}));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));

import { fetch } from '@tauri-apps/plugin-http';
import { getTransactions } from './enable-banking-service-real';

function respond(body: unknown) {
  vi.mocked(fetch).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response);
}

describe('getTransactions mapping', () => {
  it("keeps both sides' account IBANs, which transfer detection needs", async () => {
    respond({
      transactions: [
        {
          transaction_amount: { amount: '2000.00', currency: 'GBP' },
          credit_debit_indicator: 'DBIT',
          booking_date: '2026-03-20',
          status: 'BOOK',
          creditor: { name: 'MARCO ROSSI' },
          creditor_account: { iban: 'IT60X0542811101000000111222' },
          debtor_account: { iban: 'GB82BARC20000055779911' },
        },
        {
          transaction_amount: { amount: '4.50', currency: 'GBP' },
          credit_debit_indicator: 'DBIT',
          booking_date: '2026-03-21',
          status: 'BOOK',
          creditor: { name: 'CAFE' },
        },
      ],
    });

    const { transactions } = await getTransactions('uid-1');

    expect(transactions[0].creditorIban).toBe('IT60X0542811101000000111222');
    expect(transactions[0].debtorIban).toBe('GB82BARC20000055779911');
    expect(transactions[1].creditorIban).toBeUndefined();
    expect(transactions[1].debtorIban).toBeUndefined();
  });
});
