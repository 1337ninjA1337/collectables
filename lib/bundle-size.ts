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

/** 4.5 MiB. Today's bundle is ~4.32 MiB; ~190 KiB of headroom. */
export const DEFAULT_BUNDLE_SIZE_BUDGET_BYTES = 4.5 * 1024 * 1024;

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
