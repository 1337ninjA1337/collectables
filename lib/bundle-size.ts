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
 */

/**
 * 4.59 MiB — today's bundle (4673.4 KiB) plus 26.8 KiB.
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
 * Raising this is a decision to be argued, not a step in fixing a red build:
 * `bundle-size.test.ts` asserts the headroom stays under the smaller SDK, so a
 * raise that gives up the guard fails there instead of passing quietly.
 */

import { BUDGET_SNAPSHOT } from "@/lib/budget-snapshot";

export const DEFAULT_BUNDLE_SIZE_BUDGET_BYTES = 4.59 * 1024 * 1024;

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
  if (result.nearFloor) {
    lines.push(
      `check-bundle-size: headroom is under ${formatKiB(BUDGET_REARGUE_FLOOR_BYTES)} — this build passes and the next ordinary diff will not.`,
      "Re-measure and re-argue the budget in lib/bundle-size.ts rather than",
      "rounding it up until the build goes green; the headroom is chosen against",
      "the smallest SDK the gate has to catch, not against comfort.",
    );
  }
  return lines.join("\n");
}

/**
 * "Spent 17.9 KiB of the 26.8 KiB the last raise bought" — the sentence the
 * budget's doc block asks for and nothing was producing.
 *
 * Signed, and the zero case says so explicitly rather than printing "+0.0
 * KiB": a build at the recorded measurement is the one that just moved the
 * budget, and reading it as growth is how a raise gets argued twice.
 */
export function formatDriftLine(result: BundleSizeResult): string {
  const bought = result.budgetBytes - LAST_MEASURED_BUNDLE_BYTES;
  if (result.driftBytes === 0) {
    return `check-bundle-size: at the recorded measurement — ${formatKiB(bought)} bought by the last raise, none of it spent.`;
  }
  const sign = result.driftBytes > 0 ? "+" : "-";
  const spent = `${sign}${formatKiB(Math.abs(result.driftBytes))}`;
  return `check-bundle-size: ${spent} since the last budget move, of the ${formatKiB(bought)} it bought.`;
}
