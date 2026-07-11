import { getDb, type DbExecutor } from '../db/database';
import { fetchLatestRates, fetchRates } from '../lib/fx-fetch';
import { format } from 'date-fns';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Parse a rates_json DB value into Record<string, string>. */
function parseRatesJson(json: string): Record<string, string> {
  let raw: Record<string, number>;
  try {
    raw = JSON.parse(json) as Record<string, number>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Corrupt exchange-rate cache row: ${msg}`);
  }
  // JSON.parse('null') / a non-object literal parse fine but would make
  // Object.entries throw a bare TypeError - fold that into the same
  // diagnosable error as a parse failure.
  if (raw === null || typeof raw !== 'object') {
    throw new Error(
      `Corrupt exchange-rate cache row: expected an object, got ${JSON.stringify(raw)}`,
    );
  }
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    result[k] = String(v);
  }
  return result;
}

/**
 * Cache the full rates object for a specific date. We store EVERY currency
 * the API returns - about 50KB of JSON - so any cross-currency conversion
 * the app might need later succeeds regardless of which accounts exist at
 * cache-write time.
 *
 * Historical note: an earlier version filtered the cache to only the
 * user's currencies at cache-write time. That introduced a staleness bug
 * where adding a new DKK account AFTER today's cache was written would
 * leave every DKK display-time conversion without rates and silently fall
 * through to "treat DKK as EUR", corrupting aggregates across the app.
 * The fix is simply to cache everything.
 */
async function cacheFullRates(
  rateDate: string,
  rates: Record<string, number>,
): Promise<Record<string, string>> {
  const db = await getDb();

  rates['usd'] = 1;

  await db.execute(
    'INSERT OR REPLACE INTO exchange_rates (rate_date, rates_json) VALUES (?, ?)',
    [rateDate, JSON.stringify(rates)],
  );

  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(rates)) {
    result[k] = String(v);
  }
  return result;
}

// ── Public API ─────────────────────────────────────────────────────────────

/** Minimum size a cached rates row must have to be trusted as "full". */
const FULL_CACHE_MIN_KEYS = 50;

/**
 * Called on app launch (blocking - must complete before UI renders) and
 * from the manual Sync button. Fetches today's rates from the API and
 * caches the FULL rate set (every currency the API returns).
 *
 * If today is already cached AND the cached row has broad coverage
 * (≥ {@link FULL_CACHE_MIN_KEYS} keys), this is a no-op. If today's
 * cache is smaller - a sign it came from an older build that filtered
 * rates down to a handful of account currencies - we re-fetch so the
 * full set is available for every downstream aggregation.
 *
 * If fetch fails, previous cached rows still serve as fallback via
 * `getRatesForDate` / `getLatestCachedRates`.
 *
 * Returns `true` when today's full rates are available afterwards (either
 * already cached or freshly fetched), `false` when the fetch failed and no
 * full cache exists for today. Callers can surface a "rates unavailable"
 * state on `false` without throwing.
 */
export async function ensureTodayRates(): Promise<boolean> {
  const today = format(new Date(), 'yyyy-MM-dd');
  const db = await getDb();

  const existing = await db.select<{ rates_json: string }[]>(
    'SELECT rates_json FROM exchange_rates WHERE rate_date = ?',
    [today],
  );

  if (existing.length > 0) {
    try {
      const cached = JSON.parse(existing[0].rates_json) as Record<string, unknown>;
      if (Object.keys(cached).length >= FULL_CACHE_MIN_KEYS) {
        // Already have a full cache for today - nothing to do.
        return true;
      }
      console.info(
        `[fx] Stale filtered cache detected for ${today} (${Object.keys(cached).length} keys) - re-fetching full rates.`,
      );
    } catch {
      // Malformed JSON - fall through to re-fetch.
    }
  }

  try {
    const { rates } = await fetchLatestRates();
    await cacheFullRates(today, rates);
    console.info(
      `[fx] Cached ${Object.keys(rates).length + 1} exchange rates for ${today} (USD pivot).`,
    );
    return true;
  } catch (err) {
    console.warn('[fx] Failed to fetch exchange rates:', err);
    return false;
  }
}

/**
 * Fetches rates for a specific transaction date.
 *
 * Resolution order:
 *   1. Per-load in-memory memo (if provided) - zero DB/network cost for
 *      repeated lookups of the same date within a single load call.
 *   2. Exact-date SQLite cache - historical rates never change, so this is
 *      the normal path after the first time a date is seen.
 *   3. Network API - only when the date is genuinely missing from the cache.
 *      The result is written back to SQLite so future loads are free.
 *   4. Nearest-earlier cached row - graceful fallback if the network is down.
 *   5. Any cached row (most recent overall).
 *   6. null - no rates at all.
 *
 * Pass a per-load `memo` map when calling inside a batch (e.g. from
 * budget-service) to avoid repeated lookups for the same transaction date.
 *
 * Returns null only if no rates are available at all.
 */
export async function getRatesForDate(
  dateStr: string,
  memo?: Map<string, Record<string, string> | null>,
): Promise<Record<string, string> | null> {
  // Step 1: per-load memo hit
  if (memo?.has(dateStr)) return memo.get(dateStr) ?? null;

  const db = await getDb();

  // Step 2: exact date match in SQLite cache
  const exact = await db.select<{ rates_json: string }[]>(
    'SELECT rates_json FROM exchange_rates WHERE rate_date = ?',
    [dateStr],
  );
  if (exact.length > 0) {
    const result = parseRatesJson(exact[0].rates_json);
    memo?.set(dateStr, result);
    return result;
  }

  // Step 3: date not cached - try the network
  const today = format(new Date(), 'yyyy-MM-dd');
  const fetchDate = dateStr >= today ? 'latest' : dateStr;
  try {
    const { rates } = await fetchRates(fetchDate);
    const result = await cacheFullRates(dateStr, rates);
    memo?.set(dateStr, result);
    return result;
  } catch {
    // Network unavailable - fall through to cached fallbacks
  }

  // Step 4: most recent cached row before the requested date.
  // Do NOT memo under `dateStr` - the result is from a different date
  // and storing it under the requested key would mask the fallback path
  // for the rest of the batch. Callers receive the rate but the next
  // call for the same date can still attempt a fresh resolution.
  const before = await db.select<{ rates_json: string }[]>(
    'SELECT rates_json FROM exchange_rates WHERE rate_date < ? ORDER BY rate_date DESC LIMIT 1',
    [dateStr],
  );
  if (before.length > 0) {
    return parseRatesJson(before[0].rates_json);
  }

  // Step 5: any cached row (most recent overall - e.g. today's from launch).
  // Same memo caveat as Step 4 - the result isn't for `dateStr`.
  const any = await db.select<{ rates_json: string }[]>(
    'SELECT rates_json FROM exchange_rates ORDER BY rate_date DESC LIMIT 1',
  );
  if (any.length > 0) {
    return parseRatesJson(any[0].rates_json);
  }

  // Step 6: no rates at all
  memo?.set(dateStr, null);
  return null;
}

/**
 * Returns the most recent cached rates for display-time conversion.
 * Used by the dashboard/UI layer to convert balances to preferred currency.
 * Never calls the API - reads only from the DB cache.
 * Returns null only if no rates exist at all.
 */
export async function getLatestCachedRates(
  exec?: DbExecutor,
): Promise<Record<string, string> | null> {
  // Accepts an optional executor so it can run on a transaction's connection
  // (e.g. from recomputeSplitNet inside withTransaction) without re-entering
  // the serialize queue and deadlocking.
  const db = exec ?? await getDb();
  const rows = await db.select<{ rates_json: string }[]>(
    'SELECT rates_json FROM exchange_rates ORDER BY rate_date DESC LIMIT 1',
  );
  if (rows.length === 0) return null;
  return parseRatesJson(rows[0].rates_json);
}
