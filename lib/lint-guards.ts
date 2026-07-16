/**
 * Single source of truth for the repo's pure code-style guards — the
 * lint scanners that need nothing but the working tree (no build output,
 * no network, no test runner). `scripts/lint-all.ts` fans out to every
 * entry and reports the aggregate, `lint:ci` and the ci.yml "Code-style
 * guards" step run that aggregator, and `__tests__/lint-guards.test.ts`
 * pins the registry ↔ package.json ↔ ci.yml parity — so adding a guard
 * here is the ONE change that enforces it everywhere.
 *
 * Node-pure on purpose: imported by the aggregator CLI and by node tests.
 */

export interface LintGuard {
  /** Stable identifier, also the npm script name (`npm run <npmScript>`). */
  readonly npmScript: string;
  /** Repo-relative path of the tsx CLI wrapper the guard runs. */
  readonly scriptPath: string;
  /** Extra CLI args (e.g. `--check` for generator-backed drift guards). */
  readonly args: readonly string[];
  /** One-line summary mirroring the guard's own doc comment. */
  readonly description: string;
}

export const LINT_GUARDS: readonly LintGuard[] = [
  {
    npmScript: "lint:hex",
    scriptPath: "scripts/check-inline-hex.ts",
    args: [],
    description:
      "No inline hex color literals — colors route through lib/design-tokens.ts",
  },
  {
    npmScript: "lint:radius",
    scriptPath: "scripts/check-inline-radius.ts",
    args: [],
    description:
      "No inline geometry literals (borderRadius 999/22/24, gap 10/12/8) — use RADIUS_*/SPACING_* tokens",
  },
  {
    npmScript: "lint:env-inlining",
    scriptPath: "scripts/check-env-inlining.ts",
    args: [],
    description:
      "No whole-process.env passes into lib/*-config.ts resolvers — Metro only inlines literal member access",
  },
  {
    npmScript: "lint:analytics-imports",
    scriptPath: "scripts/check-analytics-imports.ts",
    args: [],
    description:
      "No direct analytics-events imports from UI code — the taxonomy is consumed via lib/analytics.ts",
  },
  {
    npmScript: "lint:clarity-mask",
    scriptPath: "scripts/check-clarity-input-mask.ts",
    args: [],
    description:
      "Every text input goes through the Clarity-masked wrapper so session replays never capture raw input",
  },
  {
    npmScript: "lint:migration-docs",
    scriptPath: "scripts/check-migration-docs.ts",
    args: [],
    description:
      "Every supabase/migrations file is documented in MANUAL-TASKS.md",
  },
  {
    npmScript: "lint:migration-naming",
    scriptPath: "scripts/check-supabase-migration-naming.ts",
    args: [],
    description: "Migration filenames follow the naming convention",
  },
  {
    npmScript: "lint:secrets",
    scriptPath: "scripts/check-secrets.ts",
    args: [],
    description: "No committed secrets in the source tree",
  },
  {
    npmScript: "lint:appstore",
    scriptPath: "scripts/check-appstore-config.ts",
    args: [],
    description: "App Store config pre-flight (app.json identifiers, icons, permissions strings)",
  },
  {
    npmScript: "lint:sentry-version",
    scriptPath: "scripts/check-sentry-version.ts",
    args: [],
    description: "Sentry SDK major stays pinned to the vetted range",
  },
  {
    npmScript: "lint:powerbi-doc",
    scriptPath: "scripts/generate-powerbi-schema-doc.ts",
    args: ["--check"],
    description:
      "docs/powerbi-connection.md schema table matches ANALYTICS_EVENTS (drift fails, regenerate via powerbi:schema-doc)",
  },
] as const;

/**
 * `lint:*` package.json scripts deliberately OUTSIDE the aggregator, with
 * the reason each cannot be a pure working-tree guard. The registry test
 * asserts every `lint:*` script is either a LINT_GUARDS entry or listed
 * here — a new guard can't silently dodge the aggregate.
 */
export const LINT_ALL_EXEMPT: Readonly<Record<string, string>> = {
  lint: "expo lint (ESLint) — separate toolchain, run on demand",
  "lint:ci": "the CI orchestrator that runs lint:all itself",
  "lint:all": "the aggregator itself",
  "lint:secrets:bundle": "needs the exported dist/ web bundle from npm run build",
  "lint:bundle-size": "needs the exported dist/ web bundle from npm run build",
  "lint:peer-dep-free":
    "a node:test invocation — already part of the npm test suite",
  "lint:expo-install":
    "network-dependent (npm registry) — its own advisory CI step",
};

export interface LintGuardResult {
  readonly npmScript: string;
  readonly ok: boolean;
  readonly durationMs: number;
  /** Combined stdout+stderr of the guard run (trimmed). */
  readonly output: string;
}

/** The exact package.json script command a registry entry expects. */
export function expectedNpmScriptCommand(guard: LintGuard): string {
  return ["tsx", guard.scriptPath, ...guard.args].join(" ");
}

/**
 * Aggregate report: one status line per guard, then the captured output of
 * every failing guard (a `&&` chain stops at the first failure — the whole
 * point of the aggregator is seeing ALL failures in one run).
 */
export function formatLintAllReport(
  results: readonly LintGuardResult[],
): string {
  const lines = results.map(
    (r) =>
      `${r.ok ? "✓" : "✗"} ${r.npmScript} (${r.durationMs}ms)`,
  );
  const failed = results.filter((r) => !r.ok);
  for (const failure of failed) {
    lines.push("", `--- ${failure.npmScript} output ---`, failure.output);
  }
  const passed = results.length - failed.length;
  lines.push(
    "",
    failed.length === 0
      ? `lint-all: ${passed}/${results.length} guards passed.`
      : `lint-all: ${passed}/${results.length} guards passed — failed: ${failed
          .map((r) => r.npmScript)
          .join(", ")}`,
  );
  return lines.join("\n");
}

/** Non-zero when any guard failed (or nothing ran — a broken fan-out must not pass). */
export function lintAllExitCode(results: readonly LintGuardResult[]): 0 | 1 {
  if (results.length === 0) return 1;
  return results.every((r) => r.ok) ? 0 : 1;
}
