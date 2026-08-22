import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LINT_GUARDS } from "../lib/lint-guards";
import {
  PRIVACY_TRANSLATION_SOURCES,
  parsePrivacyTranslationSources,
  type PrivacyTranslationSource,
} from "../lib/privacy-translated-section";
import {
  TRANSLATION_NOTE_MIN_WORDS,
  evaluateTranslationProvenance,
  evaluateTranslationProvenanceDrift,
  evaluateTranslationProvenanceShape,
  formatTranslationProvenanceReport,
  type TranslationProvenanceFailureCode,
} from "../lib/privacy-translation-provenance";

import { readRepoFile } from "./helpers/repo-file";

/**
 * The guard that stops a disclosure checksum being pasted green.
 *
 * `PRIVACY_TRANSLATION_SOURCES` turns every edit to a shipped legal page into a
 * red suite, and the documented repair is "record the new value here" — which is
 * exactly how a table becomes a rubber stamp. `PRIVACY_BODY_BASELINES` has the
 * same shape of problem and the same answer: whoever changes the number writes
 * down why, in the same commit, next to it. This pins that answer applied to the
 * second table.
 *
 * It cannot tell a re-translation from a paste. Nothing can — both change the
 * file and both change the checksum. What it forces is that the diff SAYS which,
 * to a reviewer who may not read the language the page is written in.
 */

const entry = (over: Partial<PrivacyTranslationSource> = {}): PrivacyTranslationSource => ({
  sourceChecksum: "0123456789abcdef",
  translatedChecksum: "fedcba9876543210",
  checkedOn: "2026-08-22",
  note: "First recorded checksums for this page, against the English section as it stands.",
  ...over,
});

const codesOf = (
  failures: readonly { readonly code: TranslationProvenanceFailureCode }[],
): readonly TranslationProvenanceFailureCode[] => failures.map((f) => f.code);

describe("PRIVACY_TRANSLATION_SOURCES — the shipped table", () => {
  it("is well-formed by its own guard", () => {
    // The guard runs over this exact object in the lint fan-out; asserting it
    // here means a bad entry fails in the test leg rather than only in the
    // guard leg, where the report is one line in a fan-out.
    assert.deepEqual(evaluateTranslationProvenanceShape(PRIVACY_TRANSLATION_SOURCES), []);
  });

  it("round-trips through the parser the drift half reads history with", () => {
    // The drift half reads the PREVIOUS revision as text, so a reformat that
    // defeats the parser turns that half off silently. This fails on the commit
    // that does it instead of three commits later.
    assert.deepEqual(
      parsePrivacyTranslationSources(readRepoFile("lib/privacy-translated-section.ts")),
      PRIVACY_TRANSLATION_SOURCES,
    );
  });

  it("is named in the guard registry's description", () => {
    // The registry line is what a reader scanning `lint:all` sees. A guard that
    // silently grew a second table is one nobody knows is protecting it.
    const guard = LINT_GUARDS.find((g) => g.npmScript === "lint:baseline-provenance");
    assert.ok(guard, "lint:baseline-provenance is no longer in the registry");
    assert.match(guard.description, /PRIVACY_TRANSLATION_SOURCES/);
  });

  it("reads nothing out of a revision that has no table", () => {
    assert.equal(parsePrivacyTranslationSources("export const OTHER = {};"), null);
    assert.equal(
      parsePrivacyTranslationSources("export const PRIVACY_TRANSLATION_SOURCES = {\n};"),
      null,
    );
  });
});

describe("the shape half", () => {
  it("refuses a checksum that cannot have been measured", () => {
    assert.deepEqual(
      codesOf(evaluateTranslationProvenanceShape({ de: entry({ sourceChecksum: "TODO" }) })),
      ["malformed_checksum"],
    );
    assert.deepEqual(
      codesOf(
        evaluateTranslationProvenanceShape({
          de: entry({ translatedChecksum: "BE4906866243EB68" }),
        }),
      ),
      ["malformed_checksum"],
      "an uppercase checksum passed — the recorded value must be comparable with what the hasher emits, not merely hex-shaped",
    );
  });

  it("refuses a date nothing can order", () => {
    assert.deepEqual(
      codesOf(evaluateTranslationProvenanceShape({ de: entry({ checkedOn: "22/08/2026" }) })),
      ["malformed_date"],
    );
  });

  it("refuses a note too short to have said which checksum moved", () => {
    // Eight words rather than the five its neighbour asks for, and the reason is
    // in the module: a word count moves for one reason and a checksum moves for
    // two, so this note has more to carry.
    assert.ok(TRANSLATION_NOTE_MIN_WORDS > 5);
    assert.deepEqual(
      codesOf(evaluateTranslationProvenanceShape({ de: entry({ note: "updated" }) })),
      ["note_too_short"],
    );
    assert.deepEqual(
      evaluateTranslationProvenanceShape({
        de: entry({ note: "Re-translated after the retention window changed in the English section." }),
      }),
      [],
    );
  });
});

describe("the drift half", () => {
  const previous = { de: entry() };

  it("says nothing when neither checksum moved", () => {
    // A note or a date clarified on its own is a good thing to do and needs no
    // permission.
    assert.deepEqual(
      evaluateTranslationProvenanceDrift(
        previous,
        { de: entry({ note: "Clarified which section this page carries, no re-translation." }) },
        [],
      ),
      [],
    );
  });

  it("demands the file behind whichever checksum moved", () => {
    // The useful half of the message: sourceChecksum describes PRIVACY.md and
    // translatedChecksum describes this language's own page, so the name in the
    // failure is the file somebody has to look at.
    const movedPage = evaluateTranslationProvenanceDrift(
      previous,
      { de: entry({ translatedChecksum: "aaaaaaaaaaaaaaaa", checkedOn: "2026-08-23", note: "Re-translated the retention sentence after the English one moved." }) },
      [],
    );
    assert.deepEqual(codesOf(movedPage), ["policy_unchanged"]);
    assert.match(movedPage[0].detail ?? "", /PRIVACY\.md\.de/);
    assert.deepEqual(
      evaluateTranslationProvenanceDrift(
        previous,
        { de: entry({ translatedChecksum: "aaaaaaaaaaaaaaaa", checkedOn: "2026-08-23", note: "Re-translated the retention sentence after the English one moved." }) },
        ["PRIVACY.md.de"],
      ),
      [],
    );
    const movedSource = evaluateTranslationProvenanceDrift(
      previous,
      { de: entry({ sourceChecksum: "aaaaaaaaaaaaaaaa", checkedOn: "2026-08-23", note: "Confirmed against the amended English section; no wording change reached the German." }) },
      ["PRIVACY.md.de"],
    );
    assert.deepEqual(codesOf(movedSource), ["policy_unchanged"]);
    assert.match(movedSource[0].detail ?? "", /PRIVACY\.md /);
  });

  it("refuses a checksum that moved with its provenance standing still", () => {
    // The paste. This is the whole reason the table has a note column.
    const failures = evaluateTranslationProvenanceDrift(
      previous,
      { de: entry({ sourceChecksum: "aaaaaaaaaaaaaaaa" }) },
      ["PRIVACY.md"],
    );
    assert.deepEqual(codesOf(failures), ["provenance_unchanged"]);
  });

  it("reports one cause once", () => {
    // With neither the note nor the date touched there is nothing for the date
    // check to read, and repeating the same cause is how a one-line fix reads as
    // two problems.
    const failures = evaluateTranslationProvenanceDrift(
      previous,
      { de: entry({ sourceChecksum: "aaaaaaaaaaaaaaaa", checkedOn: "2020-01-01" }) },
      ["PRIVACY.md"],
    );
    assert.deepEqual(codesOf(failures), ["provenance_date_regressed"]);
  });

  it("refuses a confirmation dated before the one it replaces", () => {
    const failures = evaluateTranslationProvenanceDrift(
      previous,
      { de: entry({ sourceChecksum: "aaaaaaaaaaaaaaaa", checkedOn: "2026-01-01", note: "Re-confirmed against the amended English section after the retention change." }) },
      ["PRIVACY.md"],
    );
    assert.deepEqual(codesOf(failures), ["provenance_date_regressed"]);
  });

  it("says nothing about a language that did not exist at the base revision", () => {
    // A new page has no prior value to have moved away from, and the shape half
    // has already asked whether its note and date are real.
    assert.deepEqual(evaluateTranslationProvenanceDrift({}, { de: entry() }, []), []);
  });
});

describe("the combined result", () => {
  it("skips the drift half rather than failing when no previous table is readable", () => {
    const result = evaluateTranslationProvenance({
      current: { de: entry() },
      previous: null,
      baseRef: null,
      changedFiles: [],
    });
    assert.equal(result.ok, true);
    assert.equal(result.comparedAgainst, null);
    assert.match(
      formatTranslationProvenanceReport("guard", result),
      /only the shape half ran/,
    );
  });

  it("refuses to call an empty table a pass", () => {
    // A guard that reports a pass because it had nothing to check is the vacuous
    // green every premise case in this repo exists to stamp out.
    const result = evaluateTranslationProvenance({
      current: {},
      previous: null,
      baseRef: null,
      changedFiles: [],
    });
    assert.equal(result.ok, false);
    assert.match(formatTranslationProvenanceReport("guard", result), /is empty/);
  });

  it("names the base revision on the pass line", () => {
    const result = evaluateTranslationProvenance({
      current: { de: entry() },
      previous: { de: entry() },
      baseRef: "abc1234",
      changedFiles: [],
    });
    assert.equal(result.ok, true);
    assert.match(formatTranslationProvenanceReport("guard", result), /compared against abc1234/);
  });
});
