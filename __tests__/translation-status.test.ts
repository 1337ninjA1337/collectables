import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  TRANSLATION_BASE_LANGUAGE,
  coveragePercent,
  translationCoverage,
} from "@/lib/i18n-coverage";
import { languageOptionCodes } from "@/lib/i18n-source";
import {
  PARTIALLY_TRANSLATED_LANGUAGES,
  TRANSLATION_COMPLETE_PERCENT,
  isPartiallyTranslated,
} from "@/lib/translation-status";
import { readI18nSource } from "./helpers/i18n-source-file";
import { sourceCode, sourceFiles } from "./helpers/source-files";

/**
 * The measurement, and the list the picker acts on.
 *
 * `i18n-translation-coverage.test.ts` publishes what each language declares and
 * floors it so a locale cannot silently lose translations. That number has been
 * a report and nothing more: the settings picker offered `Deutsch` (39%) in the
 * same chip, weight and order as `Русский` (99%). `lib/translation-status.ts`
 * is the verdict the picker can import — `lib/i18n-coverage.ts` PARSES the
 * source of `lib/i18n-context.tsx`, which is a thing a test does and an app
 * cannot — and a committed list is a list that drifts unless something derives
 * the same answer independently.
 *
 * So this derives it: the partial set computed from the real coverage rows must
 * equal the one shipped to the picker. The classification is the committed
 * thing rather than the percentages, and that is the same argument
 * `TRANSLATION_FLOORS` makes — committing "de is at 38.8%" goes red on every
 * feature PR that adds an English string, because the denominator moves and
 * every row falls. A NAME crossing a fifty-point gap is the event worth
 * failing over, in both directions: a locale finished and still badged, and one
 * that collapsed into the partial set with nothing said.
 */

const SOURCE = readI18nSource();
const COVERAGE = translationCoverage(SOURCE);

/** The partial set as the measurement actually computes it. */
const measuredPartial = COVERAGE.filter(
  (row) => coveragePercent(row) < TRANSLATION_COMPLETE_PERCENT,
).map((row) => row.language);

describe("the partial-translation list the picker acts on", () => {
  it("equals the set derived from the real coverage measurement", () => {
    // The premise before the claim: a measurement that produced no rows, or one
    // row, would make the equality below true for reasons that have nothing to
    // do with translations.
    assert.ok(
      COVERAGE.length >= 6,
      `only ${String(COVERAGE.length)} coverage row(s) — this comparison proves nothing`,
    );
    assert.deepEqual(
      [...PARTIALLY_TRANSLATED_LANGUAGES].sort(),
      [...measuredPartial].sort(),
      `the picker's partial list has drifted from the measurement:\n  ` +
        COVERAGE.map(
          (row) => `${row.language}: ${coveragePercent(row).toFixed(1)}%`,
        ).join("\n  "),
    );
  });

  it("leaves the base language and the maintained locale unqualified", () => {
    // The two the badge must never appear on, named rather than inferred: the
    // base map is 100% by definition, and a badge on a 99%-translated locale
    // would train every reader to ignore the badge on the 39% ones.
    assert.equal(isPartiallyTranslated(TRANSLATION_BASE_LANGUAGE), false);
    assert.equal(isPartiallyTranslated("ru"), false);
    const ru = COVERAGE.find((row) => row.language === "ru");
    assert.ok(ru, "no `ru` coverage row — the assertion above rests on nothing");
    assert.ok(
      coveragePercent(ru) >= TRANSLATION_COMPLETE_PERCENT,
      `ru measures ${coveragePercent(ru).toFixed(1)}%, below the threshold it is asserted to clear`,
    );
  });

  it("names only languages the picker actually offers", () => {
    // A badge on a code no chip renders is invisible, and a code that left the
    // picker taking its entry with it is how a list rots. Read from the
    // picker's own rows rather than from a second copy of them.
    const offered = languageOptionCodes(SOURCE);
    assert.ok(offered.length >= 6, "the picker parsed to too few rows to check against");
    for (const code of PARTIALLY_TRANSLATED_LANGUAGES) {
      assert.ok(
        offered.includes(code),
        `\`${code}\` is badged as partial and is not one of the picker's languages: ${offered.join(", ")}`,
      );
    }
  });

  it("leaves every locale further from the threshold than one PR's drift", () => {
    // This case used to demand a twenty-point GAP between the highest partial
    // locale and the lowest complete one, and it was right for as long as the
    // four partials were parked near 40% — the two groups were fifty points
    // apart and no run of work came near the boundary.
    //
    // The translation work closed that gap on purpose. `be` reached 84.9% on
    // 2026-08-22, so a between-groups gap now measures the PROGRESS rather than
    // the safety of the threshold, and it can only be restored by stopping the
    // work. A guard whose green depends on nobody finishing anything is not
    // guarding the thing it was written for.
    //
    // What it WAS written for survives intact and is per row: no locale may sit
    // so close to the threshold that ordinary churn reclassifies it. The unit
    // is the same one the old case reasoned in — a feature PR adds English
    // strings, the denominator grows, and every row that has not translated
    // them falls. At ~500 translatable keys a point is ~5 keys, so a ten-string
    // feature drops each partial row about two points. Four points is two such
    // PRs, and the smallest margin a single one cannot cross.
    //
    // ONE-SIDED, and the first version of this case (pushed earlier the same
    // day) had it symmetric, which was wrong. Churn only ever moves a row DOWN:
    // adding English keys cannot raise anybody's percentage. So a locale BELOW
    // the threshold is in no danger from it — `be` at 87.6% can only cross by
    // somebody translating twelve more keys, which is deliberate, and the
    // parity case above is what catches it, red, on the run that does it. The
    // reclassification churn can cause is the other one: a complete locale
    // falling under the threshold and getting badged by a feature PR nobody
    // thought was about translations. That is what this measures, and `ru` and
    // `en` at 100% are ten points clear of it.
    //
    // The symmetric version fired within a day of being written, on `be` at
    // 87.6%, for a crossing that cannot happen by accident. A guard that fires
    // on the safe direction teaches its reader to widen the margin, which is
    // the one repair that would have made it useless.
    const MARGIN_POINTS = 4;
    assert.ok(
      COVERAGE.length >= 6,
      `only ${String(COVERAGE.length)} coverage row(s) — this case would pass vacuously`,
    );
    const complete = COVERAGE.filter(
      (row) => coveragePercent(row) >= TRANSLATION_COMPLETE_PERCENT,
    );
    assert.ok(
      complete.length > 0,
      "no locale clears the threshold — this case would pass with nothing to check",
    );
    const crowded = complete.filter(
      (row) => coveragePercent(row) - TRANSLATION_COMPLETE_PERCENT < MARGIN_POINTS,
    );
    assert.deepEqual(
      crowded.map((row) => `${row.language} ${coveragePercent(row).toFixed(1)}%`),
      [],
      `these locales clear the ${TRANSLATION_COMPLETE_PERCENT}% threshold by less than ${MARGIN_POINTS} points, ` +
        `so one feature PR's worth of new English keys would badge them:\n  ` +
        COVERAGE.map((row) => `${row.language}: ${coveragePercent(row).toFixed(1)}%`).join("\n  "),
    );
  });

  it("would still name a locale that fell short, now that none does", () => {
    // The parity case above compares two empty lists as of 2026-08-22, and an
    // empty list equals an empty list for two very different reasons: nothing
    // measured below the threshold, or the measurement stopped working. Until
    // today one of those was ruled out by there being four names in it.
    //
    // So the derivation gets its own case, on a source this file writes. Four
    // keys, a locale declaring one of them: 25%, which is below any threshold
    // this module would ever hold. If the rule that produces `measuredPartial`
    // broke — a comparison inverted, a percentage that came back NaN, a filter
    // over the wrong field — this goes red while the parity case stays green.
    //
    // Deliberately not asserting `PARTIALLY_TRANSLATED_LANGUAGES` against this
    // fixture: the shipped list is about the real map, and a case that fed it
    // a fabricated one would be asserting the fixture.
    const source = [
      `const en = {`,
      `  first: "one",`,
      `  second: "two",`,
      `  third: "three",`,
      `  fourth: "four",`,
      `} as const;`,
      ``,
      `const xx: TranslationMap = {`,
      `  ...en,`,
      `  first: "uno",`,
      `};`,
      ``,
    ].join("\n");
    const rows = translationCoverage(source, ["en", "xx"]);
    assert.deepEqual(
      rows.filter((row) => coveragePercent(row) < TRANSLATION_COMPLETE_PERCENT).map((row) => row.language),
      ["xx"],
      "a locale declaring one key of four does not come out below the threshold — the derivation behind the parity case is broken",
    );
    assert.equal(coveragePercent(rows[1]), 25);
  });

  it("still has a caller, which is the half an empty list stops proving", () => {
    // What an empty list actually costs: the badge is now unreachable at
    // runtime, so every case in this file passes with the picker's branch
    // deleted, and "nothing renders this" is the argument that deletes it. The
    // seventh language arrives at 0% on the day somebody adds a chip, and the
    // badge is what the picker owes that reader on that day.
    //
    // Structural rather than rendered, for the reason every screen suite here
    // is: `app/settings.tsx` pulls React Native peers. Two claims — the screen
    // asks for the verdict, and it renders the string the verdict is for.
    const settings = sourceCode("app/settings.tsx");
    assert.match(
      settings,
      /isPartiallyTranslated\(/,
      "app/settings.tsx no longer asks whether a language is partially translated — the picker has stopped qualifying anything, in every future language too",
    );
    assert.match(
      settings,
      /t\("languagePartial"\)/,
      "app/settings.tsx no longer renders the partial badge — the verdict is computed and thrown away",
    );
  });

  it("says nothing about a language nobody measured", () => {
    // An unknown code answers false rather than throwing: the picker calls this
    // per row while rendering, and a language added there without a measurement
    // is caught by the parity case above, not by a crash in settings.
    assert.equal(isPartiallyTranslated("fr"), false);
    assert.equal(isPartiallyTranslated(""), false);
  });
});

/**
 * The picker's verdict is bundled; the measurement behind it is not.
 *
 * `app/settings.tsx` calls `isPartiallyTranslated` once per language chip, so
 * `lib/translation-status.ts` ships to the browser. `lib/i18n-coverage.ts`
 * computes the same classification properly — by parsing the source of
 * `lib/i18n-context.tsx` through `lib/i18n-source.ts` — and ships nowhere,
 * which is the whole reason the verdict was copied into a second module rather
 * than imported from the first.
 *
 * That arrangement became a real edge on 2026-08-22, when `lib/i18n-coverage.ts`
 * started importing the picker's list so `localeListingState` could compare the
 * two. Safe in that direction and only that direction, and until this block the
 * only thing saying so was a comment at the import. The failure it guards
 * against is quiet: the reverse import compiles, every suite stays green, and
 * what changes is the size of a file nobody was looking at. `bundle-size` would
 * eventually notice, as a number rather than as a name, on whichever unrelated
 * PR pushed it over.
 */
describe("the parser stays out of the bundle", () => {
  /** Every module specifier a file imports, requires, or dynamically imports. */
  const specifiersIn = (relative: string): readonly string[] => {
    const matches = sourceCode(relative).matchAll(
      /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)"([^"]+)"/g,
    );
    return [...matches].map((match) => match[1]);
  };

  it("lib/translation-status.ts imports nothing at all", () => {
    // The strongest form of the rule and the cheapest to read: a module with no
    // imports cannot reach the parser by any path, so this needs no import
    // graph and cannot be defeated by an intermediate module.
    //
    // It is deliberately stricter than the danger. If this module ever does
    // need an import, the question the failure should provoke is not "which
    // import is banned" but "what does the settings screen now pay to render a
    // badge" — and a case that listed banned specifiers would answer neither.
    assert.deepEqual(
      [...specifiersIn("lib/translation-status.ts")],
      [],
      "lib/translation-status.ts has grown an import, and app/settings.tsx pays for whatever it pulls in.\n" +
        "  It exists as a separate module from lib/i18n-coverage.ts precisely so the picker can have the verdict without the parser.",
    );
  });

  /**
   * Modules that may import the parser, and why each one is not in the bundle.
   *
   * Named rather than counted: the rule is "nothing the app loads reaches this",
   * and a count would be satisfied by swapping a test-side importer for an
   * app-side one.
   */
  const MAY_IMPORT_THE_PARSER: Readonly<Record<string, string>> = {
    "lib/i18n-coverage.ts":
      "the arithmetic over what the parser found — Node-pure, read by the suites and by nothing the app imports",
    "lib/check-orphan-i18n-keys.ts":
      "the orphan-key lint guard's module, run by tsx from scripts/check-orphan-i18n-keys.ts",
  };

  it("is imported only by modules the app never loads", () => {
    const parser = /(?:^|\/)i18n-(?:source|coverage)$/;
    const files = sourceFiles();
    assert.ok(
      files.length >= 100,
      `the source walk found only ${String(files.length)} file(s) — this sweep would pass vacuously`,
    );
    const importers = files.filter((relative) =>
      specifiersIn(relative).some((specifier) => parser.test(specifier)),
    );
    assert.deepEqual(
      importers.filter((relative) => !(relative in MAY_IMPORT_THE_PARSER)),
      [],
      "these files import the i18n parser and are not on the test-side list:\n  " +
        importers.join("\n  ") +
        "\n  If one of them is reachable from app/ or components/, the parser and lib/js-tokens.ts are now in the web bundle.\n" +
        "  If it is genuinely test-side, add it to MAY_IMPORT_THE_PARSER with the reason it never loads.",
    );
  });

  it("names only importers that still exist", () => {
    // The other direction, and the reason an allow-list rots: an entry naming a
    // module that no longer imports the parser permits nothing and looks exactly
    // like one that does.
    const parser = /(?:^|\/)i18n-(?:source|coverage)$/;
    const stale = Object.keys(MAY_IMPORT_THE_PARSER).filter(
      (relative) => !specifiersIn(relative).some((specifier) => parser.test(specifier)),
    );
    assert.deepEqual(
      stale,
      [],
      `MAY_IMPORT_THE_PARSER names ${stale.join(", ")}, which no longer imports the parser — remove the entry rather than leaving a permission nobody uses`,
    );
  });

  it("reads the specifiers it claims to", () => {
    // The sweep above is only as good as this regex, and its green run is a
    // report of "no file matched" either way. Both non-import spellings are the
    // ones a module actually uses to defer a heavy dependency.
    assert.deepEqual(
      [...sourceCode("lib/i18n-coverage.ts").matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)"([^"]+)"/g)]
        .map((match) => match[1])
        .filter((specifier) => /i18n-source/.test(specifier)),
      ["./i18n-source"],
      "the specifier regex no longer finds the one static import this suite knows about",
    );
    const specifiers = (code: string) =>
      [...code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)"([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(specifiers(`const m = await import("./i18n-source");`), ["./i18n-source"]);
    assert.deepEqual(specifiers(`const m = require("./i18n-source");`), ["./i18n-source"]);
    assert.deepEqual(specifiers(`const label = "./i18n-source";`), []);
  });
});
