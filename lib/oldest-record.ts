/**
 * Which entry of a provenance table has gone longest without somebody looking at
 * it — the one question three guards ask of three differently-shaped tables.
 *
 * Every provenance table in this repository records a date per entry and exists
 * to answer "did this value move without saying why". That is a FAILURE
 * question, and it leaves a green run unable to distinguish a page confirmed
 * this morning from one confirmed a year ago against a section that has not
 * moved since — the second is fine in the sense that there is nothing to fix,
 * and hides a disclosure that is old because nobody is looking.
 *
 * Saying so is one walk, and the tables disagree only about what the date field
 * is called (`checkedOn`, `recordedOn`) and which order their keys read in. Both
 * are arguments, so the walk lives here once rather than being written a second
 * and a third time with two chances to pick a different tie-break.
 *
 * A LEAF: no imports, so any evaluator may use it and it can never be the module
 * that closed a cycle.
 */

/** The least recently recorded entries of a table, and when. */
export type OldestRecord = {
  /** The earliest date any entry carries, as `YYYY-MM-DD`. */
  readonly recordedOn: string;
  /** Every key sharing that date, in `order`'s order. */
  readonly keys: readonly string[];
};

/**
 * The oldest date in `table`, and every key carrying it.
 *
 * Ordered by string comparison, which is correct for `YYYY-MM-DD` and is only
 * ever asked of a table whose dates already passed their shape check — the lines
 * this feeds are printed on a PASS, and a malformed date is a failure that
 * reaches the reader instead.
 *
 * EVERY key sharing the oldest date is named rather than one picked from them: a
 * table recorded in one sitting has all of its entries on the same day, and a
 * line naming one of six would read as a fact about that entry.
 *
 * `order` is walked rather than the table's own keys, so what a reader sees does
 * not depend on how the object literal happens to be written — and a key the
 * caller's order does not know is left out, which is safe here because every
 * caller validates its keys against that same list one step earlier and a table
 * with an unknown key never reaches a pass line.
 *
 * Null only when the table is empty, which every caller already treats as a
 * failure of its own ("a pass over zero baselines is not a pass"), so no pass
 * line has to render the absence.
 */
export function oldestRecord<T>(
  table: Readonly<Record<string, T>>,
  dateOf: (entry: T) => string,
  order: readonly string[],
): OldestRecord | null {
  const dates = Object.values(table).map(dateOf);
  if (dates.length === 0) return null;
  const recordedOn = dates.reduce((a, b) => (a <= b ? a : b));
  const keys = order.filter((key) => {
    const entry = table[key];
    return entry !== undefined && dateOf(entry) === recordedOn;
  });
  return { recordedOn, keys };
}
