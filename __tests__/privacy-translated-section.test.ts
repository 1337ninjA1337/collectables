import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PRIVACY_TRANSLATED_LANGUAGES,
  PRIVACY_TRANSLATED_SECTION_MARKER,
  PRIVACY_TRANSLATION_SOURCES,
  extractPrivacyTranslatedSection,
  privacyTranslatedSectionChecksum,
} from "../lib/privacy-translated-section";
import { privacyPolicySourcePath } from "../lib/privacy-body-baselines";

import { readRepoFile } from "./helpers/repo-file";

/**
 * The English disclosure moved and five translations did not.
 *
 * `PRIVACY.md.ru|be|pl|de|es` each carry ONE section of the English policy — the
 * "Crash reporting and diagnostics" blockquote naming Sentry — published under
 * GDPR art. 12 for a reader who cannot read the full policy. Every rule this
 * repository has about those files is a property of the file itself: a word
 * count floored against its own baseline, a similarity gate refusing the English
 * text with edits. Both stay green while the English section changes underneath
 * them, and the result is not a stale page but a WRONG one — "retained for up to
 * 90 days" still promised in German after the English says 30, to the reader
 * with no other copy.
 *
 * So the English source gets a checksum, recorded per translation. Nothing here
 * can read German; what it can say is "the text these five were written against
 * has changed and nobody has looked at them since", which is a question a
 * reviewer can answer.
 */

const ENGLISH = readRepoFile("PRIVACY.md");

describe("the English section the five translations carry", () => {
  it("appears exactly once, and is the disclosure it is supposed to be", () => {
    // The premise under every checksum below. A marker that matched nothing
    // would throw (which is the design), but one that matched the WRONG
    // blockquote would hash happily and guard the wrong paragraph forever.
    //
    // Phrases that IDENTIFY the section, not ones that state its terms. "90
    // days" would have worked today and would have gone red on the amendment
    // this whole file is written for — a premise case that fails on the event
    // it is the premise for is a second copy of the rule wearing the wrong hat.
    const section = extractPrivacyTranslatedSection(ENGLISH);
    for (const phrase of [
      "Crash reporting and diagnostics",
      "Sentry",
      "sub-processor",
    ]) {
      assert.ok(
        section.includes(phrase),
        `the extracted section does not mention "${phrase}" — the marker is no longer finding the crash-reporting disclosure:\n  ${section.slice(0, 200)}…`,
      );
    }
    assert.ok(
      section.length > 400,
      `the extracted section is only ${String(section.length)} characters — the blockquote scan stopped early and the checksum covers a fragment`,
    );
  });

  it("ignores a rewrap and notices a word", () => {
    // The normalisation is the whole reason this rule is keepable. The section
    // is hard-wrapped prose: a prettier pass changes every line and no meaning,
    // and a guard that went red for that would be switched off long before the
    // amendment it was written for arrived.
    const wrapped = [
      "> **Crash reporting and diagnostics.** Retained for up to 90 days",
      "> and never sold.",
      "",
    ].join("\n");
    const rewrapped = [
      "> **Crash reporting and diagnostics.** Retained for up to",
      "> 90 days and never sold.",
      "",
    ].join("\n");
    const amended = wrapped.replace("90 days", "30 days");
    assert.equal(
      privacyTranslatedSectionChecksum(wrapped),
      privacyTranslatedSectionChecksum(rewrapped),
      "re-wrapping the blockquote changed the checksum — every prettier pass would demand five re-translations",
    );
    assert.notEqual(
      privacyTranslatedSectionChecksum(wrapped),
      privacyTranslatedSectionChecksum(amended),
      "changing the retention window did NOT change the checksum — the one amendment this rule exists for would pass",
    );
  });

  it("stops at the end of the blockquote", () => {
    // A scan that ran on into the next paragraph would fold an unrelated
    // sub-processor into the checksum, and every edit to PostHog's entry would
    // demand five re-translations of a section that had not moved.
    const source = [
      "> **Crash reporting and diagnostics.** Sentry, 90 days.",
      "",
      "> **Product analytics.** PostHog, a different sub-processor entirely.",
      "",
    ].join("\n");
    assert.equal(
      extractPrivacyTranslatedSection(source),
      "**Crash reporting and diagnostics.** Sentry, 90 days.",
    );
  });

  it("refuses a policy where the marker is missing or ambiguous", () => {
    // Both mean the English file was restructured. Returning an empty string
    // would hash to a stable value and report all five translations current
    // forever, which is the failure mode a checksum is least able to survive.
    assert.throws(
      () => extractPrivacyTranslatedSection("# Policy\n\nNo blockquotes here.\n"),
      /no longer contains a line beginning/,
    );
    assert.throws(
      () =>
        extractPrivacyTranslatedSection(
          [
            `${PRIVACY_TRANSLATED_SECTION_MARKER} one`,
            "",
            `${PRIVACY_TRANSLATED_SECTION_MARKER} two`,
            "",
          ].join("\n"),
        ),
      /contains 2 lines beginning/,
    );
  });
});

describe("PRIVACY_TRANSLATION_SOURCES — one entry per translated page", () => {
  it("covers every translated page and nothing else", () => {
    assert.deepEqual(
      Object.keys(PRIVACY_TRANSLATION_SOURCES).sort(),
      [...PRIVACY_TRANSLATED_LANGUAGES].sort(),
      "the table has drifted from the languages the /privacy picker offers — a page without an entry ships with nothing checking it against the English",
    );
    assert.ok(
      PRIVACY_TRANSLATED_LANGUAGES.length >= 5,
      `only ${String(PRIVACY_TRANSLATED_LANGUAGES.length)} translated page(s) — the cases below would prove little`,
    );
    assert.ok(
      !PRIVACY_TRANSLATED_LANGUAGES.includes("en"),
      "English is listed as a translation of itself, so its entry would compare the source against its own checksum",
    );
  });

  for (const [code, entry] of Object.entries(PRIVACY_TRANSLATION_SOURCES)) {
    describe(`${code}`, () => {
      it("was written against the English section as it stands today", () => {
        const current = privacyTranslatedSectionChecksum(ENGLISH);
        assert.equal(
          entry.sourceChecksum,
          current,
          `the crash-reporting disclosure in PRIVACY.md has changed since ${privacyPolicySourcePath(code)} was last confirmed against it (recorded ${entry.checkedOn}).\n` +
            `  Read the English section, decide whether the change reached the MEANING, and re-translate if it did — this page is the only copy its reader has.\n` +
            `  Then record ${current} here with a note naming the change ("90 → 30 day retention, re-translated"), not just the date.\n` +
            `  Every other translation is red for the same reason and each is its own decision: updating one does not clear the rest.`,
        );
      });

      it("carries a note that says what was confirmed", () => {
        // Same argument PRIVACY_BODY_BASELINES makes about its own numbers: the
        // documented repair for a red checksum is "paste the new one in", so the
        // field that stops that from being the whole commit is the one a
        // reviewer reads.
        assert.match(entry.sourceChecksum, /^[0-9a-f]{16}$/, "checksum is not 16 lowercase hex characters");
        assert.match(entry.checkedOn, /^\d{4}-\d{2}-\d{2}$/, "checkedOn is not a YYYY-MM-DD date");
        assert.ok(
          entry.note.split(/\s+/).length >= 8,
          `${code}'s note is ${String(entry.note.split(/\s+/).length)} words — too short to say what was confirmed: ${entry.note}`,
        );
      });

      it("has a page on disk that is about the section it records", () => {
        // The checksum guards the English half of a pair, and a pair needs both
        // halves: an entry recording a checksum for a file that no longer
        // carries the disclosure is a rule guarding nothing.
        const translated = readRepoFile(privacyPolicySourcePath(code));
        assert.match(
          translated,
          /Sentry/,
          `${privacyPolicySourcePath(code)} does not mention Sentry — it is recorded here as a translation of the crash-reporting disclosure`,
        );
        assert.match(
          translated,
          /^>/m,
          `${privacyPolicySourcePath(code)} has no blockquote — the disclosure it translates is one, and its absence is what the size gate would only notice as a number`,
        );
      });
    });
  }
});
