/**
 * A checksum in `PRIVACY_TRANSLATION_SOURCES` may not change quietly — the pure
 * half. The git half is in `scripts/check-privacy-baseline-provenance.ts`, which
 * runs this pass alongside the word-count one.
 *
 * The two checksum columns turn every edit to a shipped legal disclosure into a
 * red suite. That is what they are for, and it is also their weakness: the
 * documented repair is "record the new value here", the failure message says so
 * in as many words, and a table whose repair is a paste is one commit away from
 * being a rubber stamp. `PRIVACY_BODY_BASELINES` next door has exactly this
 * problem and exactly this answer — the person changing the value writes down
 * why, in the same commit, next to the value — so this is that answer applied to
 * the second table rather than a new idea.
 *
 * What it can and cannot do is worth stating plainly. It cannot tell a
 * re-translation from a paste; nothing can, because both change the file and
 * both change the checksum. It forces the diff to SAY which, to a reviewer who
 * can read "90 → 30 day retention, German re-translated" and ask whether the
 * Spanish was supposed to move too. A reviewability guarantee, not a correctness
 * one, and the only kind available for prose in a language the reviewer may not
 * read.
 *
 * Deliberately NOT a copy of `evaluatePrivacyBaselineDrift` with the field names
 * swapped, in one respect: that rule requires the note to NAME the number it
 * replaced, because "1171 → 980" is a fact a reader can weigh. Sixteen hex
 * characters are not — a note quoting the previous checksum is noise that proves
 * only that somebody could copy. What is required here is that the note MOVED,
 * which is the part a paste does not do.
 */

import { checkError } from "./check-error";
import { privacyPolicySourcePath } from "./privacy-body-baselines";
import { PRIVACY_DEFAULT_LANGUAGE } from "./privacy-languages";
import {
  POLICY_CHECKSUM_PATTERN,
  PRIVACY_TRANSLATED_LANGUAGES,
  type PrivacyTranslationSource,
} from "./privacy-translated-section";
import {
  formatUnknownProvenanceKey,
  unknownProvenanceKeyDetail,
  type ProvenanceKeySet,
} from "./provenance-key-set";

export type TranslationProvenanceFailureCode =
  | "unknown_language"
  | "malformed_checksum"
  | "malformed_date"
  | "note_too_short"
  | "provenance_unchanged"
  | "provenance_date_regressed"
  | "policy_unchanged";

export type TranslationProvenanceFailure = {
  /** Language code whose entry is at fault. */
  readonly language: string;
  readonly code: TranslationProvenanceFailureCode;
  /** What was read; spliced into the message. */
  readonly detail?: string;
};

/**
 * A note has to be a sentence. Eight rather than the five its neighbour asks
 * for, because this note has more to carry: a word count moves for one reason
 * and a checksum moves for two (the English changed, or this page did), so the
 * note has to say which.
 */
export const TRANSLATION_NOTE_MIN_WORDS = 8;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/**
 * The width is `policyChecksum`'s, measured — not a `{16}` restated here. This
 * table records that function's output, so "well-formed" has to mean whatever
 * the function currently produces, or a widening leaves the table holding short
 * values that every check calls fine.
 */
const CHECKSUM = POLICY_CHECKSUM_PATTERN;

/**
 * The five translations, and NOT English — which is the whole difference between
 * this set and the baselines table's, and the reason the shared rule takes the
 * set as data instead of reaching for one list.
 *
 * English is the SOURCE these five are checked against, not a translation, so an
 * `en` entry here is a table that has recorded a checksum of `PRIVACY.md`
 * against itself. Every other case in this suite would pass on it.
 */
const TRANSLATION_KEY_SET: ProvenanceKeySet = {
  table: "PRIVACY_TRANSLATION_SOURCES",
  outsideMeans: "no TRANSLATED /privacy page is published for",
  listLabel: "Translated pages",
  members: PRIVACY_TRANSLATED_LANGUAGES,
};

/** Well-formedness of the table as it stands, independent of any history. */
export function evaluateTranslationProvenanceShape(
  table: Readonly<Record<string, PrivacyTranslationSource>>,
): readonly TranslationProvenanceFailure[] {
  const failures: TranslationProvenanceFailure[] = [];
  for (const [language, entry] of Object.entries(table)) {
    // Asked FIRST, and the rule and its reasoning live in
    // `lib/provenance-key-set.ts` — this table brings only the set and the three
    // phrases that name it.
    const unknownKey = unknownProvenanceKeyDetail(language, TRANSLATION_KEY_SET);
    if (unknownKey !== null) {
      failures.push({
        language,
        code: "unknown_language",
        detail: unknownKey,
      });
    }
    for (const [field, value] of [
      ["sourceChecksum", entry.sourceChecksum],
      ["translatedChecksum", entry.translatedChecksum],
    ] as const) {
      if (!CHECKSUM.test(value)) {
        failures.push({
          language,
          code: "malformed_checksum",
          detail: `${field} is ${JSON.stringify(value)}`,
        });
      }
    }
    if (!ISO_DATE.test(entry.checkedOn)) {
      failures.push({
        language,
        code: "malformed_date",
        detail: JSON.stringify(entry.checkedOn),
      });
    }
    const words = entry.note.trim().split(/\s+/).filter(Boolean).length;
    if (words < TRANSLATION_NOTE_MIN_WORDS) {
      failures.push({
        language,
        code: "note_too_short",
        detail: `${String(words)} word(s)`,
      });
    }
  }
  return failures;
}

/**
 * What changed between two revisions of the table, given the files the same diff
 * touched.
 *
 * A language absent from `previous` is NEW and produces nothing: it has no prior
 * value to have moved away from, and the shape half has already asked whether
 * its note and date are real. A language absent from `current` was removed,
 * which the table ↔ picker parity case already speaks to.
 *
 * Which FILE has to be touched depends on which checksum moved, and that is the
 * useful part of the message: `sourceChecksum` describes `PRIVACY.md`, and
 * `translatedChecksum` describes this language's own page. A checksum that moved
 * while the file it describes was untouched is a value that cannot have been
 * measured from anything.
 *
 * `changedFiles` are repo-relative posix paths, as `git diff --name-only` emits.
 */
export function evaluateTranslationProvenanceDrift(
  previous: Readonly<Record<string, PrivacyTranslationSource>>,
  current: Readonly<Record<string, PrivacyTranslationSource>>,
  changedFiles: readonly string[],
): readonly TranslationProvenanceFailure[] {
  const touched = new Set(changedFiles);
  const failures: TranslationProvenanceFailure[] = [];
  for (const [language, entry] of Object.entries(current)) {
    const before = previous[language];
    if (before === undefined) continue;
    const sourceMoved = before.sourceChecksum !== entry.sourceChecksum;
    const pageMoved = before.translatedChecksum !== entry.translatedChecksum;
    if (!sourceMoved && !pageMoved) continue;

    // Both through the same helper, and the English one is not a literal: two
    // adjacent lines answering "where does this file live" two different ways
    // is how one of them stops being true.
    for (const [moved, path] of [
      [sourceMoved, privacyPolicySourcePath(PRIVACY_DEFAULT_LANGUAGE)],
      [pageMoved, privacyPolicySourcePath(language)],
    ] as const) {
      if (moved && !touched.has(path)) {
        failures.push({
          language,
          code: "policy_unchanged",
          detail: `the checksum describing ${path} moved and ${path} is untouched`,
        });
      }
    }
    if (before.checkedOn === entry.checkedOn && before.note === entry.note) {
      failures.push({
        language,
        code: "provenance_unchanged",
        detail: `still dated ${entry.checkedOn} with the same note`,
      });
      // The date check below reads the new provenance; with neither field
      // touched there is nothing to read, and one cause reported twice reads as
      // two problems.
      continue;
    }
    if (entry.checkedOn < before.checkedOn) {
      failures.push({
        language,
        code: "provenance_date_regressed",
        detail: `${entry.checkedOn} is earlier than ${before.checkedOn}`,
      });
    }
  }
  return failures;
}

const MESSAGE: Record<
  TranslationProvenanceFailureCode,
  (language: string, detail: string | undefined) => string
> = {
  unknown_language: (language, detail) =>
    formatUnknownProvenanceKey(language, TRANSLATION_KEY_SET, detail),
  malformed_checksum: (language, detail) =>
    `PRIVACY_TRANSLATION_SOURCES["${language}"]: ${detail ?? "a checksum"} — expected sixteen lowercase hex characters, which is what privacyTranslatedSectionChecksum emits. A value that shape cannot have been measured.`,
  malformed_date: (language, detail) =>
    `PRIVACY_TRANSLATION_SOURCES["${language}"].checkedOn is ${detail ?? "not a date"} — it records the day somebody confirmed this page against the English, and a date nothing can order is a date nobody can act on.`,
  note_too_short: (language, detail) =>
    `PRIVACY_TRANSLATION_SOURCES["${language}"].note is ${detail ?? "too short"} — a checksum moves for two different reasons (the English section changed, or this page did) and the note is the only place the diff says which.`,
  provenance_unchanged: (language, detail) =>
    `PRIVACY_TRANSLATION_SOURCES["${language}"] has a new checksum with the same note and date (${detail ?? ""}). The value moved because a shipped legal disclosure moved; say what changed, in this commit, where a reviewer who does not read the language will see it.`,
  provenance_date_regressed: (language, detail) =>
    `PRIVACY_TRANSLATION_SOURCES["${language}"].checkedOn went backwards — ${detail ?? ""}. A confirmation cannot have happened before the one it replaces; this is usually a merge that kept the wrong side.`,
  policy_unchanged: (language, detail) =>
    `PRIVACY_TRANSLATION_SOURCES["${language}"]: ${detail ?? "a checksum moved with no file behind it"}. The value is measured FROM that file, so either the wrong number was pasted in or the file's change was lost in a merge.`,
};

/** The least recently confirmed page(s) in the table, and when. */
export type OldestConfirmation = {
  readonly checkedOn: string;
  /** Every language sharing that date, in `PRIVACY_TRANSLATED_LANGUAGES` order. */
  readonly languages: readonly string[];
};

/**
 * Which page has gone longest without somebody looking at it.
 *
 * The table's whole subject is "has anyone confirmed this translation since the
 * English moved", and until now the only way that reached a reader was as a
 * FAILURE. A page confirmed a year ago against an English section that has not
 * changed since is green, and indistinguishable in every output from one
 * confirmed this morning — which is right in the sense that there is nothing to
 * fix, and hides the case where a disclosure is old because nobody is looking
 * rather than because nothing moved.
 *
 * Ordered by string comparison, which is correct for `YYYY-MM-DD` and is only
 * ever asked of a table whose dates already passed their shape check — the line
 * this feeds is printed on a PASS, and a malformed date is a failure.
 *
 * Every language sharing the oldest date is named rather than one picked from
 * them: a table recorded in one sitting has all five on the same day, and a line
 * naming one of five would read as a fact about that page.
 */
export function oldestConfirmation(
  table: Readonly<Record<string, PrivacyTranslationSource>>,
): OldestConfirmation | null {
  const dates = Object.values(table).map((entry) => entry.checkedOn);
  if (dates.length === 0) return null;
  const checkedOn = dates.reduce((a, b) => (a <= b ? a : b));
  // Walked over the CONSTANT rather than over the table's keys, so the order a
  // reader sees does not depend on how the object literal happens to be written.
  const languages = PRIVACY_TRANSLATED_LANGUAGES.filter(
    (code) => table[code]?.checkedOn === checkedOn,
  );
  return { checkedOn, languages };
}

export type TranslationProvenanceResult = {
  readonly ok: boolean;
  readonly failures: readonly TranslationProvenanceFailure[];
  /** Entries the shape half looked at. */
  readonly checked: number;
  /** Base revision the drift half ran against, or null when it did not run. */
  readonly comparedAgainst: string | null;
  /**
   * The least recently confirmed page(s), for the pass line — see
   * {@link oldestConfirmation}. Null only when the table is empty, which is
   * itself a failure, so the pass line always has one.
   */
  readonly oldest: OldestConfirmation | null;
};

export function evaluateTranslationProvenance(input: {
  readonly current: Readonly<Record<string, PrivacyTranslationSource>>;
  readonly previous: Readonly<Record<string, PrivacyTranslationSource>> | null;
  readonly baseRef: string | null;
  readonly changedFiles: readonly string[];
}): TranslationProvenanceResult {
  const shape = evaluateTranslationProvenanceShape(input.current);
  const compared = input.previous !== null && input.baseRef !== null;
  const drift = compared
    ? evaluateTranslationProvenanceDrift(
        input.previous as Readonly<Record<string, PrivacyTranslationSource>>,
        input.current,
        input.changedFiles,
      )
    : [];
  const failures = [...shape, ...drift];
  const checked = Object.keys(input.current).length;
  return {
    ok: checked > 0 && failures.length === 0,
    failures,
    checked,
    comparedAgainst: compared ? input.baseRef : null,
    oldest: oldestConfirmation(input.current),
  };
}

export function formatTranslationProvenanceReport(
  checkName: string,
  result: TranslationProvenanceResult,
): string {
  if (result.ok) {
    const against =
      result.comparedAgainst === null
        ? "no previous revision of the table was readable, so only the shape half ran"
        : `compared against ${result.comparedAgainst}`;
    // The age of the oldest confirmation, said on the PASS line, because that
    // is the only run where anybody reads it. A number a person can act on
    // before a suite makes them.
    const age =
      result.oldest === null
        ? ""
        : ` Oldest confirmation ${result.oldest.checkedOn} (${result.oldest.languages.join(", ")}).`;
    return `${checkName}: ${String(result.checked)} translation checksum record(s) well-formed (${against}).${age}`;
  }
  if (result.checked === 0) {
    return checkError(
      checkName,
      "PRIVACY_TRANSLATION_SOURCES is empty; a pass over zero records is not a pass.",
    );
  }
  return result.failures
    .map(
      (failure) =>
        checkError(
          checkName,
          MESSAGE[failure.code](failure.language, failure.detail),
        ),
    )
    .join("\n");
}
