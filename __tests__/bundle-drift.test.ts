import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BUDGET_REARGUE_FLOOR_BYTES,
  DEFAULT_BUNDLE_SIZE_BUDGET_BYTES,
  evaluateBundleSize,
  formatBundleSizeReport,
  formatDriftLine,
  LAST_MEASURED_BUNDLE_BYTES,
  SMALLEST_GUARDED_SDK_BYTES,
} from "@/lib/bundle-size";
import { stripComments } from "@/lib/strip-comments";

import { readRepoFile } from "./helpers/repo-file";

/**
 * What the budget report says beyond "OK".
 *
 * The budget moved four times in three days — 4.53 → 4.55 → 4.57 → 4.59 MiB —
 * and each raise was argued against the one before it rather than against a
 * trend, because nothing recorded what was buying the space. Every build now
 * prints how much of the last raise it has spent.
 *
 * The second line is the rule the suite already held and the tool did not say:
 * below 8 KiB of headroom the gate fails on ordinary feature work rather than
 * on an accidental SDK, which is not what it is for. A build sat at 3.7 KiB
 * and reported "OK" — green, and one ordinary diff from a red CI that would
 * have named the wrong cause.
 */

const KIB = 1024;

/** A bundle of exactly `bytes`, as the evaluator takes it. */
const bundleOf = (bytes: number) => [{ path: "web/entry.js", bytes }];

describe("driftBytes", () => {
  it("is zero at the recorded measurement", () => {
    const result = evaluateBundleSize(
      bundleOf(LAST_MEASURED_BUNDLE_BYTES),
      DEFAULT_BUNDLE_SIZE_BUDGET_BYTES,
    );

    assert.equal(result.driftBytes, 0);
  });

  it("counts growth since the last budget move", () => {
    const result = evaluateBundleSize(
      bundleOf(LAST_MEASURED_BUNDLE_BYTES + 10 * KIB),
      DEFAULT_BUNDLE_SIZE_BUDGET_BYTES,
    );

    assert.equal(result.driftBytes, 10 * KIB);
  });

  it("goes negative when a build is smaller than the measurement", () => {
    // Deleting a screen did this twice this week. A drift that could only be
    // positive would report a shrink as nothing.
    const result = evaluateBundleSize(
      bundleOf(LAST_MEASURED_BUNDLE_BYTES - 5 * KIB),
      DEFAULT_BUNDLE_SIZE_BUDGET_BYTES,
    );

    assert.equal(result.driftBytes, -5 * KIB);
  });
});

describe("formatDriftLine", () => {
  const lineAt = (bytes: number) =>
    formatDriftLine(evaluateBundleSize(bundleOf(bytes), DEFAULT_BUNDLE_SIZE_BUDGET_BYTES));

  it("says the measurement was just taken rather than printing +0.0 KiB", () => {
    // A build at the recorded measurement is the one that just moved the
    // budget, and reading it as growth is how a raise gets argued twice.
    const line = lineAt(LAST_MEASURED_BUNDLE_BYTES);
    assert.match(line, /none of it spent/);
    assert.ok(!line.includes("+0.0"));
  });

  it("names both numbers: what was spent and what was bought", () => {
    const line = lineAt(LAST_MEASURED_BUNDLE_BYTES + 17.9 * KIB);
    assert.match(line, /\+17\.9 KiB since the last budget move/);
    const bought = DEFAULT_BUNDLE_SIZE_BUDGET_BYTES - LAST_MEASURED_BUNDLE_BYTES;
    assert.match(line, new RegExp(`of the ${(bought / KIB).toFixed(1)} KiB it bought`));
  });

  it("signs a shrink with a minus rather than a bare number", () => {
    const line = lineAt(LAST_MEASURED_BUNDLE_BYTES - 3 * KIB);
    assert.match(line, /-3\.0 KiB since the last budget move/);
    assert.ok(!line.includes("+3.0"));
  });
});

describe("the near-floor warning", () => {
  const resultAt = (headroom: number) =>
    evaluateBundleSize(
      bundleOf(DEFAULT_BUNDLE_SIZE_BUDGET_BYTES - headroom),
      DEFAULT_BUNDLE_SIZE_BUDGET_BYTES,
    );

  it("fires below the floor, while the build still passes", () => {
    const result = resultAt(3.7 * KIB);
    assert.equal(result.overBudget, false);
    assert.equal(result.nearFloor, true);
  });

  it("does not fire with room to spare", () => {
    assert.equal(resultAt(26.8 * KIB).nearFloor, false);
  });

  it("does not fire over budget, where there is a louder thing to say", () => {
    // "You are near the floor" printed under "you are through it" reads as a
    // smaller problem than the one on screen.
    const over = evaluateBundleSize(
      bundleOf(DEFAULT_BUNDLE_SIZE_BUDGET_BYTES + KIB),
      DEFAULT_BUNDLE_SIZE_BUDGET_BYTES,
    );
    assert.equal(over.overBudget, true);
    assert.equal(over.nearFloor, false);
  });

  it("is exclusive at the floor itself", () => {
    assert.equal(resultAt(BUDGET_REARGUE_FLOOR_BYTES).nearFloor, false);
    assert.equal(resultAt(BUDGET_REARGUE_FLOOR_BYTES - 1).nearFloor, true);
  });

  it("asks for an argument rather than for a bigger number", () => {
    // The failure mode the budget's own doc block names: raising it as a step
    // in fixing a red build instead of as a decision.
    const report = formatBundleSizeReport(
      bundleOf(DEFAULT_BUNDLE_SIZE_BUDGET_BYTES - 3.7 * KIB),
      resultAt(3.7 * KIB),
    );
    assert.match(report, /headroom is under 8\.0 KiB/);
    assert.match(report, /the next ordinary diff will not/);
    assert.match(report, /Re-measure and re-argue/);
    assert.match(report, /not against comfort/);
  });

  it("stays out of a healthy report except for the drift line", () => {
    const report = formatBundleSizeReport(
      bundleOf(LAST_MEASURED_BUNDLE_BYTES),
      evaluateBundleSize(bundleOf(LAST_MEASURED_BUNDLE_BYTES), DEFAULT_BUNDLE_SIZE_BUDGET_BYTES),
    );
    assert.match(report, /of headroom left/);
    assert.match(report, /none of it spent/);
    assert.ok(!report.includes("Re-measure and re-argue"));
  });
});

describe("the measurement has one home", () => {
  it("is re-exported from the snapshot, not declared here", () => {
    // This case shipped asserting the number was DECLARED in
    // `lib/bundle-size.ts`, which was right for an hour: the round after it
    // found that the bundle figure and the copy figure are one measurement
    // taken in two places, and moved both into `lib/budget-snapshot.ts`. What
    // it was claiming is that the number has one home and that this module
    // reads it rather than keeping a copy — which is what it asks now.
    const SRC = stripComments(readRepoFile("lib/bundle-size.ts"));
    assert.match(SRC, /export const LAST_MEASURED_BUNDLE_BYTES = BUDGET_SNAPSHOT\.bundleBytes;/);
    assert.match(SRC, /import \{[^}]*\bBUDGET_SNAPSHOT\b[^}]*\} from "@\/lib\/budget-snapshot";/);
  });

  it("is not re-declared by the suite that used to own it", () => {
    // Three readers argue from this number — the doc block, the two bounds in
    // `bundle-size.test.ts`, and now the report — and it was owned by the one
    // that cannot print it.
    const TEST = stripComments(readRepoFile("__tests__/bundle-size.test.ts"));
    assert.match(TEST, /const MEASURED_BUNDLE_BYTES = LAST_MEASURED_BUNDLE_BYTES;/);
    assert.ok(!/Math\.round\(4\d{3}\.\d \* 1024\)/.test(TEST), "the suite declares its own copy again");
  });

  it("is a measurement, never a re-measurement", () => {
    // Reading `dist/` for it would make every claim depend on whether somebody
    // had built, and turn a real regression into a number that re-derives its
    // own expectation. The declaration itself moved to
    // `lib/budget-snapshot.ts`, where `budget-snapshot.test.ts` holds the same
    // rule; what stays here is that the module doing the arithmetic never
    // reaches for the filesystem either.
    const SRC = readRepoFile("lib/bundle-size.ts");
    assert.ok(!SRC.includes("readdirSync"));
    assert.ok(!SRC.includes("statSync"));
    assert.ok(!SRC.includes("node:fs"));
  });

  it("keeps the two bounds the raise has to satisfy", () => {
    const headroom = DEFAULT_BUNDLE_SIZE_BUDGET_BYTES - LAST_MEASURED_BUNDLE_BYTES;
    assert.ok(headroom > BUDGET_REARGUE_FLOOR_BYTES, "the budget is tight enough to fail on ordinary work");
    assert.ok(headroom < SMALLEST_GUARDED_SDK_BYTES, "the budget is loose enough to miss a static SDK import");
  });
});
