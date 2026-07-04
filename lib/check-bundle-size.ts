/**
 * Web-bundle size budget used by `scripts/check-bundle-size.ts` and its
 * tests.
 *
 * Pure module: no filesystem access — the CLI wrapper walks
 * `dist/_expo/static/js/web/` and hands the collected `{file, bytes}`
 * entries here, so the budget math is unit-testable without a build.
 *
 * Why (.tasks/.tasks.md line 178): PostHog adds ~60KB, Clarity ~30KB; a
 * regression where someone imports `posthog-js` statically into a screen
 * (instead of the lazy `import()` the analytics provider uses) or a
 * duplicated vendor chunk lands silently otherwise. The budget is a
 * regression tripwire, not a performance goal.
 *
 * The default is 5MB, not the 4.5MB the task sketched ("say, 4.5MB"):
 * the shipped bundle already totals ~4.53MB (entry ~4.25MB + route chunk
 * ~0.28MB), so 4.5MB would fail the build on day one. 5MB keeps ~10%
 * headroom — tighten it after a real size-reduction pass, never loosen it
 * casually (that defeats the tripwire).
 */

/** Default budget for the summed dist JS, in bytes (5 MiB). */
export const DEFAULT_BUNDLE_BUDGET_BYTES = 5 * 1024 * 1024;

export type BundleFile = {
  /** Path relative to the repo root (for reporting). */
  file: string;
  bytes: number;
};

export type BundleBudgetResult = {
  totalBytes: number;
  budgetBytes: number;
  overBudget: boolean;
  /** Files sorted largest-first, for the report. */
  files: BundleFile[];
};

/**
 * Parse a byte-count override (the `BUNDLE_BUDGET_BYTES` env var). Blank,
 * non-numeric, zero, negative, fractional, or unsafe values fall back to
 * the default so a misconfigured knob can never disable the gate.
 */
export function resolveBundleBudgetBytes(
  raw: string | undefined,
  fallback: number = DEFAULT_BUNDLE_BUDGET_BYTES,
): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return fallback;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/** Sum the bundle files against the budget. */
export function evaluateBundleBudget(
  files: BundleFile[],
  budgetBytes: number = DEFAULT_BUNDLE_BUDGET_BYTES,
): BundleBudgetResult {
  const sorted = [...files].sort((a, b) => b.bytes - a.bytes);
  const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0);
  return {
    totalBytes,
    budgetBytes,
    overBudget: totalBytes > budgetBytes,
    files: sorted,
  };
}

/** Render bytes as a human-readable MB figure (two decimals). */
export function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

/**
 * Format the result. Over budget → a failure report naming every file
 * largest-first plus the fix hint; under budget → a one-line summary the
 * CLI can log for the CI trace.
 */
export function formatBundleSizeReport(result: BundleBudgetResult): string {
  const headline = `Web bundle total ${formatMegabytes(result.totalBytes)} vs budget ${formatMegabytes(result.budgetBytes)} (${result.files.length} JS file(s)).`;
  if (!result.overBudget) {
    return `check-bundle-size: ${headline}`;
  }
  const lines: string[] = [];
  lines.push(`Web bundle exceeds the size budget: ${headline}`);
  for (const f of result.files) {
    lines.push(`  ${formatMegabytes(f.bytes).padStart(9)}  ${f.file}`);
  }
  lines.push(
    "Common causes: a static `import posthog-js`/vendor SDK that should be lazy-loaded, or a duplicated chunk. Raise DEFAULT_BUNDLE_BUDGET_BYTES only with a written justification in lib/check-bundle-size.ts.",
  );
  return lines.join("\n");
}
