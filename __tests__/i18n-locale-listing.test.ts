import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  COMPLETE_LANGUAGES,
  type LocaleListingState,
  coveragePercent,
  formatCoverageRow,
  localeListingState,
  translationCoverage,
} from "@/lib/i18n-coverage";
import { languageOptionCodes } from "@/lib/i18n-source";
import {
  PARTIALLY_TRANSLATED_LANGUAGES,
  TRANSLATION_COMPLETE_PERCENT,
} from "@/lib/translation-status";
import { readI18nSource } from "./helpers/i18n-source-file";

/**
 * Two lists over the same six names, and until now neither knew the other
 * existed.
 *
 * `COMPLETE_LANGUAGES` says "finished, may not slip" and is read by a ceiling
 * on inherited keys. `PARTIALLY_TRANSLATED_LANGUAGES` says "unfinished, badge
 * it" and is read by the settings picker. They were written by different runs,
 * for different readers, in different modules, and today they partition the
 * picker exactly: six complete, none partial, none in between.
 *
 * Each is already derived against the measurement by a case of its own —
 * `i18n-locale-completeness.test.ts` for the first, `translation-status.test.ts`
 * for the second — so the question this file has to answer is what a third rule
 * buys.
 *
 * It buys the pair. Both existing derivations run through `translationCoverage`,
 * which means both are claims about what the parser found in
 * `lib/i18n-context.tsx`, and neither says a word about the other list. A name
 * appearing in BOTH is not a locale in a strange state: it is two rules
 * asserting opposite things about the same six letters, and it is refusable
 * without measuring anything. That case here runs before the parse.
 *
 * And it buys a name for the third state. A locale in NEITHER list reads as an
 * oversight, and usually is — a finished locale nobody promoted, or a collapsed
 * one nobody badged — but it is also precisely where a seventh language sits
 * after the work that carries it over 90% and before the work that finishes it.
 * So `unlisted` is legal, and what this file pins is the BAND each state
 * implies: complete means zero inherited, partial means under the threshold,
 * unlisted means over the threshold with keys still to go. Every locale lands in
 * exactly one, and the failure message names the list that needs the edit rather
 * than the number that moved.
 */

const SOURCE = readI18nSource();
const COVERAGE = translationCoverage(SOURCE);
const rowFor = (language: string) => COVERAGE.find((row) => row.language === language);

/** One line per locale: the state, the two lists, and the measurement behind it. */
const report = () =>
  COVERAGE.map((row) => {
    const state = localeListingState(row.language);
    return `${row.language}: ${state} — ${coveragePercent(row).toFixed(1)}%, ${row.inherited.length} inherited`;
  }).join("\n  ");

describe("the two locale lists, against each other and against the measurement", () => {
  it("measured enough of the map for the bands below to mean anything", () => {
    // Every band case reads `inherited` or a percentage derived from it, and a
    // parse that found nothing reports an empty worklist for every locale —
    // which is exactly what "complete" looks like from the outside.
    assert.ok(
      COVERAGE.length >= 6,
      `only ${String(COVERAGE.length)} coverage row(s) — the band cases below would prove nothing`,
    );
    for (const row of COVERAGE) {
      assert.ok(
        row.translatable >= 400,
        `'${row.language}' measured against only ${String(row.translatable)} translatable keys — the parse came up short`,
      );
    }
  });

  it("never claims a locale is both finished and unfinished", () => {
    // Structural, and deliberately not derived: this holds with the parser
    // deleted, because it is a claim about the two lists rather than about what
    // either of them got right. It is also the one state neither neighbouring
    // suite reports as itself — a name in both lists fails the completeness
    // ceiling AND the picker's parity case, and both failures read as "this
    // list drifted from the measurement" while the actual defect is that the
    // two lists disagree with each other.
    const both = [...COMPLETE_LANGUAGES].filter((language) =>
      PARTIALLY_TRANSLATED_LANGUAGES.includes(language),
    );
    assert.deepEqual(
      both,
      [],
      `${both.join(", ")} is listed as complete in lib/i18n-coverage.ts and badged as partially translated in lib/translation-status.ts.\n` +
        `  One of the two is wrong: either the locale finished and the badge outlived it, or it is unfinished and the ceiling is asserting something nothing checks.`,
    );
  });

  it("puts every language the picker offers into exactly one state", () => {
    // A code the picker renders and neither list has ever heard of is the way a
    // seventh language arrives, and `unlisted` is the honest answer for it — but
    // only if it was MEASURED, because an unmeasured code answers `unlisted`
    // too, for the opposite reason. Reading the picker's own rows rather than a
    // second copy of them is what tells the two apart.
    const offered = languageOptionCodes(SOURCE);
    assert.ok(offered.length >= 6, "the picker parsed to too few rows to check against");
    const unmeasured = offered.filter((code) => rowFor(code) === undefined);
    assert.deepEqual(
      unmeasured,
      [],
      `the picker offers ${unmeasured.join(", ")} and no coverage row was measured for it, so its state is 'unlisted' by absence rather than by decision`,
    );
    const states = new Map<LocaleListingState, string[]>();
    for (const code of offered) {
      const state = localeListingState(code);
      states.set(state, [...(states.get(state) ?? []), code]);
    }
    assert.equal(
      [...states.values()].reduce((total, codes) => total + codes.length, 0),
      offered.length,
      "a picker language was classified into more than one state, or into none",
    );
  });

  for (const row of COVERAGE) {
    it(`'${row.language}' measures inside the band its listing claims`, () => {
      const state = localeListingState(row.language);
      const percent = coveragePercent(row);
      const context = `\n  ${formatCoverageRow(row)}\n  ${report()}`;
      switch (state) {
        case "complete":
          // The ceiling next door asserts the same thing and this is not a
          // duplicate of it: that case iterates COMPLETE_LANGUAGES and this one
          // iterates the MEASUREMENT, so a locale that vanished from the map
          // fails here and passes there.
          assert.deepEqual(
            [...row.inherited],
            [],
            `'${row.language}' is listed complete and inherits ${String(row.inherited.length)} key(s) from English: ${row.inherited.join(", ")}.` +
              `\n  Translate them, or take the name out of COMPLETE_LANGUAGES — which is a reviewed admission the locale is no longer maintained.${context}`,
          );
          break;
        case "partial":
          assert.ok(
            percent < TRANSLATION_COMPLETE_PERCENT,
            `'${row.language}' is badged as partially translated and measures ${percent.toFixed(1)}%, at or above the ${String(TRANSLATION_COMPLETE_PERCENT)}% threshold the badge is for.${context}`,
          );
          break;
        case "unlisted":
          // The legal middle, and the only state with two ways to be wrong.
          assert.ok(
            percent >= TRANSLATION_COMPLETE_PERCENT,
            `'${row.language}' measures ${percent.toFixed(1)}%, under the ${String(TRANSLATION_COMPLETE_PERCENT)}% threshold, and no list claims it — add it to PARTIALLY_TRANSLATED_LANGUAGES so the picker qualifies it.${context}`,
          );
          assert.ok(
            row.inherited.length > 0,
            `'${row.language}' declares every translatable key and is in neither list — add it to COMPLETE_LANGUAGES, which is what stops it drifting back.${context}`,
          );
          break;
        case "contradictory":
          assert.fail(
            `'${row.language}' is in both lists — see the structural case above.${context}`,
          );
      }
    });
  }

  it("reports all four states, three of which the shipped lists cannot reach", () => {
    // Today every locale is `complete`, so the switch above exercises one branch
    // and describes three. The classifier takes its lists as an argument for
    // exactly this reason, the same way `translationCoverage` takes its source:
    // a fabricated pair is the only way to see `partial`, `unlisted` and
    // `contradictory` come back at all.
    //
    // Deliberately NOT asserting either shipped list against this fixture — the
    // real lists are claims about the real map, and a case that fed them a made
    // up one would be asserting the fixture.
    const lists = { complete: ["ru", "xx"], partial: ["xx", "yy"] };
    assert.equal(localeListingState("ru", lists), "complete");
    assert.equal(localeListingState("yy", lists), "partial");
    assert.equal(localeListingState("xx", lists), "contradictory");
    assert.equal(localeListingState("zz", lists), "unlisted");
  });

  it("defaults to the lists the app and the ceiling actually read", () => {
    // The argument above is what makes the fixture case possible and it is also
    // how this function could quietly stop describing anything: a default that
    // drifted from the two real lists would leave every case green while
    // classifying a pair nobody ships.
    for (const language of COMPLETE_LANGUAGES) {
      assert.equal(
        localeListingState(language),
        localeListingState(language, {
          complete: COMPLETE_LANGUAGES,
          partial: PARTIALLY_TRANSLATED_LANGUAGES,
        }),
        `'${language}' classifies differently with the real lists passed explicitly — the default has drifted from them`,
      );
    }
    assert.equal(localeListingState("fr"), "unlisted");
  });
});
