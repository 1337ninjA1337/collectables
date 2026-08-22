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
    // strings, the denominator grows, and every partial row falls. At ~500
    // translatable keys a point is ~5 keys, so a ten-string feature drops each
    // partial row about two points. Four points is two such PRs, and it is the
    // smallest margin that cannot be crossed by a single one.
    //
    // This is a tripwire and is MEANT to fire: `be` is 5.1 points clear today,
    // which is roughly one more screen family. When it goes red, the answer is
    // to decide what the Belarusian badge should say — not to widen the margin.
    const MARGIN_POINTS = 4;
    assert.ok(
      COVERAGE.length >= 6,
      `only ${String(COVERAGE.length)} coverage row(s) — this case would pass vacuously`,
    );
    const crowded = COVERAGE.filter(
      (row) => Math.abs(coveragePercent(row) - TRANSLATION_COMPLETE_PERCENT) < MARGIN_POINTS,
    );
    assert.deepEqual(
      crowded.map((row) => `${row.language} ${coveragePercent(row).toFixed(1)}%`),
      [],
      `these locales are within ${MARGIN_POINTS} points of the ${TRANSLATION_COMPLETE_PERCENT}% threshold, ` +
        `so one feature PR's worth of new English keys would reclassify them:\n  ` +
        COVERAGE.map((row) => `${row.language}: ${coveragePercent(row).toFixed(1)}%`).join("\n  "),
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
