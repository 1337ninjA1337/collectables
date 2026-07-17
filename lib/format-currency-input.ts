/**
 * Input-side currency string transforms. Output-side formatting lives in
 * `lib/format-cost.ts`; this module owns what happens to a raw keystroke
 * stream BEFORE it becomes a number. Pure (no React Native imports) so node
 * tests can exercise the truth table directly — any form field accepting
 * amounts (cost/price inputs today; refund inputs, price-suggestion sheets,
 * marketplace listing forms tomorrow) should sanitize through here.
 */

/**
 * Normalise a typed amount: comma decimal separator becomes a dot, everything
 * except digits and one dot is stripped, and only the FIRST dot survives
 * (so "1.2.3" collapses to "1.23" instead of parsing as NaN downstream).
 */
export function sanitizeCurrencyInput(raw: string): string {
  const normalised = raw.replace(",", ".");
  const stripped = normalised.replace(/[^0-9.]/g, "");
  const parts = stripped.split(".");
  if (parts.length <= 2) return stripped;
  return parts[0] + "." + parts.slice(1).join("");
}

/**
 * Parse the sanitized string to a positive number, or return null if invalid.
 */
export function parseCurrencyValue(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Why a value failed to parse. Deliberately the same vocabulary as
 * `InvalidPriceReason` (lib/analytics-helpers.ts) so the inline error a user
 * sees and the `listing_price_invalid.reason` the funnel records can never
 * disagree about what went wrong.
 */
export type CurrencyValueError = "empty" | "unparseable" | "non_positive";

export type ParsedCurrencyValue =
  | { value: number; error: null }
  | { value: null; error: CurrencyValueError };

/**
 * `parseCurrencyValue` with the failure reason attached, for callers that
 * surface inline errors instead of silently dropping the input. Gate order
 * mirrors `parseCurrencyValue` (empty → non-finite → <= 0) so the two can
 * never accept different values.
 */
export function parseCurrencyValueDetailed(value: string): ParsedCurrencyValue {
  if (!value.trim()) return { value: null, error: "empty" };
  const n = Number(value);
  if (!Number.isFinite(n)) return { value: null, error: "unparseable" };
  if (n <= 0) return { value: null, error: "non_positive" };
  return { value: n, error: null };
}

/**
 * i18n key per failure reason, so every form maps the shared error vocabulary
 * to the same three strings. Translation itself stays at the caller (`t()`).
 */
export const CURRENCY_ERROR_I18N_KEY = {
  empty: "currencyErrorEmpty",
  unparseable: "currencyErrorUnparseable",
  non_positive: "currencyErrorNonPositive",
} as const satisfies Record<CurrencyValueError, string>;
