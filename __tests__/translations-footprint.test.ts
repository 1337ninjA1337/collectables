import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { stripComments } from "@/lib/strip-comments";
import {
  formatCopyDriftLine,
  LAST_MEASURED_TRANSLATIONS_BYTES,
  translationsFootprint,
} from "@/lib/translations-footprint";

import { readI18nSource } from "./helpers/i18n-source-file";
import { readRepoFile } from "./helpers/repo-file";

/**
 * How much of the app is sentences.
 *
 * `lib/bundle-size.ts` prints how far a build has drifted since the budget
 * last moved, and its doc block asked for that number split between code and
 * copy — because four raises in three days turned on exactly that distinction
 * and nobody could state it. One round cost 17.9 KiB with four counted strings
 * in six languages in it; the next cost 0.2 KiB with none.
 *
 * **The measure is a proxy and the report says so.** It reads the SOURCE bytes
 * of `lib/i18n-context.tsx`, which is not that module's share of the minified
 * bundle — the bundler renames locals, strips types and drops comments. What
 * survives almost untouched is the string literals, so the DELTA between two
 * measurements tracks what the bundle sees far better than either absolute
 * number does. The cases below pin that framing as hard as the arithmetic,
 * because a number presented as a share is one somebody eventually subtracts.
 */

/** A translations file in miniature — two locales, four declarations. */
const TWO_LOCALES = `
const languageOptions: { code: AppLanguage; label: string }[] = [
  { code: "en", label: "English" },
  { code: "ru", label: "Русский" },
];

const en = {
  greeting: "Hello",
  farewell: "Bye",
};

const ru: TranslationMap = {
  ...en,
  greeting: "Привет",
  farewell: "Пока",
};
`;

describe("translationsFootprint", () => {
  it("counts the locales the picker offers", () => {
    assert.equal(translationsFootprint(TWO_LOCALES).locales, 2);
  });

  it("counts the base map's keys", () => {
    assert.equal(translationsFootprint(TWO_LOCALES).baseKeys, 2);
  });

  it("counts DECLARATIONS, which is what costs bytes", () => {
    // A key translated into six languages is six strings in the bundle and a
    // key only `en` declares is one, so a round adding four keys everywhere
    // spends roughly six times what an English-only round does — invisible in
    // `baseKeys` and the whole reason this field exists.
    assert.equal(translationsFootprint(TWO_LOCALES).declarations, 4);
  });

  it("separates the two counts when a locale inherits", () => {
    const partial = TWO_LOCALES.replace('  greeting: "Привет",\n', "");
    const footprint = translationsFootprint(partial);

    assert.equal(footprint.baseKeys, 2, "the vocabulary is unchanged");
    assert.equal(footprint.declarations, 3, "one fewer string actually ships");
  });

  it("measures UTF-8 bytes, not characters", () => {
    // Every locale but `en` is non-Latin or accented, so a character count
    // would under-report the four languages that cost the most.
    const cyrillic = translationsFootprint(TWO_LOCALES);
    assert.ok(cyrillic.sourceBytes > TWO_LOCALES.length, "counted characters, not bytes");
  });

  it("reads the real translations module", () => {
    const footprint = translationsFootprint(readI18nSource());

    assert.equal(footprint.locales, 6);
    assert.ok(footprint.baseKeys > 500);
    // Six locales' worth: the declarations must exceed the vocabulary by a
    // wide margin or the parse has gone wrong rather than the file.
    assert.ok(footprint.declarations > footprint.baseKeys * 4);
    assert.ok(footprint.sourceBytes > 100_000);
  });
});

describe("formatCopyDriftLine", () => {
  const lineFor = (bytes: number) =>
    formatCopyDriftLine(
      { sourceBytes: bytes, locales: 6, baseKeys: 538, declarations: 3214 },
      238_763,
    );

  it("says nothing when the copy has not moved", () => {
    // A build that added no sentences should not print a line about
    // sentences: the drift line above it already says the growth was code.
    assert.equal(lineFor(238_763), null);
  });

  it("signs growth and names what it is measuring", () => {
    const line = lineFor(238_763 + Math.round(6.2 * 1024));

    assert.match(line ?? "", /\+6\.2 KiB of that is translated copy/);
    assert.match(line ?? "", /538 keys × 6 locales, 3214 declarations/);
  });

  it("signs a shrink with a minus", () => {
    // Two dead key families were deleted this week; a measure that could only
    // grow would report those rounds as having changed nothing.
    assert.match(lineFor(238_763 - 2048) ?? "", /-2\.0 KiB of that is translated copy/);
  });

  it("calls itself a proxy rather than a share of the bundle", () => {
    // The line sits directly under a figure in bundle KiB. Without this the
    // obvious reading is that the copy number is part of that total, and the
    // obvious next step is to subtract it.
    const line = lineFor(238_763 + 4096) ?? "";
    assert.match(line, /source bytes/);
    assert.match(line, /a proxy for growth rather than a share of the bundle/);
  });

  it("defaults to the recorded measurement", () => {
    // The one-argument form is what the script calls, so the default has to be
    // the same number the doc block records.
    const recorded = LAST_MEASURED_TRANSLATIONS_BYTES;
    assert.notEqual(recorded, null, "the head of the history carries no copy figure");
    const footprint = { sourceBytes: recorded ?? 0, locales: 6, baseKeys: 1, declarations: 1 };
    assert.equal(formatCopyDriftLine(footprint), null);
  });
});

describe("the measurement and the bundle's move together", () => {
  it("the head of the history carries a copy figure at all", () => {
    // The three rows that predate this measure carry `null`, which is honest;
    // the HEAD must not, or every build prints no copy line and the measure
    // is silently off.
    assert.notEqual(LAST_MEASURED_TRANSLATIONS_BYTES, null);
  });

  it("says nothing when the baseline is unknown", () => {
    // Subtracting from zero would report the whole translations module as
    // this round's growth.
    assert.equal(
      formatCopyDriftLine({ sourceBytes: 1, locales: 6, baseKeys: 1, declarations: 1 }, null),
      null,
    );
  });

  it("the recorded copy figure matches the module as it stands", () => {
    // The two measurements are taken in the same breath and move only when
    // the budget moves. A drift of zero here on a commit that did not touch
    // the translations is what says the pair is still in step; any nonzero
    // value is real growth to be argued in the next raise, which is the whole
    // point — so this case asserts the CONSTANT is a plausible measurement of
    // this file rather than that it is exact.
    const footprint = translationsFootprint(readI18nSource());
    const drift = Math.abs(footprint.sourceBytes - (LAST_MEASURED_TRANSLATIONS_BYTES ?? 0));

    assert.ok(
      drift < 30 * 1024,
      `the recorded copy measurement is ${String(Math.round(drift / 1024))} KiB out — re-measure it with the budget rather than letting the two drift apart`,
    );
  });

  it("the script reads the source rather than dist/", () => {
    // Not a preference: the bundle is one minified blob and no chunk boundary
    // separates the string table from the screens that read it, so there is
    // no honest way to take this number out of `dist/`.
    const SRC = stripComments(readRepoFile("scripts/check-bundle-size.ts"));
    assert.match(SRC, /const I18N_SOURCE = "lib\/i18n-context\.tsx";/);
    assert.match(SRC, /formatCopyDriftLine\(\s*translationsFootprint\(fs\.readFileSync\(path\.join\(REPO_ROOT, I18N_SOURCE\), "utf8"\)\),\s*\)/);
  });

  it("the copy line prints after the budget verdict and before the exit", () => {
    // A line printed after `process.exit(1)` is a line nobody reads on the
    // build that most needs it.
    const SRC = stripComments(readRepoFile("scripts/check-bundle-size.ts"));
    const verdict = SRC.indexOf("formatBundleSizeReport(files, result)");
    const copy = SRC.indexOf("if (copyLine) console.log(copyLine);");
    // The exit condition grew a second half when the lazy-split guard landed,
    // and this case is about ORDER rather than about what fails the build — so
    // it looks for the exit itself, not for a spelling of the predicate that
    // goes stale the next time the gate learns something.
    const exit = SRC.indexOf("process.exit(1);");
    assert.ok(verdict > 0 && copy > verdict, "the copy line must follow the verdict");
    assert.ok(exit > copy, "the copy line must print before the process exits");
  });

  it("the module never reaches for the filesystem itself", () => {
    // Pure, like `lib/bundle-size.ts` and `lib/i18n-coverage.ts`: it takes
    // source text somebody else read, so its suite can hand it a fixture.
    const SRC = readRepoFile("lib/translations-footprint.ts");
    assert.ok(!SRC.includes("node:fs"));
    assert.ok(!SRC.includes("readFileSync"));
  });
});
