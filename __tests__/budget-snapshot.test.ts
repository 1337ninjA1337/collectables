import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BUDGET_HISTORY, BUDGET_SNAPSHOT } from "@/lib/budget-snapshot";
import {
  DEFAULT_BUNDLE_SIZE_BUDGET_BYTES,
  formatBudgetTrendLine,
  LAST_MEASURED_BUNDLE_BYTES,
  SMALLEST_GUARDED_SDK_BYTES,
  BUDGET_REARGUE_FLOOR_BYTES,
} from "@/lib/bundle-size";
import { stripComments } from "@/lib/strip-comments";
import {
  LAST_MEASURED_TRANSLATIONS_BYTES,
  translationsFootprint,
} from "@/lib/translations-footprint";

import { readI18nSource } from "./helpers/i18n-source-file";
import { readRepoFile } from "./helpers/repo-file";

/**
 * The two numbers the budget is argued from, and the fact that they are one
 * thing.
 *
 * They shipped an hour apart into two modules: the bundle at the commit that
 * last moved the budget, and the translations module at that same commit. The
 * report subtracts one from today's bundle, the other from today's copy, and
 * prints the second as a share OF the first — so a raise that updated one and
 * forgot the other would report a copy delta measured against the wrong
 * baseline. Silently, with a plausible number, on the one output somebody
 * reads when deciding whether to raise again.
 *
 * A suite could only have caught that with a tolerance loose enough not to go
 * red on ordinary work, which is exactly the size of the error it needed to
 * catch. One object instead, so forgetting half is not expressible.
 */

describe("BUDGET_SNAPSHOT", () => {
  it("holds both halves and the date they were taken", () => {
    assert.equal(typeof BUDGET_SNAPSHOT.bundleBytes, "number");
    assert.equal(typeof BUDGET_SNAPSHOT.translationsBytes, "number");
    // A raise argues about a RATE — four moves in three days — and a rate
    // needs the date.
    assert.match(BUDGET_SNAPSHOT.takenOn, /^\d{4}-\d{2}-\d{2}$/);
  });

  it("is the single source both modules re-export", () => {
    assert.equal(LAST_MEASURED_BUNDLE_BYTES, BUDGET_SNAPSHOT.bundleBytes);
    assert.equal(LAST_MEASURED_TRANSLATIONS_BYTES, BUDGET_SNAPSHOT.translationsBytes);
  });

  it("neither module declares its own copy any more", () => {
    const BUNDLE = stripComments(readRepoFile("lib/bundle-size.ts"));
    const COPY = stripComments(readRepoFile("lib/translations-footprint.ts"));

    assert.match(BUNDLE, /export const LAST_MEASURED_BUNDLE_BYTES = BUDGET_SNAPSHOT\.bundleBytes;/);
    assert.match(
      COPY,
      /export const LAST_MEASURED_TRANSLATIONS_BYTES: number \| null =\s*BUDGET_SNAPSHOT\.translationsBytes;/,
    );
    assert.ok(!/Math\.round\(\d{4}\.\d \* 1024\)/.test(BUNDLE), "the bundle figure is declared here again");
    assert.ok(!/= \d{3}_\d{3};/.test(COPY), "the copy figure is declared here again");
  });

  it("imports nothing at all", () => {
    // `lib/translations-footprint.ts` reaches the i18n parser and
    // `lib/bundle-size.ts` must not, so a module both import has to be one
    // that cannot carry anything into either. The same argument
    // `lib/translation-status.ts` makes, and the strongest form of it: a
    // module with no imports cannot reach anything by any path.
    const SRC = readRepoFile("lib/budget-snapshot.ts");
    const specifiers = [...SRC.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)"([^"]+)"/g)];

    assert.deepEqual(
      specifiers.map((m) => m[1]),
      [],
      "lib/budget-snapshot.ts has grown an import, and lib/bundle-size.ts pays for whatever it pulls in",
    );
  });

  it("is a measurement, not a re-measurement", () => {
    const SRC = readRepoFile("lib/budget-snapshot.ts");
    assert.ok(!SRC.includes("node:fs"));
    assert.ok(!SRC.includes("readFileSync"));
  });
});

describe("the snapshot still supports the argument it exists for", () => {
  it("keeps the two bounds a raise has to satisfy", () => {
    const headroom = DEFAULT_BUNDLE_SIZE_BUDGET_BYTES - BUDGET_SNAPSHOT.bundleBytes;

    assert.ok(
      headroom > BUDGET_REARGUE_FLOOR_BYTES,
      "the budget is too tight — it would fail on ordinary work rather than on an accidental SDK",
    );
    assert.ok(
      headroom < SMALLEST_GUARDED_SDK_BYTES,
      "the budget is too loose — a statically imported SDK would land under it",
    );
  });

  it("no raise in the record ever bought more than the smallest SDK", () => {
    // The ceiling the fifth raise found, applied backwards over the whole
    // history rather than only to the live head. A raise buys
    // `budget - bundle` at the commit that took the measurement, and a raise
    // that bought 30 KiB or more would have handed a statically-imported
    // Clarity a place to land — which is the entire thing this budget is for.
    // It is also why "raise it by the usual 0.02 MiB" is not a step that can
    // be taken without measuring: what the ladder can afford depends on where
    // the bundle already is.
    for (const row of BUDGET_HISTORY) {
      const bought = row.budgetBytes - row.bundleBytes;
      assert.ok(
        bought > 0,
        `the ${row.takenOn} raise recorded a budget under its own measurement`,
      );
      assert.ok(
        bought < SMALLEST_GUARDED_SDK_BYTES,
        `the ${row.takenOn} raise bought ${String(Math.round(bought / 1024))} KiB, at or above the smallest SDK the gate has to catch`,
      );
    }
  });

  it("every raise also cleared the floor it was taken to clear", () => {
    // The other bound, and the reason a raise happens at all: a budget that
    // buys less than the re-argue floor is one the next ordinary diff turns
    // red, which puts the wrong cause on the failure.
    for (const row of BUDGET_HISTORY) {
      const bought = row.budgetBytes - row.bundleBytes;
      assert.ok(
        bought > BUDGET_REARGUE_FLOOR_BYTES,
        `the ${row.takenOn} raise bought ${String(Math.round(bought / 1024))} KiB, under the floor it was taken to clear`,
      );
    }
  });

  it("records a copy figure that still describes the translations module", () => {
    // A drift of zero on a commit that did not touch the translations is what
    // says the pair is in step; a large one means somebody moved the budget
    // and left this half behind, which is the bug this module exists to make
    // unexpressible and this case exists to catch if it becomes expressible
    // again.
    assert.notEqual(BUDGET_SNAPSHOT.translationsBytes, null, "the head of the history carries no copy figure");
    const drift = Math.abs(
      translationsFootprint(readI18nSource()).sourceBytes - (BUDGET_SNAPSHOT.translationsBytes ?? 0),
    );

    assert.ok(
      drift < 30 * 1024,
      `the recorded copy measurement is ${String(Math.round(drift / 1024))} KiB out — re-measure BOTH fields of BUDGET_SNAPSHOT together`,
    );
  });

  it("the date is not in the future", () => {
    // A snapshot dated tomorrow is one somebody typed rather than measured.
    assert.ok(BUDGET_SNAPSHOT.takenOn <= new Date().toISOString().slice(0, 10));
  });
});

describe("BUDGET_HISTORY", () => {
  it("has the live snapshot at its head", () => {
    // A raise adds a ROW rather than editing one, which is what makes the
    // trend accumulate instead of being overwritten by the measurement that
    // was supposed to extend it.
    assert.equal(BUDGET_SNAPSHOT, BUDGET_HISTORY[0]);
  });

  it("is newest first, by date and by budget", () => {
    for (let i = 1; i < BUDGET_HISTORY.length; i += 1) {
      const newer = BUDGET_HISTORY[i - 1];
      const older = BUDGET_HISTORY[i];
      assert.ok(newer.takenOn >= older.takenOn, `row ${String(i)} is dated before the one after it`);
      assert.ok(
        newer.budgetBytes > older.budgetBytes,
        `row ${String(i)} does not record a RAISE — every move so far has been upward, and a fall needs its own reasoning here`,
      );
    }
  });

  it("records the budget each measurement justified", () => {
    // Without it a row is half an argument: how much was spent is only
    // meaningful against how much was bought.
    assert.equal(BUDGET_HISTORY[0].budgetBytes, DEFAULT_BUNDLE_SIZE_BUDGET_BYTES);
  });

  it("says what spent each raise, in more than a word", () => {
    const thin = BUDGET_HISTORY.filter((row) => row.because.length < 40).map((row) => row.takenOn);
    assert.deepEqual(thin, [], `these rows record a raise with no account of it: ${thin.join(", ")}`);
  });

  it("carries a copy figure only where one was taken", () => {
    // Three rows predate the copy measure and honestly say so. Back-filling
    // them from today's file would describe a translations module that has
    // grown since.
    const withCopy = BUDGET_HISTORY.filter((row) => row.translationsBytes !== null);
    assert.ok(withCopy.length >= 1, "not one row records the copy half");
    assert.equal(withCopy[0], BUDGET_HISTORY[0], "the newest row is the one that must have it");
  });
});

describe("formatBudgetTrendLine", () => {
  it("names the number of raises and the total growth", () => {
    const line = formatBudgetTrendLine([
      { budgetBytes: 3 * 1024, takenOn: "2026-09-12" },
      { budgetBytes: 2 * 1024, takenOn: "2026-09-11" },
      { budgetBytes: 1 * 1024, takenOn: "2026-09-10" },
    ]);

    assert.match(line ?? "", /budget raised 2 times since 2026-09-10 \(\+2\.0 KiB in total\)/);
  });

  it("counts the moves between the ends, not the rows", () => {
    // The oldest row is the baseline, not a raise measured against anything
    // in the list.
    const line = formatBudgetTrendLine([
      { budgetBytes: 2 * 1024, takenOn: "2026-09-12" },
      { budgetBytes: 1 * 1024, takenOn: "2026-09-10" },
    ]);

    assert.match(line ?? "", /raised 1 time since/);
  });

  it("says nothing about a history with one entry", () => {
    // "Raised once" is not a trend, and a line saying so on every build is
    // noise.
    assert.equal(formatBudgetTrendLine([{ budgetBytes: 1024, takenOn: "2026-09-12" }]), null);
    assert.equal(formatBudgetTrendLine([]), null);
  });

  it("points at the rows rather than restating them", () => {
    // Four `because` lines in a build log would be the prose the history
    // replaced, printed on every commit.
    assert.match(formatBudgetTrendLine() ?? "", /see BUDGET_HISTORY for what spent each one/);
  });
});
