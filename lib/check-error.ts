/**
 * How a guard says a run failed: `<check-name>: ERROR — <what happened>`.
 *
 * Nothing else. Nineteen sites in eleven modules spelled this line out, and it
 * is the format every one of this repository's build-time guards prints its
 * refusals in — the string a developer greps for when CI goes red, and the one
 * a reader recognises before they have read the sentence after it.
 *
 * WHY IT IS WORTH A MODULE. Not the eight characters. The convention is
 * load-bearing in two directions and neither is visible from any single copy:
 * the CHECK NAME comes first so a log holding four guards' output can be read
 * by guard, and the em dash separates a machine-readable prefix from prose so
 * the two halves can be told apart without parsing. Nineteen copies is nineteen
 * chances to write `ERROR: `, or `error —`, or to drop the name; and the failure
 * when that happens is not a broken build, it is a line that scrolls past
 * looking almost right. A convention nobody can restate is a convention that
 * has already started to drift.
 *
 * A LEAF, deliberately: no imports at all. Guard modules are read by node build
 * scripts, and this is the one module every one of them would want.
 *
 * Not a logger and not a thrower — it returns the line. Guards here decide
 * separately whether a refusal is printed, collected into a report, thrown
 * ({@link GuardRootError} in `lib/guard-root.ts` builds its message through
 * here), or returned to a caller that will choose; a helper that printed would
 * have to be worked around by most of them.
 */

/** The separator, once. Named because the tests that assert the shape need it. */
export const CHECK_ERROR_PREFIX = ": ERROR — ";

/**
 * One refusal line.
 *
 * `message` is the prose half and should read as a sentence — the caller's
 * whole finding, not a code. Callers with a table of phrasings pass the looked
 * -up phrase; callers with one thing to say pass it inline.
 */
export function checkError(checkName: string, message: string): string {
  return `${checkName}${CHECK_ERROR_PREFIX}${message}`;
}
