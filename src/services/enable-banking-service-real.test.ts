import { describe, it, expect, vi } from 'vitest';

// enable-banking-service-real pulls in Tauri's HTTP plugin and the API-config
// service (which reads the DB) at import time. Stub both so this pure test of
// the error envelope runs in a vanilla Node + vitest env. jose / constants are
// pure and need no mock.
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
vi.mock('./api-config-service', () => ({ loadApiConfig: vi.fn() }));

// Import must come AFTER the vi.mock calls.
import { EBApiError } from './enable-banking-service-real';

describe('EBApiError', () => {
  const ASPSP_BODY =
    '{"code":400,"message":"Error interacting with ASPSP","detail":"Unknown error","error":"ASPSP_ERROR"}';

  it('parses the EB error envelope into a code', () => {
    const err = new EBApiError(400, ASPSP_BODY);
    expect(err.code).toBe('ASPSP_ERROR');
    expect(err.status).toBe(400);
    expect(err.body).toBe(ASPSP_BODY);
  });

  it('keeps the message byte-identical to the legacy plain Error', () => {
    // The onboarding/sync UI and humanizeCredentialError read .message and
    // substrings of it verbatim - this string must not drift.
    const err = new EBApiError(400, ASPSP_BODY);
    expect(err.message).toBe(`Enable Banking API error 400: ${ASPSP_BODY}`);
  });

  it('leaves code null for a non-JSON body without throwing', () => {
    const err = new EBApiError(502, '<html>Bad Gateway</html>');
    expect(err.code).toBeNull();
    expect(err.status).toBe(502);
  });

  it('leaves code null when the JSON has no string error field', () => {
    expect(new EBApiError(400, '{"message":"nope"}').code).toBeNull();
    expect(new EBApiError(400, '{"error":123}').code).toBeNull();
  });

  it('is an Error subclass (instanceof / name)', () => {
    const err = new EBApiError(403, '{"error":"FORBIDDEN"}');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('EBApiError');
  });
});
