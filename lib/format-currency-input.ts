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
