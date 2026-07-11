import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

export interface FxPayload {
  date: string;
  rates: Record<string, number>;
}

/**
 * Fetch JSON over two independent transports so a flaky one doesn't break
 * currency conversion app-wide:
 *
 *   1. `@tauri-apps/plugin-http` (Rust `reqwest`) - the default. Bypasses
 *      CORS, but in practice can fail to reach the FX CDN on some setups
 *      even when the OS can.
 *   2. The webview's global `fetch` (WebView2 / WKWebView network stack) -
 *      fallback. The CSP `connect-src` already permits these FX hosts, and
 *      the currency CDN serves `Access-Control-Allow-Origin: *`, so the
 *      webview origin (`tauri://localhost` / `http://tauri.localhost`) is
 *      allowed to read the response.
 *
 * Whichever transport succeeds wins; we only throw if BOTH fail, leaving
 * `fetchRates`' primary→fallback-URL handling to try the next URL.
 */
/**
 * Per-transport timeout. `ensureTodayRates()` is awaited during app
 * bootstrap, so an unbounded fetch against a stalled CDN would hang the
 * startup screen (worst case: 2 transports × 2 URLs in series). 10 s per
 * attempt caps that at ~40 s instead of forever.
 */
const FX_FETCH_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(
  doFetch: (signal: AbortSignal) => Promise<Response>,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FX_FETCH_TIMEOUT_MS);
  try {
    return await doFetch(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url: string): Promise<unknown> {
  try {
    const res = await fetchWithTimeout((signal) =>
      tauriFetch(url, { method: 'GET', signal }),
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (pluginErr) {
    try {
      const res = await fetchWithTimeout((signal) =>
        globalThis.fetch(url, { method: 'GET', signal }),
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (webErr) {
      throw new Error(
        `FX fetch failed on both transports for ${url}: ` +
          `plugin-http=${pluginErr instanceof Error ? pluginErr.message : String(pluginErr)}; ` +
          `webview=${webErr instanceof Error ? webErr.message : String(webErr)}`,
      );
    }
  }
}

/**
 * Fetch exchange rates for a specific date from the fawazahmed0 currency API.
 * @param date - 'latest' for today's rates, or 'YYYY-MM-DD' for historical
 */
export async function fetchRates(date: string): Promise<FxPayload> {
  const isLatest = date === 'latest';

  const primaryUrl = isLatest
    ? 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json'
    : `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/usd.json`;

  const fallbackUrl = isLatest
    ? 'https://latest.currency-api.pages.dev/v1/currencies/usd.json'
    : `https://${date}.currency-api.pages.dev/v1/currencies/usd.json`;

  let data: Record<string, unknown>;
  try {
    data = (await fetchJson(primaryUrl)) as Record<string, unknown>;
  } catch {
    data = (await fetchJson(fallbackUrl)) as Record<string, unknown>;
  }

  const responseDate = data.date as string;
  const usdBlock = data.usd as Record<string, number>;
  if (!responseDate || !usdBlock) {
    throw new Error('Invalid FX API response');
  }

  // Sanity-check: reject any rate that is not a positive finite number.
  // A compromised CDN can at most freeze rates, not inject 10x mis-valuations.
  const sanitized: Record<string, number> = {};
  for (const [k, v] of Object.entries(usdBlock)) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      sanitized[k] = v;
    }
  }

  return { date: responseDate, rates: sanitized };
}

/** Convenience wrapper - fetches today's latest rates. */
export async function fetchLatestRates(): Promise<FxPayload> {
  return fetchRates('latest');
}
