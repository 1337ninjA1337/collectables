/**
 * How this app says that one act did more than one thing.
 *
 * Three toasts report an outcome that is really two: a bulk archive that also
 * withdrew four standing offers, a bulk delete that did the same, and the
 * single-item archive of a listed item. Each is "what happened to your rows"
 * followed by "what happened to something other people can see", and until
 * this module each was joined by hand.
 *
 * WHAT WAS WRONG. The separator lived inside the translated value —
 * `bulkListingsRemoved` began with a literal `· ` in all six locales — and the
 * space in front of it lived at the call site, as a leading space inside the
 * string the screen conditionally returned:
 *
 *   const outcome = n > 0 ? ` ${t("bulkListingsRemoved", { count: n })}` : "";
 *   toast.success(`${t("itemsArchived", { count })}${outcome}`);
 *
 * That is one punctuation mark split across two files and six translations,
 * and it fails in both directions. A translator who drops the glyph (it is not
 * a word, and nothing in the value says it is load-bearing) gets two sentences
 * run together. A caller who forgets the leading space gets them joined by the
 * glyph alone. Neither is visible to a coverage count, because the key is
 * DECLARED either way — the same boundary `lib/plural.ts` documents.
 *
 * WHAT THIS DOES INSTEAD. The clauses are sentences and the punctuation
 * between them is layout, so the punctuation is code: the six values say what
 * happened and this module says how two of them are set beside each other.
 *
 * WHY IT TAKES STRINGS AND NOT KEYS. Every clause is already counted, agreed
 * and declined by the time it gets here — `bulkListingsRemoved` runs through
 * `slavicPlural` in three locales — and a composer that took keys would have
 * to take their params too and would be a second place that knows about
 * translation. It knows about punctuation. That is also what lets a caller
 * pass a clause it built some other way.
 *
 * EMPTY CLAUSES ARE DROPPED, which is the property the hand-written join did
 * not have. `composeOutcome(a)` and `composeOutcome(a, null)` are both `a`,
 * with no trailing separator and no trailing space — so a screen can pass the
 * conditional clause straight through instead of encoding "nothing happened"
 * as a string that starts with a space.
 */

/**
 * A middle dot with a space on each side.
 *
 * Not a comma: the two clauses are independent statements rather than items in
 * a list, and in three of the six locales a comma inside a counted phrase
 * reads as part of the number's own punctuation.
 */
export const OUTCOME_SEPARATOR = " · ";

/**
 * Joins a leading clause with any further clauses that actually happened.
 *
 * Returns the leading clause unchanged when nothing else did.
 */
export function composeOutcome(
  message: string,
  ...clauses: readonly (string | null | undefined)[]
): string {
  const said = clauses.filter((clause): clause is string => Boolean(clause && clause.trim()));
  return said.length === 0 ? message : [message, ...said].join(OUTCOME_SEPARATOR);
}
