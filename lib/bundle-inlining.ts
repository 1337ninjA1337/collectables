/**
 * Post-build secret-inlining verifier used by
 * `scripts/verify-bundle-inlining.ts` and its tests.
 *
 * Pure module: no filesystem access; the script wrapper reads the exported
 * bundle and the deploy env, so the checker is unit-testable under
 * `node --test`.
 *
 * Closes the loop between "secret in CI" and "secret in artifact": the
 * deploy workflow's secret-status step prints `[set]`, but a bundle can
 * still ship with the value un-inlined (e.g. a whole-`process.env` pass that
 * predates `lint:env-inlining`, or a babel-preset regression). For every
 * watched var that is SET in the build env, the JSON-escaped value must
 * appear verbatim in the bundle source — that is exactly what
 * babel-preset-expo emits when inlining succeeds, whether the access was an
 * in-place literal (`process.env.EXPO_PUBLIC_X` → `"value"`) or a
 * reader-object key (`EXPO_PUBLIC_X:"value"`). Vars unset at build time are
 * skipped, so local/CI builds without secrets still pass.
 *
 * Secret hygiene: results never carry the value, only the var name and a
 * found/skipped flag.
 */

/** Public build-time vars whose inlining the deploy verifies when set. */
export const WATCHED_INLINED_VAR_NAMES = [
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "EXPO_PUBLIC_SENTRY_DSN",
  "EXPO_PUBLIC_POSTHOG_KEY",
] as const;

export type BundleInliningResult = {
  name: string;
  status: "inlined" | "missing" | "skipped-unset";
};

/**
 * Check that each watched var set in `env` had its value inlined into
 * `bundleSource`. Empty/whitespace-only values count as unset.
 */
export function checkBundleInlining(
  bundleSource: string,
  env: Record<string, string | undefined>,
  names: readonly string[] = WATCHED_INLINED_VAR_NAMES,
): BundleInliningResult[] {
  return names.map((name) => {
    const value = (env[name] ?? "").trim();
    if (value.length === 0) return { name, status: "skipped-unset" };
    // JSON.stringify mirrors how babel serialises the inlined string literal
    // (quotes + escapes); slice off the quotes so a match inside either a
    // single- or double-quoted bundle literal counts.
    const literal = JSON.stringify(value).slice(1, -1);
    return {
      name,
      status: bundleSource.includes(literal) ? "inlined" : "missing",
    };
  });
}

/**
 * Format results for the deploy log. Never includes values. Returns
 * `{ report, failed }` so the script can exit non-zero on any `missing`.
 */
export function formatBundleInliningReport(results: BundleInliningResult[]): {
  report: string;
  failed: boolean;
} {
  const lines: string[] = [];
  let failed = false;
  for (const r of results) {
    if (r.status === "inlined") lines.push(`${r.name}: [inlined]`);
    else if (r.status === "skipped-unset") lines.push(`${r.name}: [not set — skipped]`);
    else {
      failed = true;
      lines.push(
        `${r.name}: MISSING — the secret was set at build time but its value is absent from the exported bundle. ` +
          "Check for a non-literal process.env access (see lint:env-inlining) or a babel-preset-expo regression.",
      );
    }
  }
  return { report: lines.join("\n"), failed };
}
