import { sourceCode, tsxFiles } from "./source-files";

/**
 * Every file that puts a currency choice on screen, split by what it is FOR.
 *
 * Two sweeps needed this derivation and each wrote its own, and both had the
 * same hole: they walked `app/` only, because every currency surface anybody
 * had thought about was a route. `components/edit-collection-modal.tsx` is not
 * — it renders the collection-currency button and asks its parent to open the
 * sheet — so the one currency control in `components/` was excluded from both
 * rules by the WALK rather than by either rule. It happens to belong on the
 * excluded side, which is exactly why it went unnoticed: a gap that is
 * currently harmless is still a gap, and it is the one these sweeps exist to
 * close.
 *
 * THREE SIGNALS, because a currency control has three shapes here.
 *
 * `<CurrencyInput>` is the cost-input component. `<CurrencySheet>` is the full
 * picker, mounted directly by the display screens and by the component. And
 * `onOpenCurrencySheet` is the third: a control that OPENS a sheet its parent
 * owns, which is how the collection-edit modal works and is invisible to the
 * other two signals. A sweep written to the shapes it already knew about is
 * the same blind spot `LISTING_RULE_BY_ITEM_PATH` documents one directory
 * over, one domain across.
 *
 * WHAT SEPARATES THE TWO KINDS is whether the user types an AMOUNT.
 *
 * A cost input says "this number is in this unit", so it remembers what you
 * picked ({@link costInputFiles}). A display picker says "show figures in this
 * unit", takes no amount, and has nothing to remember — asking one to write
 * the entry currency would make choosing a display currency change what the
 * next cost form opens with, which is the collision the storage-key split
 * removed, re-introduced from the other end.
 *
 * `parseCurrencyValueDetailed` is the shared parser for a typed amount and so
 * is the mechanical form of that question.
 */

/** `<CurrencyInput>`, `<CurrencySheet>` or a control that opens one. */
export function offersCurrencyChoice(code: string): boolean {
  return (
    code.includes("<CurrencyInput") ||
    code.includes("<CurrencySheet") ||
    code.includes("onOpenCurrencySheet")
  );
}

/**
 * The files that IMPLEMENT the controls, rather than using one.
 *
 * Exempt from both rules and named rather than pattern-matched, because
 * "anything under components/ with `currency` in the name" would also exempt
 * the next screen-level component somebody puts there.
 */
export const CURRENCY_IMPLEMENTATION_FILES: readonly string[] = [
  // Mounts <CurrencySheet> because it CONTAINS the picker. Asking it to read
  // or write a preference would put the storage layer inside a presentational
  // component, and all three of its callers already do.
  "components/currency-input.tsx",
  // The picker itself.
  "components/currency-sheet.tsx",
];

/** Both roots, so a control in `components/` cannot sit outside the rules. */
function currencyFiles(): readonly string[] {
  return [...tsxFiles("app"), ...tsxFiles("components")].filter(
    (file) =>
      !CURRENCY_IMPLEMENTATION_FILES.includes(file) && offersCurrencyChoice(sourceCode(file)),
  );
}

/**
 * A screen where the user types an amount AND names its unit.
 *
 * These must open with the entry currency and write it back on a pick — see
 * `currency-input-consistency.test.ts` — and must reach the shared
 * `<CurrencyInput>` rather than driving a sheet by hand, see
 * `create-currency-input-adoption.test.ts`.
 */
export function costInputFiles(): readonly string[] {
  return currencyFiles().filter((file) => sourceCode(file).includes("parseCurrencyValueDetailed("));
}

/**
 * A surface that picks the currency figures are DISPLAYED in, and takes no
 * amount.
 *
 * The complement of {@link costInputFiles} over the same walk, so a file
 * cannot fall out of both: adding a typed amount to a display picker moves it
 * into the other list and turns a case red rather than leaving it silently
 * unruled.
 */
export function displayPickerFiles(): readonly string[] {
  return currencyFiles().filter(
    (file) => !sourceCode(file).includes("parseCurrencyValueDetailed("),
  );
}
