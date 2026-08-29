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
 * 4.53 MiB — today's bundle (~4.501 MiB) plus just under 30 KiB.
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
 * Raising this is a decision to be argued, not a step in fixing a red build:
 * `bundle-size.test.ts` asserts the headroom stays under the smaller SDK, so a
 * raise that gives up the guard fails there instead of passing quietly.
 */
export const DEFAULT_BUNDLE_SIZE_BUDGET_BYTES = 4.53 * 1024 * 1024;

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
  return {
    totalBytes,
    budgetBytes,
    overBudget: totalBytes > budgetBytes,
    headroomBytes: budgetBytes - totalBytes,
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
  return lines.join("\n");
}
