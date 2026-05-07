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
