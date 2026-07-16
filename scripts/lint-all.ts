#!/usr/bin/env tsx
/**
 * Fans out to every pure code-style guard in `lib/lint-guards.ts` and
 * reports the aggregate. Unlike the old `&&` chain (which stopped at the
 * first failure), every guard runs even after one fails, so a single CI
 * run surfaces ALL findings. Run via `npm run lint:all` locally; `lint:ci`
 * and the ci.yml "Code-style guards" step both delegate here — the
 * registry is the single source of truth for what CI enforces.
 */

import { spawnSync } from "node:child_process";
import * as path from "node:path";

import {
  LINT_GUARDS,
  formatLintAllReport,
  lintAllExitCode,
  type LintGuardResult,
} from "../lib/lint-guards";

const REPO_ROOT = path.join(__dirname, "..");

function runGuard(npmScript: string, scriptPath: string, args: readonly string[]): LintGuardResult {
  const started = Date.now();
  const run = spawnSync("npx", ["tsx", scriptPath, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 300_000,
  });
  const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`.trim();
  return {
    npmScript,
    // A spawn error (missing script, timeout) has status null — treat as failed.
    ok: run.status === 0,
    durationMs: Date.now() - started,
    output,
  };
}

function main(): void {
  console.log(`lint-all: running ${LINT_GUARDS.length} guards…`);
  const results = LINT_GUARDS.map((guard) =>
    runGuard(guard.npmScript, guard.scriptPath, guard.args),
  );

  const report = formatLintAllReport(results);
  const exitCode = lintAllExitCode(results);
  if (exitCode === 0) {
    console.log(report);
    return;
  }
  console.error(report);
  process.exit(exitCode);
}

main();
