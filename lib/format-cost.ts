/**
 * Format a numeric cost for display. Rounds to 2 decimals, drops trailing
 * zeros, uses a thousands separator for readability. Pure (no React, no
 * Intl locale) so it can run in node tests.
 */
export function formatCostAmount(amount: number): string {
  if (!Number.isFinite(amount)) return "0";
  const rounded = Math.round(amount * 100) / 100;
  const [whole, fractional] = rounded.toFixed(2).split(".");
  const wholeWithSep = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (fractional === "00") return wholeWithSep;
  return `${wholeWithSep}.${fractional.replace(/0+$/, "")}`;
}
