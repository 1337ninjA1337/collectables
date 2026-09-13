/**
 * Bundle-size budget (pure logic — CLI wrapper in `scripts/check-bundle-size.ts`).
 *
 * Guards against a regression where someone imports a heavy SDK statically
 * into a screen (e.g. `posthog-js` instead of the lazy `import()` pattern) and
 * silently inflates the web bundle. PostHog adds ~60KB, Clarity ~30KB; the
 * budget leaves headroom above today's bundle so intentional feature growth
 * doesn't trip it, while a full accidental SDK inclusion does.
 *
 * The budget applies to the sum of the exported JS chunks under
 * `dist/_expo/static/js/web/*.js` (sourcemaps excluded — they're stripped
 * before the Pages artifact is uploaded and never ship to browsers).
 *
 * A SUM CANNOT SEE AN SDK THAT WAS ALREADY HERE AND MERELY STOPPED BEING
 * DEFERRED, which is the other half of the same regression: the bytes move
 * from a chunk nothing fetches into the one every page load does, and the
 * total stays where it was. {@link evaluateLazySplit} is that half, and it
 * fails the same gate.
 */

/**
 * 3.67 MiB today. THE LIVE NUMBER IS THE LAST PARAGRAPH'S, not the next
 * line's: that line was written as a header back when this block was one
 * raise, and it kept saying "4.60 MiB" after the budget went DOWN to 3.67.
 * Everything under it is the moves in order, each argued against the one
 * before it, and the newest is at the bottom.
 *
 * 4.60 MiB — today's bundle (4689.7 KiB) plus 20.7 KiB.
 *
 * THE HEADROOM IS THE GUARD, and it is chosen against the smallest thing this
 * budget has to catch rather than against how much room feels comfortable.
 * Clarity is ~30 KiB and PostHog ~60 KiB, so headroom BELOW 30 KiB means a
 * statically-imported SDK still trips the gate on the commit that adds it.
 * More headroom than that would make the budget a number that only notices a
 * regression months later, when nobody can say which change caused it.
 *
 * It was 4.5 MiB under a comment claiming "~190 KiB of headroom", which had
 * stopped being true: the bundle reached 4609.1 KiB against a 4608.0 KiB
 * budget, so the next ONE KIBIBYTE of ordinary feature work failed CI — and
 * 190 KiB of headroom could never have caught either SDK anyway. Both halves
 * of that comment were wrong in opposite directions.
 *
 * 4.55 MiB on 2026-09-10, re-measured for the same reason and argued the same
 * way. Three features (the dense-run reorder writer, the per-collection sort
 * preference, and the toast action) took the bundle from 4619.4 to 4634.4 KiB
 * and the headroom from 19.3 to 4.3 — a fourth diff of ordinary size would
 * have gone red on nothing an SDK did. The raise buys 24.8 KiB, which is still
 * below Clarity, so a statically-imported SDK still trips on its own commit.
 * The number moves by re-measuring and re-arguing, never by rounding up until
 * the build passes.
 *
 * 4.57 MiB on 2026-09-12, the third time and the same argument. Four rounds
 * (the converted stats total, the export's money, the reversible archive, and
 * the archive screen with its eleven keys in six languages) took the bundle
 * from 4634.4 to 4655.5 KiB and the headroom from 24.8 to 3.7. Screens and
 * translated copy are the ordinary growth this budget is supposed to let
 * through; 3.7 KiB is below the 8 KiB floor `bundle-size.test.ts` holds for
 * exactly that reason, so the next round would have gone red on nothing an SDK
 * did. The raise buys 24.2 KiB — still below Clarity, so the guard is intact.
 *
 * 4.59 MiB the same day, the FOURTH raise in three days, and the trend is now
 * the finding rather than a footnote on it. 4.53 → 4.55 → 4.57 → 4.59: each
 * raise buys about 25 KiB and four rounds of ordinary feature work spends it,
 * so this number is a ratchet that records how fast the app grows and has
 * never once said stop. It is still the right shape — the headroom is chosen
 * against Clarity and not against comfort, so a statically-imported SDK trips
 * on its own commit either way — and what it does NOT do is any kind of
 * budgeting. This round (a bulk archive, its listing pass, and four counted
 * strings in six languages) cost 17.9 KiB, of which the copy is a real share:
 * a counted string with three Slavic forms is not free. Somebody should
 * measure KiB per round and split code from copy before the fifth raise; this
 * paragraph is here so that the fifth is argued against a trend rather than
 * against the fourth.
 *
 * 4.60 MiB the same day, the FIFTH raise, and the first argued from the
 * tool's own output rather than from the paragraph above it. The fourth asked
 * for KiB per round split code from copy before a fifth; `BUDGET_HISTORY` and
 * the drift line answer it, and the answer is that there is no per-round rate
 * to extrapolate. Seven rounds today spent 16.3 KiB — 2.3 KiB each — while the
 * single round before them spent 17.9 KiB on its own. What separates them is
 * copy: 4.9 KiB of today's 16.3 is translated strings, and one round with four
 * counted keys in six languages costs what seven without them do. "Rounds" was
 * never the unit.
 *
 * THE RAISE ITSELF HAS A CEILING, which is the finding this one adds. A raise
 * can never buy more than the smallest SDK it must catch: headroom at or above
 * Clarity's ~30 KiB is a budget that has stopped guarding, and
 * `bundle-size.test.ts` fails there rather than letting it pass. So 4.61 MiB
 * was not available — it would have left 30.9 KiB — and this buys 20.7 KiB, a
 * smaller raise than any of the four before it for a reason that is about the
 * guard and not about restraint. The budget can keep climbing with the bundle
 * indefinitely; what it cannot do is climb FASTER, so a round that needs more
 * than ~30 KiB of room has to make the bundle smaller instead.
 *
 * 3.67 MiB on 2026-09-13, and it is the first move in this block that is not
 * a raise. `npm run bundle:composition` — the tool the paragraph below asks
 * for — found that `app/_layout.tsx`'s `GestureHandlerRootView` was pulling
 * `react-native-reanimated` (632.9 KiB), gesture-handler (202.3), worklets
 * (57.8), hammerjs (25.6) and semver (16.7) into a bundle where no screen
 * mounts a gesture-handler component. Splitting the root into a platform pair
 * took the bundle from 4696.0 to 3732.1 KiB.
 *
 * A SAVING HAS TO BE BANKED IN THE SAME COMMIT. Left at 4.60 MiB the gate
 * would have had 978 KiB of headroom — not a loose guard but no guard at all,
 * and four rounds of ordinary work would have spent a fifth of it without
 * anybody deciding anything. The new number keeps the rule the five raises
 * were argued under: 26.0 KiB of headroom, under Clarity's ~30 KiB, so a
 * statically-imported SDK still trips on its own commit.
 *
 * The SIXTH raise has something the first five did not: `npm run
 * bundle:composition` prints what the bundle is made of, per package and per
 * module, from the export's own sourcemap. Every paragraph above argues from
 * a total and a date because that is all anybody could measure; the next one
 * can name what grew. `lib/bundle-composition.ts` is the arithmetic and says
 * what a per-module number is not — a bucket's bytes are what it contributed,
 * never what removing it would return.
 *
 * Raising this is a decision to be argued, not a step in fixing a red build:
 * `bundle-size.test.ts` asserts the headroom stays under the smaller SDK, so a
 * raise that gives up the guard fails there instead of passing quietly.
 */

import { isEntryChunk } from "@/lib/bundle-composition";
import { BUDGET_HISTORY, BUDGET_SNAPSHOT } from "@/lib/budget-snapshot";
// A build-log line is still a sentence with a count in it, and `plural.test.ts`
// holds the rule for the whole tree rather than for the UI half of it.
import { plural } from "@/lib/plural";

export const DEFAULT_BUNDLE_SIZE_BUDGET_BYTES = 3.67 * 1024 * 1024;

/**
 * The bundle as it stood when the budget last moved.
 *
 * Re-exported rather than declared: it is half of a PAIR — the other half is
 * the translations module's size at that same commit — and the two are taken
 * in the same breath and argued from together. A raise that updated one and
 * left the other behind reported a copy delta measured against the wrong
 * baseline, silently, on the one output somebody reads when deciding whether
 * to raise again. `lib/budget-snapshot.ts` holds both so that forgetting half
 * is not expressible.
 *
 * It reached that module from here, having reached here from inside
 * `bundle-size.test.ts`: the doc block above argues from it in every
 * paragraph, the suite holds two bounds against it, and the report prints the
 * drift from it — three readers, and originally the one that cannot print it
 * owned the number.
 */
export const LAST_MEASURED_BUNDLE_BYTES = BUDGET_SNAPSHOT.bundleBytes;

/**
 * The point at which the report stops saying "OK" and starts asking for an
 * argument.
 *
 * `bundle-size.test.ts` has held this bound since the second raise: below it,
 * the gate fails on ordinary feature work rather than on an accidental SDK,
 * which is not what it is for. It was a rule only the suite knew, so a build
 * sat at 3.7 KiB of headroom and reported "OK" — green, and one ordinary diff
 * from a red CI that would have named the wrong cause. The report says it now,
 * on the build that is actually close.
 */
export const BUDGET_REARGUE_FLOOR_BYTES = 8 * 1024;

/**
 * The smallest SDK the budget must still catch as a static import, in bytes.
 *
 * Clarity's browser bundle, the smaller of the two the doc block names. The
 * gate is only meaningful while the headroom above the real bundle is less
 * than this.
 */
export const SMALLEST_GUARDED_SDK_BYTES = 30 * 1024;

export type BundleFile = {
  readonly path: string;
  readonly bytes: number;
};

export type BundleSizeResult = {
  readonly totalBytes: number;
  readonly budgetBytes: number;
  readonly overBudget: boolean;
  /** Positive when under budget, negative when over. */
  readonly headroomBytes: number;
  /**
   * Growth since {@link LAST_MEASURED_BUNDLE_BYTES} — how much this build has
   * spent of what the last raise bought.
   *
   * The budget has moved four times in three days and nothing recorded what
   * was buying the space, so each raise was argued against the one before it
   * rather than against a trend. This is the missing number, printed on every
   * build rather than reconstructed from git when somebody wonders.
   */
  readonly driftBytes: number;
  /**
   * True when the headroom has fallen below {@link BUDGET_REARGUE_FLOOR_BYTES}
   * while still being under budget: the build passes, and the NEXT ordinary
   * diff will not.
   */
  readonly nearFloor: boolean;
};

/**
 * Resolves the budget from `BUNDLE_SIZE_BUDGET_BYTES` (a positive integer of
 * bytes) so CI can tighten/loosen without a code change; anything unset or
 * malformed falls back to the default rather than silently disabling the gate.
 */
export function resolveBundleSizeBudget(
  env: Record<string, string | undefined>,
): number {
  const raw = env.BUNDLE_SIZE_BUDGET_BYTES;
  if (raw === undefined || raw === "") return DEFAULT_BUNDLE_SIZE_BUDGET_BYTES;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_BUNDLE_SIZE_BUDGET_BYTES;
  }
  return parsed;
}

export function evaluateBundleSize(
  files: readonly BundleFile[],
  budgetBytes: number,
): BundleSizeResult {
  const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0);
  const headroomBytes = budgetBytes - totalBytes;
  return {
    totalBytes,
    budgetBytes,
    overBudget: totalBytes > budgetBytes,
    headroomBytes,
    driftBytes: totalBytes - LAST_MEASURED_BUNDLE_BYTES,
    // Only while still under budget: over budget the report has a louder
    // thing to say, and "you are near the floor" under "you are through it"
    // reads as a smaller problem than the one on screen.
    nearFloor: headroomBytes >= 0 && headroomBytes < BUDGET_REARGUE_FLOOR_BYTES,
  };
}

function formatKiB(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

export function formatBundleSizeReport(
  files: readonly BundleFile[],
  result: BundleSizeResult,
): string {
  const lines = files
    .slice()
    .sort((a, b) => b.bytes - a.bytes)
    .map((f) => `  ${formatKiB(f.bytes).padStart(10)}  ${f.path}`);
  lines.push(
    `  ${formatKiB(result.totalBytes).padStart(10)}  total (budget ${formatKiB(result.budgetBytes)})`,
  );
  if (result.overBudget) {
    lines.push(
      `check-bundle-size: FAIL — web bundle exceeds budget by ${formatKiB(-result.headroomBytes)}.`,
      "A heavy dependency probably became a static import (analytics/replay SDKs",
      "must stay behind lazy `import()`). Raise BUNDLE_SIZE_BUDGET_BYTES only for",
      "intentional growth.",
    );
  } else {
    lines.push(
      `check-bundle-size: OK — ${formatKiB(result.headroomBytes)} of headroom left.`,
    );
  }
  lines.push(formatDriftLine(result));
  const trend = formatBudgetTrendLine();
  if (trend) lines.push(trend);
  if (result.nearFloor) {
    lines.push(
      `check-bundle-size: headroom is under ${formatKiB(BUDGET_REARGUE_FLOOR_BYTES)} — this build passes and the next ordinary diff will not.`,
      "Re-measure and re-argue the budget in lib/bundle-size.ts rather than",
      "rounding it up until the build goes green; the headroom is chosen against",
      "the smallest SDK the gate has to catch, not against comfort.",
      // The argument wants to know what is IN the bundle, and for five raises
      // nothing could say. This is the moment somebody needs it, so it is the
      // moment the report names the tool rather than leaving it in a doc block
      // they would have to already know to open.
      "`npm run build:sourcemaps && npm run bundle:composition` says what the",
      "bundle is made of, per package and per module — the input this argument",
      "has never had.",
    );
  }
  return lines.join("\n");
}

/**
 * "Budget moved 5 times since 2026-09-10, -798.7 KiB in total" — the trend
 * every raise was argued without.
 *
 * The budget's doc block is paragraphs of prose doing a table's job: each move
 * was argued against the one before it, and a reader wanting the RATE had to
 * reconstruct it by reading all of them. Eight rounds carried "nothing keeps a
 * budget history" as a suggestion.
 *
 * MOVED, not RAISED, and the word had to change on the day the first lowering
 * landed. Five raises in three days made "raised N times (+X KiB)" read as a
 * fact about the list rather than an assumption, and the assumption was baked
 * into the arithmetic too: the total was printed with a hard-coded `+`, so the
 * 2026-09-13 row would have printed `+-798.7 KiB` — a sign bug that could only
 * appear on the one build anybody would want to celebrate.
 *
 * Returns `null` for a single-entry history, because "moved once" is not a
 * trend and a line saying so on every build is noise.
 */
export function formatBudgetTrendLine(
  history: readonly { budgetBytes: number; takenOn: string }[] = BUDGET_HISTORY,
): string | null {
  if (history.length < 2) return null;
  const newest = history[0];
  const oldest = history[history.length - 1];
  // The moves BETWEEN the ends: the oldest row is the baseline, not a move
  // measured against anything in this list.
  const moves = history.length - 1;
  const net = newest.budgetBytes - oldest.budgetBytes;
  // Signed, because an unsigned "2.0 KiB in total" reads as a size rather than
  // as a change, and the sign is now the interesting half.
  const sign = net < 0 ? "-" : "+";
  return (
    `check-bundle-size: budget moved ${String(moves)} ${plural(moves, "time", "times")} ` +
    `since ${oldest.takenOn} (${sign}${formatKiB(Math.abs(net))} net) — see BUDGET_HISTORY for what each one was for.`
  );
}

/**
 * "Spent 17.9 KiB of the 26.8 KiB the last raise bought" — the sentence the
 * budget's doc block asks for and nothing was producing.
 *
 * Signed, and the zero case says so explicitly rather than printing "+0.0
 * KiB": a build at the recorded measurement is the one that just moved the
 * budget, and reading it as growth is how a raise gets argued twice.
 *
 * "the last budget move" and not "the last raise": the 2026-09-13 move went
 * DOWN, and a line calling that a raise describes the opposite of what
 * happened on the build where somebody is reading it.
 */
export function formatDriftLine(result: BundleSizeResult): string {
  const bought = result.budgetBytes - LAST_MEASURED_BUNDLE_BYTES;
  if (result.driftBytes === 0) {
    return `check-bundle-size: at the recorded measurement — ${formatKiB(bought)} of room at the last budget move, none of it spent.`;
  }
  const sign = result.driftBytes > 0 ? "+" : "-";
  const spent = `${sign}${formatKiB(Math.abs(result.driftBytes))}`;
  return `check-bundle-size: ${spent} since the last budget move, of the ${formatKiB(bought)} it bought.`;
}

/**
 * The bytes that must stay OUTSIDE the entry chunk, in bytes.
 *
 * THE TOTAL CANNOT SEE THE ONE REGRESSION THIS FILE EXISTS FOR. The budget
 * above is a sum over every chunk, so a package that stops being lazy — the
 * `import()` in `lib/analytics.ts` becoming a static import, or a screen
 * reaching for `posthog-react-native` directly — moves its bytes out of a
 * chunk nothing fetches until that feature initialises and into the one every
 * page load does, and changes the sum by approximately nothing. Every
 * paragraph of the doc block above argues about ~30 KiB of headroom against an
 * SDK arriving; an SDK that is already in the tree and merely stops being
 * deferred arrives at the browser for free, under budget, silently.
 *
 * **That is not hypothetical, and the day this floor landed it was already
 * true.** `app/_layout.tsx` imported `@sentry/react-native` at module scope
 * for `wrap()` and `<ErrorBoundary>` while `lib/sentry.ts` loaded the same SDK
 * through a lazy `import()`, so 874.4 KiB sat in the entry chunk with nothing
 * red. Splitting the crash shell into `components/crash-boundary.{tsx,web.tsx}`
 * moved it out and cost the TOTAL +1.1 KiB — the whole saving is invisible to
 * the budget, in both directions.
 *
 * So the guard is the SPLIT rather than a second size. The composition report
 * marks `(lazy)` on everything outside the entry chunk and a human reads it;
 * this is the same fact with a floor under it, on the gate CI already runs.
 *
 * **The floor has to sit above the largest lazy chunk, not just under the
 * total.** With 1148.2 KiB lazy in two chunks — Sentry's 874.5 and PostHog's
 * 273.7 — a floor of 200 KiB would have caught Sentry going eager and slept
 * through PostHog doing the same, because 273.7 KiB of remaining lazy bytes is
 * still over it. Any single chunk going eager has to break it, which puts the
 * floor above 874.5 KiB; `bundle-size.test.ts` asserts exactly that from the
 * measurements rather than from this paragraph.
 *
 * **The slack under the measurement is on purpose.** The regression is a cliff
 * — a whole chunk stops existing — not a drift, so a floor anywhere in that
 * band catches it on the commit that causes it. What a tight floor would add
 * is false reds on a dependency bump that makes an SDK smaller, each costing a
 * round to re-measure and re-argue for no extra guard. 1000 KiB leaves 148.2
 * KiB of room to shrink.
 *
 * Lowering it is the same kind of decision as raising the budget: a lazy chunk
 * that is genuinely gone (analytics deleted) is a saving to bank deliberately,
 * and the suite holds the floor inside the band above so it cannot be edited
 * into a number that passes quietly.
 */
export const LAZY_CHUNK_FLOOR_BYTES = 1000 * 1024;

/**
 * The lazy chunks as they stood when the floor was set — 1148.2 KiB in two
 * chunks: Sentry's 874.5 (`index-<hash>.js`, fetched when diagnostics
 * initialise) and PostHog's 273.7.
 *
 * A MEASUREMENT, like `LAST_MEASURED_BUNDLE_BYTES`, taken on 2026-09-13 from
 * the same export that measured 3822836 bytes in total. It is not a field of
 * `BUDGET_SNAPSHOT` because it is not half of that pair: the budget and the
 * copy figure move together at a budget move, and this number moves when the
 * SPLIT changes, which is a different event.
 */
export const LAST_MEASURED_LAZY_BYTES = 1_175_775;

/**
 * The smallest of those chunks — PostHog's, at 273.7 KiB.
 *
 * The floor's real bound: a chunk this size going eager has to fail the gate,
 * so the floor cannot be more than this far below
 * {@link LAST_MEASURED_LAZY_BYTES}. Recorded rather than derived because it is
 * a measurement of the SAME export, and a bound computed from a number nobody
 * took is a bound that moves when somebody guesses.
 */
export const SMALLEST_MEASURED_LAZY_CHUNK_BYTES = 280_243;

export type LazySplitResult = {
  /** Bytes in the chunk(s) every page load fetches. */
  readonly entryBytes: number;
  /** Bytes in every other chunk — reached through a dynamic `import()`. */
  readonly lazyBytes: number;
  readonly entryChunkCount: number;
  readonly lazyChunkCount: number;
  readonly floorBytes: number;
  /** Positive while the lazy chunks are above the floor. */
  readonly marginBytes: number;
  /** True when the lazy chunks have fallen below {@link floorBytes}. */
  readonly belowFloor: boolean;
  /**
   * True when no chunk is named like an entry chunk at all.
   *
   * Then every chunk counts as lazy, the floor passes on a bundle that is
   * entirely eager, and the guard has stopped guarding without saying so —
   * which is what happens the day Metro changes how it names the web entry.
   * A premise this check cannot verify fails loudly instead.
   */
  readonly missingEntryChunk: boolean;
};

/**
 * Splits the exported chunks into what a page load fetches and what it does
 * not, and holds the second half above {@link LAZY_CHUNK_FLOOR_BYTES}.
 */
export function evaluateLazySplit(
  files: readonly BundleFile[],
  floorBytes: number = LAZY_CHUNK_FLOOR_BYTES,
): LazySplitResult {
  let entryBytes = 0;
  let lazyBytes = 0;
  let entryChunkCount = 0;
  let lazyChunkCount = 0;
  for (const file of files) {
    if (isEntryChunk(file.path)) {
      entryBytes += file.bytes;
      entryChunkCount += 1;
    } else {
      lazyBytes += file.bytes;
      lazyChunkCount += 1;
    }
  }
  return {
    entryBytes,
    lazyBytes,
    entryChunkCount,
    lazyChunkCount,
    floorBytes,
    marginBytes: lazyBytes - floorBytes,
    belowFloor: lazyBytes < floorBytes,
    missingEntryChunk: entryChunkCount === 0,
  };
}

/** Whether {@link evaluateLazySplit} should fail the build. */
export function lazySplitFailed(result: LazySplitResult): boolean {
  return result.missingEntryChunk || result.belowFloor;
}

export function formatLazySplitReport(result: LazySplitResult): string {
  if (result.missingEntryChunk) {
    return [
      `check-bundle-size: FAIL — none of the ${String(result.lazyChunkCount)} exported ${plural(result.lazyChunkCount, "chunk", "chunks")} is named like the entry chunk.`,
      "`isEntryChunk` in lib/bundle-composition.ts knows Metro's `entry-<hash>.js`",
      "convention; if the export stopped following it, this check cannot tell a",
      "lazily-loaded chunk from the one every page load fetches, and neither can",
      "the composition report's `(lazy)` marks.",
    ].join("\n");
  }
  if (result.belowFloor) {
    return [
      `check-bundle-size: FAIL — only ${formatKiB(result.lazyBytes)} sits outside the entry chunk, ${formatKiB(-result.marginBytes)} under the ${formatKiB(result.floorBytes)} floor.`,
      "A package that used to be behind a lazy `import()` is probably in the entry",
      "chunk now, where every page load fetches it. The BUDGET above cannot see",
      "this: the bytes moved between chunks and the total barely changed.",
      "`npm run build:sourcemaps && npm run bundle:composition` names which bucket",
      "moved. Lower LAZY_CHUNK_FLOOR_BYTES only for a lazy chunk that is",
      "deliberately gone.",
    ].join("\n");
  }
  return (
    `check-bundle-size: ${formatKiB(result.lazyBytes)} of the bundle is lazy — ` +
    `${formatKiB(result.marginBytes)} above the ${formatKiB(result.floorBytes)} floor, ` +
    `${formatKiB(result.entryBytes)} in the entry chunk.`
  );
}
