/**
 * Which English text each `PRIVACY.md.<code>` translates, and a checksum of it
 * taken on the day somebody last confirmed the translation says the same thing.
 *
 * The five translated policy pages are not translations of `PRIVACY.md`. Each
 * one carries a single section — the "Crash reporting and diagnostics"
 * blockquote naming Sentry — published under GDPR art. 12 so a reader who does
 * not read English can still find out what leaves their device and how to stop
 * it. Everything else on those pages is a sentence saying the full policy is in
 * English.
 *
 * Nothing connected the six files. The size gate in `lib/bundle-smoke.ts` floors
 * each page against its own baseline, and the similarity gate refuses a
 * translation that is the English text with edits — both are properties of the
 * TRANSLATED file, and both stay green while the English section changes
 * underneath them. So the failure this module exists for is: somebody amends the
 * English disclosure (the retention window moves from 90 days to 30, a field
 * joins the stripped list, the opt-out moves to another screen), every suite
 * passes, and `/privacy/de/` keeps serving the old promise to the reader who
 * cannot check it against the English. That is a disclosure that is wrong rather
 * than merely stale, on the page whose entire reason to exist is being readable
 * by somebody who has no other copy.
 *
 * A CHECKSUM of the English source rather than a comparison between the files:
 * nothing here can read German and decide whether it matches. What can be
 * mechanised is "the English text moved and these five have not been looked at
 * since", which is the question a reviewer can actually answer. The entry is
 * per-language, deliberately: a run that updates the German translation records
 * German's new checksum and leaves the other four red, so a partial catch-up is
 * visible as four remaining names rather than cleared by one edit.
 *
 * NORMALISED before hashing, and that choice is the difference between a rule
 * people keep and one they delete. The blockquote is hard-wrapped prose; a
 * rewrap changes every line and no words, and a guard that went red for it would
 * be turned off within a month. Stripping the `> ` markers and collapsing
 * whitespace makes a rewrap invisible and leaves every wording change caught —
 * including the ones that matter most here, which are numbers and field names
 * inside otherwise identical sentences.
 */

import { createHash } from "node:crypto";

import {
  PRIVACY_DEFAULT_LANGUAGE,
  PRIVACY_PAGE_LANGUAGES,
} from "./privacy-languages";

/**
 * The line that opens the section the five translations carry.
 *
 * A bold lead-in inside a blockquote, which is how every sub-processor entry in
 * `PRIVACY.md` is written. Matching the lead-in rather than a heading because
 * the section HAS no heading in the English file: it is one blockquote among
 * five under "Where your data is stored (sub-processors)", and a rule anchored
 * to a heading would silently start hashing the whole section the day one was
 * added.
 */
export const PRIVACY_TRANSLATED_SECTION_MARKER =
  "> **Crash reporting and diagnostics.**";

/**
 * The English blockquote the translations carry, normalised for hashing.
 *
 * Returns the run of consecutive `>` lines starting at the marker, with the
 * quote markers removed and whitespace collapsed — see the module note on why
 * a rewrap must not count as a change.
 *
 * Throws rather than returning null when the marker is missing or appears
 * twice. Both mean the English policy was restructured, and the honest response
 * to "I cannot find the section these five files translate" is a stopped suite:
 * an empty string would hash to a stable value and report every translation as
 * up to date forever.
 */
export function extractPrivacyTranslatedSection(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const starts = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.trimEnd().startsWith(PRIVACY_TRANSLATED_SECTION_MARKER));
  if (starts.length === 0) {
    throw new Error(
      `PRIVACY.md no longer contains a line beginning \`${PRIVACY_TRANSLATED_SECTION_MARKER}\` — the five translated pages carry that section and nothing can now tell whether they still match it.`,
    );
  }
  if (starts.length > 1) {
    throw new Error(
      `PRIVACY.md contains ${String(starts.length)} lines beginning \`${PRIVACY_TRANSLATED_SECTION_MARKER}\` — the marker no longer identifies one section, so the checksum would describe whichever came first.`,
    );
  }
  const body: string[] = [];
  for (let index = starts[0].index; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith(">")) break;
    body.push(line);
  }
  return normalisePolicyText(body.join("\n"));
}

/**
 * Policy prose reduced to its words: quote markers off, whitespace collapsed.
 *
 * The normalisation both checksums share, and the reason either is keepable.
 * These files are hard-wrapped: a rewrap changes every line and no meaning, and
 * a guard red for that would be switched off long before the amendment it was
 * written for arrived. Everything a reader could act on survives — numbers,
 * field names, the opt-out path — because only whitespace and the `>` prefix
 * are discarded.
 */
export function normalisePolicyText(markdown: string): string {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.replace(/^>\s?/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * How long a fingerprint is — the decision, declared once and READ by everything
 * that depends on it, {@link policyChecksum} included.
 *
 * The width was a literal in three validators — `/^[0-9a-f]{16}$/`, in the two
 * provenance modules and in a suite — and each is what decides whether a
 * recorded value is well-formed. So widening the fingerprint was four
 * coordinated edits, and the shape of getting it wrong is the bad one: the
 * tables get re-recorded with correct wider values, a validator somebody missed
 * REJECTS them, and its failure is `malformed_checksum` with the entry quoted —
 * a message blaming the data for the width nobody moved.
 *
 * It was closed by MEASURING this from the function (`policyChecksum("").length`),
 * which removed the restatements and left one oddity: a SHA-256 of the empty
 * string, computed at module load, to learn a number the function's own body
 * spelled two lines up — and this module is on the app's Sentry path, imported
 * for `scrubPII`'s promise fingerprint rather than for any guard. Declaring the
 * number and having the SLICE read it keeps every property the measurement
 * bought (one statement, no validator able to disagree with another about what
 * it is validating, a widening that is one edit and fails every recorded entry
 * until the tables are re-recorded) and costs no hash to start the app.
 *
 * What it does not buy, and what the suite therefore still asserts separately:
 * a declared constant agrees with any slice, so `policyChecksum`'s OUTPUT is
 * checked against this number rather than assumed to follow from it.
 */
export const POLICY_CHECKSUM_LENGTH = 16;

/**
 * A short, stable fingerprint: {@link POLICY_CHECKSUM_LENGTH} hex characters of
 * SHA-256 — enough that two different disclosures will not collide, short enough
 * to read in a diff and to type into the table when a page is refreshed. The
 * field is compared by a machine and READ by a reviewer, and a 64-character line
 * is only the first.
 *
 * Exported because a third disclosure fingerprint now lives outside this module
 * (`lib/sentry-scrub-promises.ts` records one for the sentence promising what
 * `scrubPII` removes) and a second implementation of "hex of SHA-256, cut to
 * width" is how two recorded values stop being comparable. Every checksum in a
 * provenance table in this repository comes through here.
 */
export function policyChecksum(text: string): string {
  return createHash("sha256")
    .update(text, "utf8")
    .digest("hex")
    .slice(0, POLICY_CHECKSUM_LENGTH);
}

/**
 * The shape a RECORDED fingerprint must have, from the same width.
 *
 * Lowercase hex is `digest("hex")`'s own output alphabet, so the character class
 * is a property of the implementation above and not a separate decision; the
 * length is the one that used to be restated. Anchored, because a pattern that
 * merely matches somewhere would accept a 64-character digest that was never
 * sliced.
 *
 * ONE `RegExp` object, shared by every validator that imports it, so it must
 * carry neither `g` nor `y`: those keep `lastIndex` across calls and two
 * validators calling `.test` on the same object would then answer differently
 * depending on who ran first. It carries no flags today, which is correct
 * rather than lucky only because the suite says so.
 */
export const POLICY_CHECKSUM_PATTERN = new RegExp(
  `^[0-9a-f]{${String(POLICY_CHECKSUM_LENGTH)}}$`,
);

/** The English section the five translations carry, fingerprinted. */
export function privacyTranslatedSectionChecksum(markdown: string): string {
  return policyChecksum(extractPrivacyTranslatedSection(markdown));
}

/**
 * One whole `PRIVACY.md.<code>` page, fingerprinted.
 *
 * The whole file rather than its blockquote, because the sentence above the
 * blockquote is a disclosure too — it tells a reader that the full policy exists
 * and is in English, which is the other half of what art. 12 is asking for.
 */
export function privacyTranslationChecksum(markdown: string): string {
  return policyChecksum(normalisePolicyText(markdown));
}

/** One translation's record of the English text it was written against. */
export type PrivacyTranslationSource = {
  /**
   * {@link privacyTranslatedSectionChecksum} of `PRIVACY.md` at the moment this
   * translation was last confirmed to say the same thing.
   */
  readonly sourceChecksum: string;
  /**
   * {@link privacyTranslationChecksum} of this page's own file at that moment.
   *
   * The symmetric half, and the cheaper one. `sourceChecksum` catches the
   * English moving out from under five translations; this catches one of the
   * five moving on its own — a merge that drops the retention sentence from the
   * German, a "fix" that turns 90 into 30 in one language. The size gate next
   * door would see a big enough deletion as a word count and sees nothing at all
   * in a changed number, which is the edit that matters most on a page nobody in
   * the room can read.
   */
  readonly translatedChecksum: string;
  /** `YYYY-MM-DD` that confirmation was made. */
  readonly checkedOn: string;
  /**
   * What was confirmed, and by what. On a refresh it must say what changed —
   * "90 → 30 day retention, re-translated" — because the whole value of the
   * field is that a reviewer can tell a re-translation from a checksum somebody
   * pasted to get the suite green.
   */
  readonly note: string;
};

/**
 * Per translated page, the English section it was written against.
 *
 * Keyed by the same codes as `PRIVACY_PAGE_LANGUAGES` minus the English
 * original, and held exhaustive by
 * `__tests__/privacy-translated-section.test.ts`: a sixth translated page added
 * without an entry here would ship unguarded, which is the state all five were
 * in until this table existed.
 *
 * The repair when either checksum goes red is to READ the two texts, decide
 * whether the change reached the meaning, re-translate if it did, and then
 * record the new value with a note saying which. Pasting the new checksum alone
 * is available and is exactly the failure `PRIVACY_BODY_BASELINES` documents
 * next door — which is why `note` is required to move with it, and why it must
 * name the change rather than the date.
 *
 * ALL FIVE `sourceChecksum` VALUES ARE IDENTICAL TODAY, and that is a state
 * rather than a design. They are equal because no amendment has yet split them:
 * the first change to the English section makes four of them stale while
 * whoever refreshes the German records only German's. Collapsing the column
 * into one shared constant would be correct arithmetic and would delete exactly
 * the property the table is for — a partial catch-up showing as four remaining
 * names instead of being cleared by one edit.
 */
export const PRIVACY_TRANSLATION_SOURCES: Readonly<
  Record<string, PrivacyTranslationSource>
> = {
  ru: {
    sourceChecksum: "9a80c71b9e718ede",
    translatedChecksum: "d5f3f68fc7c8012d",
    checkedOn: "2026-08-22",
    note: "First recorded checksums. The Russian page carries the Sentry blockquote as shipped 2026-08-11; nothing has amended the English section or this page since, so this records the state rather than a re-translation.",
  },
  be: {
    sourceChecksum: "9a80c71b9e718ede",
    translatedChecksum: "d06943bcea0b8824",
    checkedOn: "2026-08-22",
    note: "First recorded checksums, same English section and same reasoning as ru.",
  },
  pl: {
    sourceChecksum: "9a80c71b9e718ede",
    translatedChecksum: "73bf12618bd8be4a",
    checkedOn: "2026-08-22",
    note: "First recorded checksums, same English section and same reasoning as ru.",
  },
  de: {
    sourceChecksum: "9a80c71b9e718ede",
    translatedChecksum: "be4906866243eb68",
    checkedOn: "2026-08-22",
    note: "First recorded checksums, same English section and same reasoning as ru.",
  },
  es: {
    sourceChecksum: "9a80c71b9e718ede",
    translatedChecksum: "366e646ebda615aa",
    checkedOn: "2026-08-22",
    note: "First recorded checksums, same English section and same reasoning as ru.",
  },
};

/**
 * The {@link PRIVACY_TRANSLATION_SOURCES} literal recovered from a revision of
 * this module's SOURCE TEXT, or null when the declaration is not there at all.
 *
 * A regex over the literal rather than an import, for the same reason
 * `parsePrivacyBodyBaselines` is one: the input is
 * `git show <base>:lib/privacy-translated-section.ts` — a string from a commit
 * that may predate this file, may predate the field set, and must not be
 * executed.
 *
 * Null means "no comparable table at that revision" and the caller SKIPS the
 * drift half rather than reporting five changes.
 * `__tests__/privacy-translated-section.test.ts` round-trips the file on disk
 * through this parser, so a reformat that defeats it fails on the commit that
 * does it rather than three commits later.
 */
export function parsePrivacyTranslationSources(
  source: string,
): Record<string, PrivacyTranslationSource> | null {
  // Anchored on the DECLARATION rather than the name, which also appears in
  // this file's prose above it.
  const start = source.indexOf("export const PRIVACY_TRANSLATION_SOURCES");
  if (start === -1) return null;
  const open = source.indexOf("{", start);
  if (open === -1) return null;
  // Closed by a `};` at column 0 — every nested brace in the literal is
  // indented, so this needs no brace counting.
  const close = source.indexOf("\n};", open);
  if (close === -1) return null;
  const body = source.slice(open, close);

  const entry =
    /([a-z]{2,8})\s*:\s*\{\s*sourceChecksum\s*:\s*"([0-9a-f]*)"\s*,\s*translatedChecksum\s*:\s*"([0-9a-f]*)"\s*,\s*checkedOn\s*:\s*"([^"]*)"\s*,\s*note\s*:\s*"((?:[^"\\]|\\.)*)"\s*,?\s*\}/g;
  const parsed: Record<string, PrivacyTranslationSource> = {};
  for (const match of body.matchAll(entry)) {
    parsed[match[1]] = {
      sourceChecksum: match[2],
      translatedChecksum: match[3],
      checkedOn: match[4],
      // Only `\"` and `\\` can legally appear; unescaping them keeps a note
      // containing a quote comparable with the imported object.
      note: match[5].replace(/\\(["\\])/g, "$1"),
    };
  }
  return Object.keys(parsed).length === 0 ? null : parsed;
}

/**
 * The codes {@link PRIVACY_TRANSLATION_SOURCES} must cover — every page the
 * `/privacy` picker offers except the English original, which is the source
 * rather than a translation of it.
 */
export const PRIVACY_TRANSLATED_LANGUAGES: readonly string[] =
  PRIVACY_PAGE_LANGUAGES.map(({ code }) => code).filter(
    (code) => code !== PRIVACY_DEFAULT_LANGUAGE,
  );
