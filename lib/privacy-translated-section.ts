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

import { PRIVACY_DEFAULT_LANGUAGE, PRIVACY_PAGE_LANGUAGES } from "./privacy-page";

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
    body.push(line.replace(/^>\s?/, ""));
  }
  return body.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * A short, stable fingerprint of {@link extractPrivacyTranslatedSection}.
 *
 * Sixteen hex characters of SHA-256: enough that two different disclosures will
 * not collide, short enough to read in a diff and to type into the table when a
 * translation is refreshed. The point of the field is to be compared by a
 * machine and READ by a reviewer, and a 64-character line is only the first.
 */
export function privacyTranslatedSectionChecksum(markdown: string): string {
  return createHash("sha256")
    .update(extractPrivacyTranslatedSection(markdown), "utf8")
    .digest("hex")
    .slice(0, 16);
}

/** One translation's record of the English text it was written against. */
export type PrivacyTranslationSource = {
  /**
   * {@link privacyTranslatedSectionChecksum} of `PRIVACY.md` at the moment this
   * translation was last confirmed to say the same thing.
   */
  readonly sourceChecksum: string;
  /** `YYYY-MM-DD` that confirmation was made. */
  readonly checkedOn: string;
  /**
   * What was confirmed, and by what. On a refresh it must say what changed in
   * the English — "90 → 30 day retention, re-translated" — because the whole
   * value of the field is that a reviewer can tell a re-translation from a
   * checksum somebody pasted to get the suite green.
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
 * The repair when this goes red is to READ the English section, decide whether
 * the change reached the meaning, update the translation if it did, and then
 * record the new checksum with a note saying which. Pasting the new checksum
 * alone is available and is exactly the failure `PRIVACY_BODY_BASELINES`
 * documents next door — which is why `note` is required to move with it, and
 * why it must name the change rather than the date.
 */
export const PRIVACY_TRANSLATION_SOURCES: Readonly<
  Record<string, PrivacyTranslationSource>
> = {
  ru: {
    sourceChecksum: "9a80c71b9e718ede",
    checkedOn: "2026-08-22",
    note: "First recorded checksum. The Russian page carries the Sentry blockquote as shipped 2026-08-11; nothing has amended the English section since, so this records the state rather than a re-translation.",
  },
  be: {
    sourceChecksum: "9a80c71b9e718ede",
    checkedOn: "2026-08-22",
    note: "First recorded checksum, same English section and same reasoning as ru.",
  },
  pl: {
    sourceChecksum: "9a80c71b9e718ede",
    checkedOn: "2026-08-22",
    note: "First recorded checksum, same English section and same reasoning as ru.",
  },
  de: {
    sourceChecksum: "9a80c71b9e718ede",
    checkedOn: "2026-08-22",
    note: "First recorded checksum, same English section and same reasoning as ru.",
  },
  es: {
    sourceChecksum: "9a80c71b9e718ede",
    checkedOn: "2026-08-22",
    note: "First recorded checksum, same English section and same reasoning as ru.",
  },
};

/**
 * The codes {@link PRIVACY_TRANSLATION_SOURCES} must cover — every page the
 * `/privacy` picker offers except the English original, which is the source
 * rather than a translation of it.
 */
export const PRIVACY_TRANSLATED_LANGUAGES: readonly string[] =
  PRIVACY_PAGE_LANGUAGES.map(({ code }) => code).filter(
    (code) => code !== PRIVACY_DEFAULT_LANGUAGE,
  );
