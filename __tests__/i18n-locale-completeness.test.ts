import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  COMPLETE_LANGUAGES,
  TRANSLATION_LANGUAGES,
  coveragePercent,
  formatCoverageRow,
  translationCoverage,
} from "@/lib/i18n-coverage";
import { readI18nSource } from "./helpers/i18n-source-file";

/**
 * A finished locale stays finished.
 *
 * Every measurement in this repository reports a STATE: `be` declares 498 of
 * 498, `de` is at 100%, this family is complete in six locales. Fifteen runs of
 * translation work moved those numbers from ~40% to 100%, and not one of them
 * left behind anything that would notice the numbers moving back. The floors
 * next door come closest and they are floors on the DECLARED count, which is a
 * different claim: a locale can keep every declaration it has and still fall
 * behind, because the base map grows and `...en` silently serves the new key in
 * English. That is how the gap got to 300 keys the first time.
 *
 * So this is the ceiling `TRANSLATION_FLOORS` argues against, applied only
 * where the argument has stopped holding. Its reasoning is worth quoting rather
 * than paraphrasing: "a new English string ships before its five translations —
 * that is the ordinary way a feature lands here — so a ceiling on `inherited`
 * would go red on every feature PR and be deleted within a week." True, and
 * written when four locales were two hundred keys behind: the ceiling would
 * have demanded that whoever added one English string first close somebody
 * else's two-hundred-key backlog.
 *
 * At zero behind, the same rule costs six values on the PR that adds the key,
 * written by the person who just decided what the English one means. That is
 * the cheapest moment those six will ever be written, and the only moment
 * anybody knows the context. The trade is real and it is small, which is the
 * whole difference.
 *
 * NOT "every language in the picker", and the distinction is the escape hatch.
 * `COMPLETE_LANGUAGES` is a list, so a seventh locale can be added to the
 * picker at 0% and worked on — badged by `PARTIALLY_TRANSLATED_LANGUAGES` while
 * it is — and joins this list on the run that finishes it. A rule phrased over
 * all languages would make adding a language a 498-value PR, which is how a
 * language does not get added.
 */

const source = readI18nSource();
const coverage = translationCoverage(source);
const rowFor = (language: string) => {
  const row = coverage.find((entry) => entry.language === language);
  assert.ok(row, `no coverage row for '${language}'`);
  return row;
};

describe("locales that finished stay finished", () => {
  it("measured enough of the map for the cases below to mean anything", () => {
    // Every case here reads `inherited`, and a parse that found no keys reports
    // an empty worklist for every locale — which is exactly what "finished"
    // looks like from the outside.
    assert.ok(coverage.length >= 6, `only ${coverage.length} coverage row(s)`);
    for (const row of coverage) {
      assert.ok(
        row.translatable >= 400,
        `'${row.language}' measured against only ${row.translatable} translatable keys — the parse came up short and every claim below is vacuous`,
      );
    }
  });

  it("names only languages this repository has", () => {
    const unknown = COMPLETE_LANGUAGES.filter((language) => !TRANSLATION_LANGUAGES.includes(language));
    assert.deepEqual(unknown, [], `COMPLETE_LANGUAGES names ${unknown.join(", ")}, which the picker does not have`);
    assert.ok(COMPLETE_LANGUAGES.length > 0, "no language is listed as complete — every case below would pass with nothing to check");
  });

  for (const language of COMPLETE_LANGUAGES) {
    it(`'${language}' still translates every translatable key`, () => {
      const row = rowFor(language);
      assert.deepEqual(
        [...row.inherited],
        [],
        `'${language}' is listed as complete and now inherits ${row.inherited.length} key(s) from English: ${row.inherited.join(", ")}.\n` +
          `  Translate them in the PR that added them — six values written by whoever decided what the English one means is the cheapest they will ever be, and the only moment anybody knows the context.\n` +
          `  If this locale is genuinely no longer maintained, take its name out of COMPLETE_LANGUAGES, which is a decision somebody reviews rather than a number that drifted.\n` +
          `  ${formatCoverageRow(row)}`,
      );
    });
  }

  it("lists every language that has actually finished", () => {
    // The other direction, and the one that keeps the list from rotting. A
    // locale reaching 100% and not being listed is protected by nothing — which
    // is the exact state this rule exists to end, and it is also what the last
    // fifteen runs of work would have left behind if nobody wrote this case.
    // Derived from the measurement rather than asserted, so "these six" cannot
    // become a stale opinion about the map.
    const finished = coverage
      .filter((row) => row.inherited.length === 0)
      .map((row) => row.language);
    assert.deepEqual(
      [...finished].sort(),
      [...COMPLETE_LANGUAGES].sort(),
      `COMPLETE_LANGUAGES has drifted from the measurement:\n  ` +
        coverage.map((row) => `${row.language}: ${coveragePercent(row).toFixed(1)}% (${row.inherited.length} inherited)`).join("\n  "),
    );
  });

  it("leaves the floors doing something this rule does not", () => {
    // Worth stating, because the obvious reading is that a ceiling at zero
    // makes `TRANSLATION_FLOORS` redundant — every locale declares everything,
    // so what is a floor for?
    //
    // The two rules fail on different accidents. This one is relative: it
    // compares each locale against the base map, so a merge that deleted two
    // hundred keys from `en` AND from every locale satisfies it completely.
    // The floors are absolute numbers, so that merge is exactly what they
    // catch. Neither subsumes the other, and the case below is the premise that
    // makes the pairing worth keeping: the floors have to be within reach of
    // the real counts, not parked so low that the absolute claim is empty.
    for (const language of COMPLETE_LANGUAGES) {
      const row = rowFor(language);
      assert.ok(
        row.declared >= 400,
        `'${language}' declares ${row.declared} keys — well under the map, so the absolute half of this pairing is not saying much`,
      );
    }
  });
});
