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
  /**
   * The earliest date any entry `order` KNOWS carries, as `YYYY-MM-DD`.
   *
   * Known-only, and the qualifier is the fix rather than a detail: the date
   * used to be the minimum over every entry in the table while {@link keys}
   * was filtered by `order`, so a table whose oldest entry sat under a key the
   * order did not know rendered a date with no keys beside it — an age
   * attributed to nothing.
   */
  readonly recordedOn: string;
  /** Every key sharing that date, in `order`'s order. */
  readonly keys: readonly string[];
  /**
   * Table keys `order` does not know, in the table's own order.
   *
   * Empty on every call this repository makes, because both callers run a
   * shape half that fails an unknown key before any pass line is built — and
   * that is a property of the CALLERS, which is exactly why it is reported
   * here instead of assumed. A caller without that check gets a list it can
   * refuse on rather than an age quietly measured over a subset.
   */
  readonly unknownKeys: readonly string[];
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
 * not depend on how the object literal happens to be written. A key the order
 * does not know is left out of BOTH halves and reported as
 * {@link OldestRecord.unknownKeys}: leaving it out of the keys while letting it
 * set the date is how this printed an age with nothing beside it, and letting
 * it set the date while nobody can see it is how a page recorded in 2019 under
 * a typo would have gone on being the answer.
 *
 * Null when `order` knows no entry of this table — the empty table, and the
 * table whose every key is unknown. Both are already failures for every caller
 * ("a pass over zero baselines is not a pass"; an unknown key fails the shape
 * half), so no pass line has to render the absence.
 */
export function oldestRecord<T>(
  table: Readonly<Record<string, T>>,
  dateOf: (entry: T) => string,
  order: readonly string[],
): OldestRecord | null {
  const unknownKeys = Object.keys(table).filter((key) => !order.includes(key));
  const known = order.filter((key) => table[key] !== undefined);
  if (known.length === 0) return null;
  const recordedOn = known
    .map((key) => dateOf(table[key]))
    .reduce((a, b) => (a <= b ? a : b));
  const keys = known.filter((key) => dateOf(table[key]) === recordedOn);
  return { recordedOn, keys, unknownKeys };
}

/**
 * The sentence a pass line prints INSTEAD of an age, when the walk could not
 * speak for every entry of the table it measured.
 *
 * {@link OldestRecord.unknownKeys} was carried out of the walk and read by
 * nothing: a field reported so that a caller which lost its shape half would
 * have something to refuse on, with no caller actually refusing. That is the
 * shape three sweeps in this tree call "a way to pass dishonestly" — the
 * safety was asserted in two suites and enforced nowhere.
 *
 * It is enforced here. A pass line is the only line anybody reads on a green
 * run, and one saying `Oldest record 2026-01-01 (en, ru)` over a table that
 * also holds a key nobody walked is a fact about a subset printed as a fact
 * about the table. So the age does not render at all: the caller prints this
 * instead and fails.
 *
 * Nothing in this repository reaches it, and that is the claim rather than a
 * caveat — every caller runs a shape half that fails an unknown key first. The
 * difference from the prose it replaces is that this is reachable from outside:
 * the formatters take a plain result, so a case builds one and proofreads the
 * words.
 *
 * The BODY only, without a check-name prefix: this module is a leaf with no
 * imports so that any evaluator may use it, and `checkError` belongs to the
 * callers.
 *
 * Returns null when every key was walked, which is the usual answer.
 */
export function unknownKeysRefusal(
  tableName: string,
  orderName: string,
  unknownKeys: readonly string[],
): string | null {
  if (unknownKeys.length === 0) return null;
  const quoted = unknownKeys.map((key) => JSON.stringify(key)).join(", ");
  // The one-versus-many rule written out, where every other module in the tree
  // takes it from `lib/plural.ts`. This module is a LEAF on purpose — the doc
  // comment above says so and `oldest-record.test.ts` asserts it — and an
  // import for two words is not worth being the module that closes a cycle.
  // `plural.test.ts` sanctions this site by name for that reason.
  const entries =
    unknownKeys.length === 1 ? "1 entry" : `${unknownKeys.length} entries`;
  return `${tableName} carries ${entries} that ${orderName} does not know (${quoted}), so the age this run would have printed was measured over the rest of the table and reads as a fact about all of it. Nothing should reach this line: the shape half fails an unknown key before any pass line is built, so seeing it means that half did not run or no longer checks the keys.`;
}
