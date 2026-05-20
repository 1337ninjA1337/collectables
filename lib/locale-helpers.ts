/**
 * Locale-derived helpers shared across UI forms (currency pickers, future
 * sell/trade flows, etc.). Keep this module pure (no React Native imports)
 * so it can be unit-tested in isolation.
 */

const LANGUAGE_CURRENCY: Record<string, string> = {
  ru: "RUB",
  be: "BYN",
  de: "EUR",
  pl: "PLN",
  es: "EUR",
  en: "USD",
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
