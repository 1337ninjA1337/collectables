/**
 * The keys no locale may inherit, and why each one is different from the other
 * five hundred.
 *
 * `lib/i18n-coverage.ts` measures the silent fallback and publishes it as a
 * number per language, floored so a locale cannot lose translations. That is
 * the right shape for the map as a whole: a new English string ships before
 * its five translations, and a rule demanding every key in every language on
 * the day it lands would go red on every feature PR. The coverage numbers say
 * how much is inherited; they deliberately say nothing about WHICH keys, and
 * for almost every key that is correct — an English `deleteItem` under a
 * Polish flag is a gap, not a defect.
 *
 * A handful of keys are not like that. `languagePartial` is the badge that
 * tells a reader their language is incomplete; served in English, under their
 * own flag, it is a warning about the fallback delivered BY the fallback. The
 * heading above it has the same problem in a milder form: the language section
 * is the one screen a reader goes to precisely because the app is not in a
 * language they chose, so it is the last place an untranslated string can be
 * excused as "ships ahead of its translations".
 *
 * So those keys get a list, and the list carries a reason each — the shape
 * `NEVER_WALKED_REASONS` and `UNCOUNTED_MODULE_REASONS` already use here,
 * because a set of names with one sentence over all of them stops being
 * reviewable at the second entry. This is a rule about four keys and it is
 * meant to stay small: the argument for adding a fifth has to be that its
 * English fallback defeats the key's own purpose, not that it would be nice to
 * have translated.
 *
 * Pure and node-safe: it takes coverage rows somebody else parsed, the same
 * split `lib/i18n-coverage.ts` has from `lib/i18n-source.ts`.
 */

/**
 * Keys every locale must declare for itself, one reason each.
 *
 * The two `languagePartial*` entries are the irreducible core — they are the
 * only strings in the app whose whole purpose is to be read by speakers of the
 * four partially translated languages — and
 * `__tests__/i18n-required-keys.test.ts` asserts they are here rather than
 * trusting this comment.
 */
export const REQUIRED_IN_EVERY_LOCALE: Readonly<Record<string, string>> = {
  languagePartial:
    "the badge that says this language is incomplete — inherited from `en` it is a warning about the English fallback, written in English, on the chip of the language it is warning about",
  languagePartialHint:
    "the same warning as the chip's accessibility label, and the only form of it a screen-reader user gets; inherited, it reads the whole chip out in English to the one reader who cannot skim past it",
  language:
    "the heading of the language section, the one screen a reader opens BECAUSE the interface is not in a language they chose; an English heading there is the fallback failing at the moment it is being explained",
  languageSubtitle:
    "the sentence under that heading, where a reader who did not recognise the section title looks next; inherited alongside it, the fallback leaves the whole language card in English for the reader least able to read it",
};

/** One locale that inherits a key it must declare. */
export type RequiredKeyGap = {
  readonly language: string;
  readonly key: string;
};

/**
 * The rows this rule reads: a language and what it did NOT declare.
 *
 * Structurally a subset of {@link import("./i18n-coverage").TranslationCoverage},
 * spelled here so this module takes what it uses — the coverage row carries
 * four more fields, all of them about the arithmetic this rule has no opinion
 * about.
 */
export type InheritedKeys = {
  readonly language: string;
  readonly inherited: readonly string[];
};

/**
 * Every required key a locale leans on the base map for.
 *
 * In the list's own order, then by language, so the report reads as "this key
 * is missing from these languages" — which is the order somebody fixing it
 * works in. The base language itself inherits nothing by definition, so it
 * never appears.
 */
export function findRequiredKeyGaps(rows: readonly InheritedKeys[]): RequiredKeyGap[] {
  const gaps: RequiredKeyGap[] = [];
  for (const key of Object.keys(REQUIRED_IN_EVERY_LOCALE)) {
    for (const row of rows) {
      if (row.inherited.includes(key)) gaps.push({ language: row.language, key });
    }
  }
  return gaps;
}

/**
 * One gap as the sentence a reader meets, carrying the reason the key is on
 * the list.
 *
 * The reason travels with the failure rather than living only in the table,
 * because the person who meets this is adding a language or a key and has no
 * particular cause to go read a constant — and "translate this one too" with
 * no argument behind it is advice that gets an English string pasted in.
 */
export function describeRequiredKeyGap(gap: RequiredKeyGap): string {
  const reason = REQUIRED_IN_EVERY_LOCALE[gap.key] ?? "no reason recorded";
  return `${gap.language} inherits \`${gap.key}\` from the base map — ${reason}`;
}

/**
 * Required keys the base map does not have.
 *
 * A rule about a key that does not exist is a rule about nothing, and it fails
 * in the quiet direction: `findRequiredKeyGaps` can never report a key no
 * locale inherits, so a typo here would read as four languages in perfect
 * order. The same audit `unusedUncountedExcuses` does for its table.
 */
export function unknownRequiredKeys(baseKeys: Iterable<string>): string[] {
  const known = new Set(baseKeys);
  return Object.keys(REQUIRED_IN_EVERY_LOCALE).filter((key) => !known.has(key));
}

/**
 * Every `t("key")` a source file reads, deduplicated and in first-seen order.
 *
 * Deliberately literal-only: `t(someVariable)` is invisible to this, and the
 * one thing it is used for — asking whether a required key is still rendered
 * by a screen — is a question about keys somebody wrote down. A parser that
 * guessed at computed keys would answer "yes, probably" about a key nothing
 * renders, which is the answer that makes the audit worthless.
 */
export function translationKeysUsed(source: string): string[] {
  const seen = new Set<string>();
  for (const match of source.matchAll(/\bt\(\s*"([A-Za-z0-9_]+)"/g)) {
    seen.add(match[1]);
  }
  return [...seen];
}
