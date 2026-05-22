/**
 * Currency rates fetching, caching, and conversion.
 *
 * Free data source: https://open.er-api.com/v6/latest/USD — no API key,
 * ~160 currencies, refreshed daily. The response shape is:
 *   {
 *     "result": "success",
 *     "base_code": "USD",
 *     "time_last_update_unix": 1700000000,
 *     "rates": { "USD": 1, "EUR": 0.92, "RUB": 90.5, ... }
 *   }
 *
 * The pure helpers (parse / convert / isStale) carry no React Native or
 * fetch dependency so node tests can exercise them in isolation. The async
 * wrappers at the bottom of the file pair with the `CURRENCY_RATES_KEY`
 * AsyncStorage slot and survive offline-first usage: a fetch failure falls
 * back to whatever was cached previously instead of crashing the caller.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { CURRENCY_RATES_KEY } from "@/lib/storage-keys";

export type UsdRates = Readonly<Record<string, number>>;

export type CurrencyRatesPayload = {
  /** Rates relative to USD (so USD === 1). */
  rates: UsdRates;
  /** Unix ms when the rates were fetched / written to cache. */
  fetchedAt: number;
};

/** Default cache lifetime: 24h. ECB / aggregator feeds refresh once a day. */
export const RATES_TTL_MS = 24 * 60 * 60 * 1000;

export const RATES_ENDPOINT_URL = "https://open.er-api.com/v6/latest/USD";

/**
 * Parse the open.er-api response body into a strictly-typed payload.
 * Returns `null` when the response is missing the `rates` object, the
 * `result` field is not `"success"`, or any rate value isn't a finite
 * positive number — defensive against API outages and malformed payloads.
 *
 * Always includes `USD: 1` even if the upstream omits the self-rate
 * (every aggregator has at one point, and conversion math depends on it).
 */
export function parseRatesResponse(
  raw: unknown,
  now: number = Date.now(),
): CurrencyRatesPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.result !== undefined && obj.result !== "success") return null;
  const rawRates = obj.rates;
  if (!rawRates || typeof rawRates !== "object") return null;

  const parsed: Record<string, number> = { USD: 1 };
  for (const [code, value] of Object.entries(rawRates as Record<string, unknown>)) {
    if (!/^[A-Z]{3}$/.test(code)) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
    parsed[code] = value;
  }
  if (Object.keys(parsed).length <= 1) return null;

  return { rates: Object.freeze(parsed), fetchedAt: now };
}

/**
 * Convert `amount` from `from` currency to `to` currency using USD-base
 * rates. Returns `null` when either currency is missing from the rate
 * table — callers should surface this as "conversion unavailable" rather
 * than silently displaying the raw amount.
 *
 * Math: rates map each currency to "units per 1 USD", so converting
 * X `from` to `to` = X * (rates[to] / rates[from]).
 */
export function convertAmount(
  amount: number,
  from: string,
  to: string,
  rates: UsdRates,
): number | null {
  if (!Number.isFinite(amount)) return null;
  if (from === to) return amount;
  const fromRate = rates[from];
  const toRate = rates[to];
  if (typeof fromRate !== "number" || typeof toRate !== "number") return null;
  if (fromRate <= 0 || toRate <= 0) return null;
  return amount * (toRate / fromRate);
}

/**
 * True when the cached payload is missing or older than `ttlMs`. Used to
 * gate the network refresh so we don't burn quota / battery on every
 * mount when a fresh copy already lives in AsyncStorage.
 */
export function isStale(
  payload: CurrencyRatesPayload | null,
  now: number = Date.now(),
  ttlMs: number = RATES_TTL_MS,
): boolean {
  if (!payload) return true;
  return now - payload.fetchedAt >= ttlMs;
}

/**
 * Sum a list of `{amount, currency}` entries by converting each one into
 * `displayCurrency` first. Entries that fail conversion (missing rate,
 * unknown currency) are skipped — the returned `converted` count lets the
 * UI surface "partial total" hints when some items couldn't be tallied.
 */
export function sumConverted(
  entries: ReadonlyArray<{ amount: number; currency: string }>,
  displayCurrency: string,
  rates: UsdRates,
): { total: number; converted: number; skipped: number } {
  let total = 0;
  let converted = 0;
  let skipped = 0;
  for (const entry of entries) {
    const result = convertAmount(entry.amount, entry.currency, displayCurrency, rates);
    if (result === null) {
      skipped += 1;
      continue;
    }
    total += result;
    converted += 1;
  }
  return { total, converted, skipped };
}

/** Read the cached payload from AsyncStorage. Returns null on any error. */
export async function getCachedRates(): Promise<CurrencyRatesPayload | null> {
  try {
    const raw = await AsyncStorage.getItem(CURRENCY_RATES_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const fetchedAt = (parsed as { fetchedAt?: unknown }).fetchedAt;
    const rates = (parsed as { rates?: unknown }).rates;
    if (typeof fetchedAt !== "number" || !rates || typeof rates !== "object") return null;
    const cleaned: Record<string, number> = {};
    for (const [code, value] of Object.entries(rates as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        cleaned[code] = value;
      }
    }
    if (Object.keys(cleaned).length === 0) return null;
    return { rates: Object.freeze(cleaned), fetchedAt };
  } catch {
    return null;
  }
}

/** Persist a payload to AsyncStorage. Best-effort: failures are swallowed. */
export async function setCachedRates(payload: CurrencyRatesPayload): Promise<void> {
  try {
    await AsyncStorage.setItem(
      CURRENCY_RATES_KEY,
      JSON.stringify({ rates: payload.rates, fetchedAt: payload.fetchedAt }),
    );
  } catch {
    // best-effort
  }
}

/**
 * Fetch fresh rates from open.er-api.com. Returns null on network
 * failure or a malformed response — callers should keep the previous
 * cache rather than crashing.
 */
export async function fetchUsdRates(
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<CurrencyRatesPayload | null> {
  try {
    const response = await fetchImpl(RATES_ENDPOINT_URL);
    if (!response.ok) return null;
    const json = await response.json();
    return parseRatesResponse(json, now);
  } catch {
    return null;
  }
}

/**
 * High-level orchestrator: returns the cached payload immediately, then
 * fetches fresh rates when the cache is stale (and writes them through).
 * Use the `forceRefresh` flag to bypass the freshness check (e.g. for a
 * "refresh now" button in settings).
 */
export async function loadCurrencyRates(options?: {
  forceRefresh?: boolean;
  fetchImpl?: typeof fetch;
  ttlMs?: number;
  now?: number;
}): Promise<CurrencyRatesPayload | null> {
  const force = options?.forceRefresh === true;
  const ttl = options?.ttlMs ?? RATES_TTL_MS;
  const now = options?.now ?? Date.now();
  const fetchImpl = options?.fetchImpl ?? fetch;

  const cached = await getCachedRates();
  if (!force && cached && !isStale(cached, now, ttl)) return cached;

  const fresh = await fetchUsdRates(fetchImpl, now);
  if (fresh) {
    await setCachedRates(fresh);
    return fresh;
  }

  return cached;
}
