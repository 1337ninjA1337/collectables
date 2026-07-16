import AsyncStorage from "@react-native-async-storage/async-storage";

import { CURRENCY_KEY, PINNED_CURRENCIES_KEY } from "@/lib/storage-keys";

/**
 * Locale-derived helpers shared across UI forms (currency pickers, future
 * sell/trade flows, etc.). The pure helpers below (parsers, maps, default
 * lookups) carry no React Native dependency and can be exercised by node
 * tests directly. The persistence helpers at the bottom of the file pair
 * with the `CURRENCY_KEY` AsyncStorage slot and live here because the
 * locale/currency domain is the natural home for the read/write pair.
 */

/**
 * Canonical compile-time defaults. Frozen so consumers (and tests) can rely
 * on them being immutable — the runtime `LANGUAGE_CURRENCY` is a *merge* of
 * these defaults with any env override, so an override only flips per-language
 * defaults; unmentioned languages still resolve to their canonical currency.
 */
export const DEFAULT_LANGUAGE_CURRENCY: Readonly<Record<string, string>> = Object.freeze({
  ru: "RUB",
  be: "BYN",
  de: "EUR",
  pl: "PLN",
  es: "EUR",
  en: "USD",
});

/**
 * Parse the `EXPO_PUBLIC_LANGUAGE_CURRENCY` override format
 * `lang:CODE,lang:CODE` (e.g. `"ru:RUB,en:EUR"`) into a partial record. Lets
 * QA flip per-region defaults for localized launches without a code change.
 *
 * Validation is lenient by design — invalid tokens (missing colon, empty key,
 * non-ISO-4217 currency shape) are silently dropped so a typo in the env var
 * never crashes the app or blocks the rest of the override from applying.
 * Language codes are lower-cased + trimmed; currency codes are upper-cased
 * (so `ru:eur` becomes `EUR`). On duplicate language keys, the last one wins.
 *
 * Callers must pass the raw value via a *literal* `process.env.EXPO_PUBLIC_X`
 * member access (not the var name) — Metro/babel only inlines literal
 * accesses, so a computed env index lookup would read undefined in the
 * production web bundle (same foot-gun guarded for `resolveNumericEnv`).
 */
export function parseLanguageCurrencyOverride(
  rawValue: string | undefined,
): Record<string, string> {
  if (!rawValue) return {};
  const out: Record<string, string> = {};
  for (const raw of rawValue.split(",")) {
    const token = raw.trim();
    if (!token) continue;
    const colon = token.indexOf(":");
    if (colon <= 0 || colon === token.length - 1) continue;
    const language = token.slice(0, colon).trim().toLowerCase();
    const currency = token.slice(colon + 1).trim().toUpperCase();
    if (!language) continue;
    if (!/^[A-Z]{3}$/.test(currency)) continue;
    out[language] = currency;
  }
  return out;
}

const LANGUAGE_CURRENCY: Record<string, string> = {
  ...DEFAULT_LANGUAGE_CURRENCY,
  ...parseLanguageCurrencyOverride(process.env.EXPO_PUBLIC_LANGUAGE_CURRENCY),
};

/**
 * Map an i18n language code to a sensible default currency. Falls back to
 * USD for any code we don't recognise so the picker always has a value.
 */
export function getDefaultCurrencyForLanguage(language: string): string {
  return LANGUAGE_CURRENCY[language] ?? "USD";
}

/** Read-only view of the language→currency map for tests / future UI. */
export const languageCurrencyMap: Readonly<Record<string, string>> = LANGUAGE_CURRENCY;

/**
 * The whitelist of currency codes the app surfaces in picker *chips*. Lives
 * here (not in `components/currency-input.tsx`) so other forms — sell/trade
 * flows, a future settings screen, an analytics report — can render their
 * own picker without re-declaring the same array. Distinct from the full
 * ISO 4217 dictionary in `lib/currencies.ts` (used by the autocomplete
 * search box): chips are a curated shortlist; the dictionary is exhaustive.
 * `as const` lifts the literal union (`"USD" | "EUR" | …`) into the type
 * system so a typo on a consumer side fails to compile rather than silently
 * rendering a missing currency.
 */
export const CURRENCY_CHIPS = [
  "USD",
  "EUR",
  "GBP",
  "RUB",
  "BYN",
  "PLN",
  "UAH",
  "CHF",
  "JPY",
  "CNY",
] as const;

export type CurrencyChipCode = (typeof CURRENCY_CHIPS)[number];

/**
 * Symbols never change for a given code, and `Intl.NumberFormat` construction
 * is the expensive part — cache per code so per-keystroke re-renders of the
 * amount input don't rebuild formatters.
 */
const CURRENCY_SYMBOL_CACHE = new Map<string, string>();

/**
 * Derive the display symbol for an ISO 4217 code: `USD` → `$`, `EUR` → `€`,
 * `RUB` → `₽`. Prefers the narrow symbol (`narrowSymbol` gives `₽`/`zł`/`₴`
 * where the default `symbol` display keeps the all-caps code outside the
 * home locale), degrading to the plain symbol display and finally to the
 * code itself — for currencies without a Unicode symbol (CHF), unknown
 * codes, or Intl builds without `formatToParts`/`narrowSymbol` (older
 * Hermes), the caller renders exactly what the UI showed before this helper.
 */
export function getCurrencySymbol(code: string): string {
  const normalized = parseStoredCurrency(code);
  if (!normalized) return code;
  const cached = CURRENCY_SYMBOL_CACHE.get(normalized);
  if (cached !== undefined) return cached;
  let symbol = normalized;
  for (const display of ["narrowSymbol", "symbol"] as const) {
    try {
      const formatter = new Intl.NumberFormat("en", {
        style: "currency",
        currency: normalized,
        currencyDisplay: display,
      });
      if (typeof formatter.formatToParts !== "function") break;
      const part = formatter.formatToParts(0).find((p) => p.type === "currency");
      if (part?.value) {
        symbol = part.value;
        break;
      }
    } catch {
      // RangeError: unknown currency code or unsupported currencyDisplay —
      // try the next display form (or fall through to the code).
    }
  }
  CURRENCY_SYMBOL_CACHE.set(normalized, symbol);
  return symbol;
}

/**
 * BCP-47 locale tags keyed by `AppLanguage` (mirrors `LANGUAGE_CURRENCY`'s
 * key set). Tags carry the region so `Intl.NumberFormat` / `DateTimeFormat`
 * picks the right currency display, thousands separators, and date order
 * (e.g. ru-RU shows `1 234,56 ₽`; ru alone falls back to Intl's default
 * which can drop the region-specific formatting).
 */
const LANGUAGE_LOCALE: Record<string, string> = {
  ru: "ru-RU",
  be: "be-BY",
  de: "de-DE",
  pl: "pl-PL",
  es: "es-ES",
  en: "en-US",
};

/**
 * Map an i18n language code to a BCP-47 locale tag. Falls back to the
 * input string for unrecognised codes — `Intl.*` constructors accept
 * raw language tags and degrade gracefully, so the picker / formatter
 * still works even when a new language hasn't been mapped yet.
 */
export function getDefaultLocaleForLanguage(language: string): string {
  return LANGUAGE_LOCALE[language] ?? language;
}

/** Read-only view of the language→BCP-47 map for tests / future UI. */
export const languageLocaleMap: Readonly<Record<string, string>> = LANGUAGE_LOCALE;

/**
 * Validate a persisted currency string. Accepts only ISO 4217 alphabetic
 * shape (three uppercase letters); returns null on any malformed/empty
 * input so a corrupted AsyncStorage payload falls back to the language
 * default instead of rendering a junk symbol. Pure so node tests can hit
 * it without standing up AsyncStorage.
 */
export function parseStoredCurrency(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Read the user's last-picked currency from AsyncStorage. Returns null
 * when nothing is stored, when storage throws, or when the stored value
 * fails ISO 4217 validation — the caller should then fall back to the
 * language default via `getDefaultCurrencyForLanguage`.
 */
export async function getUserPreferredCurrency(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(CURRENCY_KEY);
    return parseStoredCurrency(raw);
  } catch {
    return null;
  }
}

/**
 * Persist the user's currency choice so a power user who picked JPY once
 * doesn't have to re-pick on the next listing form. Silently no-ops on
 * malformed input (avoids polluting storage with junk) and on storage
 * failure (best-effort; matches how `marketplace-context` writes through).
 */
export async function setUserPreferredCurrency(currency: string): Promise<void> {
  const validated = parseStoredCurrency(currency);
  if (!validated) return;
  try {
    await AsyncStorage.setItem(CURRENCY_KEY, validated);
  } catch {
    // Best-effort: persistence failure must not crash the form submit.
  }
}

/**
 * How many recently-used currencies the chip strip surfaces ahead of the
 * static `CURRENCY_CHIPS` shortlist. Four keeps the strip's above-the-fold
 * width on an iPhone SE while covering the multi-currency power user.
 */
export const MAX_PINNED_CURRENCIES = 4;

/**
 * Validate a persisted pinned-currency payload (a JSON string array).
 * Junk entries are dropped per-element (not whole-payload) so one corrupted
 * slot doesn't wipe the rest; duplicates collapse to their first (most
 * recent) position and the list is capped at `MAX_PINNED_CURRENCIES`.
 * Pure so node tests can hit it without standing up AsyncStorage.
 */
export function parsePinnedCurrencies(raw: string | null | undefined): string[] {
  if (typeof raw !== "string" || !raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: string[] = [];
  for (const entry of parsed) {
    const code = parseStoredCurrency(typeof entry === "string" ? entry : null);
    if (code && !out.includes(code)) out.push(code);
    if (out.length === MAX_PINNED_CURRENCIES) break;
  }
  return out;
}

/**
 * MRU insert: move `code` to the front of `current`, dropping its previous
 * position and anything past the cap. Invalid codes return an unchanged
 * copy. Pure — the storage read/write pair below rides it.
 */
export function mergePinnedCurrencies(current: readonly string[], code: string): string[] {
  const validated = parseStoredCurrency(code);
  if (!validated) return [...current];
  return [validated, ...current.filter((c) => c !== validated)].slice(0, MAX_PINNED_CURRENCIES);
}

/**
 * Read the user's recently-used currencies (most recent first). Returns []
 * when nothing is stored, when storage throws, or when the payload fails
 * validation — the chip strip then falls back to the static shortlist.
 */
export async function getPinnedCurrencies(): Promise<string[]> {
  try {
    return parsePinnedCurrencies(await AsyncStorage.getItem(PINNED_CURRENCIES_KEY));
  } catch {
    return [];
  }
}

/**
 * Record a currency pick into the MRU list so the next form open surfaces
 * it ahead of the static chips. Best-effort like `setUserPreferredCurrency`:
 * malformed input and storage failures silently no-op.
 */
export async function pinCurrency(currency: string): Promise<void> {
  const validated = parseStoredCurrency(currency);
  if (!validated) return;
  try {
    const current = parsePinnedCurrencies(await AsyncStorage.getItem(PINNED_CURRENCIES_KEY));
    await AsyncStorage.setItem(
      PINNED_CURRENCIES_KEY,
      JSON.stringify(mergePinnedCurrencies(current, validated)),
    );
  } catch {
    // Best-effort: persistence failure must not crash the picker.
  }
}
