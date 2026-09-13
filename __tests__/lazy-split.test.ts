import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_BUNDLE_SIZE_BUDGET_BYTES,
  LAZY_CHUNK_COUNT_FLOOR,
  evaluateBundleSize,
  evaluateLazySplit,
  formatLazySplitReport,
  LAST_MEASURED_BUNDLE_BYTES,
  LAST_MEASURED_LAZY_BYTES,
  LAZY_CHUNK_FLOOR_BYTES,
  lazySplitFailed,
  SMALLEST_MEASURED_LAZY_CHUNK_BYTES,
} from "../lib/bundle-size";
import { readRepoFile as read } from "./helpers/repo-file";

/**
 * The export as it stands: one entry chunk and six behind `import()` — Sentry's
 * (fetched when diagnostics initialise), PostHog's, and one per lazy locale.
 */
const TODAY = [
  { path: "dist/_expo/static/js/web/entry-f272dd67.js", bytes: 2_456_937 },
  { path: "dist/_expo/static/js/web/index-80a51be8.js", bytes: 895_532 },
  { path: "dist/_expo/static/js/web/index-7591b89d.js", bytes: 280_243 },
  { path: "dist/_expo/static/js/web/be-46a895c4.js", bytes: 96_319 },
  { path: "dist/_expo/static/js/web/pl-27039662.js", bytes: 34_272 },
  { path: "dist/_expo/static/js/web/de-65760e01.js", bytes: 32_252 },
  { path: "dist/_expo/static/js/web/es-036baa8e.js", bytes: 31_976 },
];

describe("the floor is under the measurement and over the cliff", () => {
  it("sits below the lazy chunks as measured, or it fails on a green build", () => {
    assert.ok(
      LAZY_CHUNK_FLOOR_BYTES < LAST_MEASURED_LAZY_BYTES,
      `the floor is ${String(Math.round(LAZY_CHUNK_FLOOR_BYTES / 1024))} KiB and the lazy chunks measured ${String(Math.round(LAST_MEASURED_LAZY_BYTES / 1024))} KiB — a floor at or above the measurement fails the build it was taken from`,
    );
  });

  it("leaves the smallest chunk to the COUNT, which is the half that scales", () => {
    // A byte floor that caught a 31 KiB locale going eager would have to sit
    // within 31 KiB of the measurement, and would then go red the first time a
    // dependency bump made an SDK smaller. The count catches it instead: a
    // chunk that stops being lazy stops existing whatever it weighed.
    const survives = LAST_MEASURED_LAZY_BYTES - SMALLEST_MEASURED_LAZY_CHUNK_BYTES;
    assert.ok(
      LAZY_CHUNK_FLOOR_BYTES < survives,
      "the byte floor is tight enough to catch the smallest chunk — which means it is tight enough to go red on an SDK that shrinks",
    );
    const eager = [
      { path: TODAY[0].path, bytes: TODAY[0].bytes + SMALLEST_MEASURED_LAZY_CHUNK_BYTES },
      ...TODAY.slice(1, -1),
    ];
    const result = evaluateLazySplit(eager);
    assert.equal(result.belowFloor, false, "the bytes alone say nothing — that is the point");
    assert.equal(result.tooFewLazyChunks, true);
    assert.equal(lazySplitFailed(result), true);
  });

  it("leaves an SDK room to shrink without going red", () => {
    // The other side of the band. The regression is a cliff — a whole chunk
    // stops existing — not a drift, so a floor a kibibyte under the
    // measurement catches the same cliff and also every dependency bump that
    // makes an SDK smaller, each costing a round to re-measure for no guard.
    const slack = LAST_MEASURED_LAZY_BYTES - LAZY_CHUNK_FLOOR_BYTES;
    assert.ok(
      slack > 32 * 1024,
      `only ${String(Math.round(slack / 1024))} KiB of slack — an ordinary dependency bump would go red on nothing an import did`,
    );
  });

  it("the smallest chunk is one of the ones measured", () => {
    // Both numbers come from the same export; a "smallest chunk" larger than
    // the sum is what a half-updated re-measurement looks like.
    assert.ok(SMALLEST_MEASURED_LAZY_CHUNK_BYTES < LAST_MEASURED_LAZY_BYTES);
  });

  it("is a floor the budget itself could never have caught", () => {
    // The premise of the whole guard, asserted rather than asserted-in-prose:
    // move every lazy byte into the entry chunk and the TOTAL is unchanged, so
    // the budget above reports OK on the one regression it exists for. This is
    // what `app/_layout.tsx`'s static Sentry import actually did, in reverse:
    // splitting it out moved 874.4 KiB off the page load for +1.1 KiB of total.
    const eager = [
      {
        path: TODAY[0].path,
        bytes: TODAY.reduce((sum, f) => sum + f.bytes, 0),
      },
    ];
    const before = evaluateBundleSize(TODAY, DEFAULT_BUNDLE_SIZE_BUDGET_BYTES);
    const after = evaluateBundleSize(eager, DEFAULT_BUNDLE_SIZE_BUDGET_BYTES);
    assert.equal(after.totalBytes, before.totalBytes);
    assert.equal(after.overBudget, false);
    // And the split does catch it.
    assert.equal(lazySplitFailed(evaluateLazySplit(TODAY)), false);
    assert.equal(lazySplitFailed(evaluateLazySplit(eager)), true);
  });

  it("holds the recorded measurement against the budget's own", () => {
    // Both numbers were taken from the same export; a lazy figure larger than
    // the whole bundle is the shape a half-updated re-measurement has.
    assert.ok(LAST_MEASURED_LAZY_BYTES < LAST_MEASURED_BUNDLE_BYTES);
  });
});

describe("evaluateLazySplit", () => {
  it("charges the entry chunk to the page load and everything else to import()", () => {
    const result = evaluateLazySplit(TODAY);
    assert.equal(result.entryBytes, 2_456_937);
    assert.equal(result.lazyBytes, 1_370_594);
    assert.equal(result.entryChunkCount, 1);
    assert.equal(result.lazyChunkCount, 6);
    assert.equal(result.belowFloor, false);
    assert.equal(result.tooFewLazyChunks, false);
    assert.equal(result.missingEntryChunk, false);
    assert.equal(result.marginBytes, 1_370_594 - LAZY_CHUNK_FLOOR_BYTES);
  });

  it("fails when ONE of the lazy chunks goes eager", () => {
    // The regression the floor exists for: PostHog's chunk alone stops being
    // lazy, everything else stays where it is, and the total does not move.
    const result = evaluateLazySplit([
      { path: TODAY[0].path, bytes: TODAY[0].bytes + TODAY[2].bytes },
      ...TODAY.slice(1, 2),
      ...TODAY.slice(3),
    ]);
    assert.equal(result.lazyChunkCount, LAZY_CHUNK_COUNT_FLOOR - 1);
    assert.equal(lazySplitFailed(result), true);
  });

  it("fails when the lazy chunks fall under the floor", () => {
    const result = evaluateLazySplit([
      { path: "web/entry-abc.js", bytes: 3_600_000 },
      { path: "web/index-def.js", bytes: 100 },
    ]);
    assert.equal(result.belowFloor, true);
    assert.equal(lazySplitFailed(result), true);
    assert.equal(result.marginBytes, 100 - LAZY_CHUNK_FLOOR_BYTES);
  });

  it("fails when there is no lazy chunk at all", () => {
    // What a static `import "posthog-react-native"` actually produces: Metro
    // has nothing to split out, so the export is one chunk.
    const result = evaluateLazySplit([{ path: "web/entry-abc.js", bytes: 3_827_531 }]);
    assert.equal(result.lazyBytes, 0);
    assert.equal(result.lazyChunkCount, 0);
    assert.equal(lazySplitFailed(result), true);
  });

  it("fails loudly when no chunk is named like an entry chunk", () => {
    // The premise, not the measurement. Every chunk would count as lazy, the
    // floor would pass over a bundle that is entirely eager, and the guard
    // would have stopped guarding without a word.
    const result = evaluateLazySplit([
      { path: "web/main-abc.js", bytes: 3_600_000 },
      { path: "web/index-def.js", bytes: 280_000 },
    ]);
    assert.equal(result.missingEntryChunk, true);
    assert.equal(result.belowFloor, false, "the floor passes — which is the trap");
    assert.equal(lazySplitFailed(result), true);
  });

  it("sums the lazy chunks rather than judging them one at a time", () => {
    // Six `import()`s of 400 KiB each are 2400 KiB off the page load, and a
    // per-chunk floor would fail every one of them.
    const lazy = Array.from({ length: LAZY_CHUNK_COUNT_FLOOR }, (_, i) => ({
      path: `web/index-${String(i)}.js`,
      bytes: 409_600,
    }));
    const result = evaluateLazySplit([{ path: "web/entry-abc.js", bytes: 3_000_000 }, ...lazy]);
    assert.equal(result.lazyChunkCount, LAZY_CHUNK_COUNT_FLOOR);
    assert.equal(result.belowFloor, false);
    assert.equal(lazySplitFailed(result), false);
  });

  it("treats the count as a minimum, not an equality", () => {
    // Splitting one feature into two chunks is not a regression, and a gate
    // that failed on it would be a gate against lazy loading.
    const lazy = Array.from({ length: LAZY_CHUNK_COUNT_FLOOR + 3 }, (_, i) => ({
      path: `web/index-${String(i)}.js`,
      bytes: 409_600,
    }));
    const result = evaluateLazySplit([{ path: "web/entry-abc.js", bytes: 3_000_000 }, ...lazy]);
    assert.equal(result.tooFewLazyChunks, false);
    assert.equal(lazySplitFailed(result), false);
  });

  it("takes an explicit floor so a caller can ask a different question", () => {
    assert.equal(evaluateLazySplit(TODAY, 2_000 * 1024).belowFloor, true);
  });
});

describe("formatLazySplitReport", () => {
  it("states both halves of the split when it passes", () => {
    const report = formatLazySplitReport(evaluateLazySplit(TODAY));
    assert.match(report, /1338\.5 KiB of the bundle is lazy in 6 chunks/);
    assert.match(report, /above the 1200\.0 KiB floor/);
    assert.match(report, /2399\.4 KiB in the entry chunk/);
    assert.doesNotMatch(report, /FAIL/);
  });

  it("names the shortfall and why the budget said nothing", () => {
    const report = formatLazySplitReport(
      evaluateLazySplit([{ path: "web/entry-abc.js", bytes: 3_822_836 }]),
    );
    assert.match(report, /check-bundle-size: FAIL/);
    assert.match(report, /only 0\.0 KiB sits outside the entry chunk/);
    assert.match(report, /1200\.0 KiB under the 1200\.0 KiB floor/);
    assert.match(report, /the total barely changed/);
    assert.match(report, /bundle:composition/);
  });

  it("says the entry chunk is missing rather than reporting a number", () => {
    const report = formatLazySplitReport(
      evaluateLazySplit([
        { path: "web/main-abc.js", bytes: 3_600_000 },
        { path: "web/index-def.js", bytes: 280_000 },
      ]),
    );
    assert.match(report, /check-bundle-size: FAIL/);
    assert.match(report, /none of the 2 exported chunks is named like the entry chunk/);
    assert.match(report, /isEntryChunk/);
  });

  it("counts one chunk in the singular", () => {
    const report = formatLazySplitReport(evaluateLazySplit([{ path: "web/x.js", bytes: 10 }]));
    assert.match(report, /none of the 1 exported chunk is named like/);
  });
});

describe("CI wiring", () => {
  it("the gate exits non-zero on a failed split, not only on a blown budget", () => {
    const script = read("scripts/check-bundle-size.ts");
    assert.match(script, /const split = evaluateLazySplit\(files\);/);
    assert.match(script, /if \(result\.overBudget \|\| splitFailed\) process\.exit\(1\);/);
  });

  it("reports the split even when the budget is already blown", () => {
    // Fail-fast here would cost a second CI run to discover the second
    // problem — the same argument check-bundle-smoke makes for its two halves.
    const script = read("scripts/check-bundle-size.ts");
    const splitIdx = script.indexOf("formatLazySplitReport(split)");
    const exitIdx = script.indexOf("process.exit(1)");
    assert.ok(splitIdx > 0 && exitIdx > splitIdx, "the split must be printed before the exit");
  });
});
