/**
 * The recorded size of each shipped policy file, plus the provenance of the
 * number itself.
 *
 * The size half is consumed by `lib/bundle-smoke.ts`'s `body_size_drift` gate:
 * a page outside a ±25% band around its baseline fails the build, which is what
 * turns "this disclosure shrank" from a number in an old CI log into a red
 * build. That gate has one soft spot, and it is not the measurement — a test
 * re-measures every entry from the tracked markdown, so a wrong number fails
 * immediately. It is the number updated for the WRONG REASON: the documented
 * fix for a red drift gate is "update the constant to the measured count", the
 * failure message says exactly that, and a merge that truncated a policy and
 * was resolved that way turns the guard into a rubber stamp in one commit,
 * silently, forever after.
 *
 * Nothing automatic can tell a deliberate amendment from a badly resolved merge
 * — both change the file and both change the count. What CAN be enforced is
 * that the person changing the number writes down why, in the same commit, next
 * to the number: `recordedOn` and `note` are that record.
 * `scripts/check-privacy-baseline-provenance.ts` compares this table against
 * its own previous revision and fails a `words` change whose `note`/`recordedOn`
 * did not move with it, or whose policy file was not touched at all. That does
 * not make a bad resolution impossible; it makes it *visible in the diff*, to a
 * reviewer who can read "1171 → 980, removed the analytics section" and ask
 * whether the analytics section was supposed to go.
 *
 * This table lives in its own module rather than in `lib/bundle-smoke.ts` for
 * the guard's sake: the previous revision is read as TEXT (`git show
 * <base>:lib/privacy-body-baselines.ts`) and parsed by
 * {@link parsePrivacyBodyBaselines}, and a small file whose whole job is this
 * one literal is a far more stable parse target than an 800-line module.
 * `__tests__/privacy-baseline-provenance.test.ts` parses the file on disk and
 * asserts it round-trips to this object, so a reformat that breaks the parser
 * fails the suite instead of quietly disabling the guard.
 */

import { PRIVACY_DEFAULT_LANGUAGE } from "./privacy-page";

export type PrivacyBodyBaseline = {
  /**
   * Words in the rendered body, as measured by `privacyBodyWords` over
   * `extractPrivacyPageBodyText`. Re-measured from the tracked markdown by
   * `__tests__/bundle-smoke.test.ts`, so this is a fact, not a claim.
   */
  readonly words: number;
  /** `YYYY-MM-DD` the CURRENT {@link words} value was recorded. */
  readonly recordedOn: string;
  /**
   * Why {@link words} is what it is. On a change it must name the previous
   * count — `1171 → 980 (dropped the analytics section)` — which is the whole
   * point of the field: the diff that shrinks a disclosure has to say so in
   * words, in the same commit, where a reviewer reads it.
   */
  readonly note: string;
};

export const PRIVACY_BODY_BASELINES: Readonly<
  Record<string, PrivacyBodyBaseline>
> = {
  en: {
    words: 1171,
    recordedOn: "2026-08-11",
    note: "First recorded size of the canonical English policy, measured from the tracked PRIVACY.md.",
  },
  ru: {
    words: 182,
    recordedOn: "2026-08-11",
    note: "First recorded size of the Russian Sentry-disclosure translation, measured from PRIVACY.md.ru.",
  },
  be: {
    words: 185,
    recordedOn: "2026-08-11",
    note: "First recorded size of the Belarusian Sentry-disclosure translation, measured from PRIVACY.md.be.",
  },
  pl: {
    words: 188,
    recordedOn: "2026-08-11",
    note: "First recorded size of the Polish Sentry-disclosure translation, measured from PRIVACY.md.pl.",
  },
  de: {
    words: 169,
    recordedOn: "2026-08-11",
    note: "First recorded size of the German Sentry-disclosure translation, measured from PRIVACY.md.de.",
  },
  es: {
    words: 229,
    recordedOn: "2026-08-11",
    note: "First recorded size of the Spanish Sentry-disclosure translation, measured from PRIVACY.md.es.",
  },
};

/**
 * The size half on its own — the shape `evaluatePrivacyPages` takes.
 *
 * DERIVED rather than declared beside the table: two hand-maintained tables of
 * the same six numbers is the drift this whole file exists to prevent.
 */
export const PRIVACY_BODY_BASELINE_WORDS: Readonly<Record<string, number>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(PRIVACY_BODY_BASELINES).map(([code, baseline]) => [
        code,
        baseline.words,
      ]),
    ),
  );

/**
 * The tracked markdown a language's baseline describes — `PRIVACY.md` for
 * English (the canonical full policy) and `PRIVACY.md.<code>` for the five
 * translated Sentry-disclosure pages.
 *
 * Repo-relative and posix-separated, because it is compared against
 * `git diff --name-only` output.
 */
export function privacyPolicySourcePath(code: string): string {
  return code === PRIVACY_DEFAULT_LANGUAGE ? "PRIVACY.md" : `PRIVACY.md.${code}`;
}

/**
 * The {@link PRIVACY_BODY_BASELINES} literal recovered from a revision of this
 * module's SOURCE TEXT, or null when the declaration is not there at all.
 *
 * A regex over the literal, not an import: the input is
 * `git show <base>:lib/privacy-body-baselines.ts` — a string from a commit that
 * may predate this file, may predate the field set, and must not be executed.
 *
 * Null means "no comparable table at that revision" and the caller SKIPS the
 * drift half rather than reporting six changes. That is the correct reading of
 * the only two ways it happens: the revision predates this module (the commit
 * that introduced it would otherwise fail its own guard), or the format changed
 * enough to defeat the parser — which the round-trip test catches on the commit
 * that does it, not three commits later.
 */
export function parsePrivacyBodyBaselines(
  source: string,
): Record<string, PrivacyBodyBaseline> | null {
  // Anchored on the DECLARATION, not on the name: the name also appears in
  // this file's prose, and a comment mentioning it above the declaration would
  // otherwise start the scan inside a doc block.
  const start = source.indexOf("export const PRIVACY_BODY_BASELINES");
  if (start === -1) return null;
  const open = source.indexOf("{", start);
  if (open === -1) return null;
  // The literal is closed by a `};` at column 0 — every nested brace in it is
  // indented, so this needs no brace counting and cannot run past the end of
  // the declaration.
  const close = source.indexOf("\n};", open);
  if (close === -1) return null;
  const body = source.slice(open, close);

  const entry =
    /([a-z]{2,8})\s*:\s*\{\s*words\s*:\s*(\d+)\s*,\s*recordedOn\s*:\s*"([^"]*)"\s*,\s*note\s*:\s*"((?:[^"\\]|\\.)*)"\s*,?\s*\}/g;
  const parsed: Record<string, PrivacyBodyBaseline> = {};
  for (const match of body.matchAll(entry)) {
    parsed[match[1]] = {
      words: Number(match[2]),
      recordedOn: match[3],
      // Only `\"` and `\\` can legally appear; unescaping them keeps a note
      // containing a quote comparable with the imported object.
      note: match[4].replace(/\\(["\\])/g, "$1"),
    };
  }
  return Object.keys(parsed).length === 0 ? null : parsed;
}
