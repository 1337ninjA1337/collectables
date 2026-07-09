#!/usr/bin/env tsx
/**
 * Fails when any `lib/*-config.ts` resolver receives `process.env` whole
 * (e.g. `process.env as Record<`, `(process.env)`) instead of a literal
 * `readFooEnvFromProcess()` member-access helper. Run via
 * `npm run lint:env-inlining` locally and via `npm run lint:ci` in CI.
 *
 * Metro / babel-preset-expo only inlines literal `process.env.EXPO_PUBLIC_*`
 * member expressions; a whole-object pass ships `undefined` values in the
 * production bundle even when the secret was set in CI.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  findWholeProcessEnvUsages,
  formatEnvInliningReport,
  type EnvInliningMatch,
} from "../lib/env-inlining";

const REPO_ROOT = path.join(__dirname, "..");
const CONFIG_FILE_PATTERN = /-config\.ts$/;

function listConfigFiles(): string[] {
  const libDir = path.join(REPO_ROOT, "lib");
  return fs
    .readdirSync(libDir)
    .filter((name) => CONFIG_FILE_PATTERN.test(name))
    .sort()
    .map((name) => path.join(libDir, name));
}

function main(): void {
  const files = listConfigFiles();

  const allMatches: EnvInliningMatch[] = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const rel = path.relative(REPO_ROOT, file);
    allMatches.push(...findWholeProcessEnvUsages(rel, source));
  }

  if (allMatches.length === 0) {
    console.log(
      `check-env-inlining: scanned ${files.length} file(s), no whole-process.env usages.`,
    );
    return;
  }

  console.error(formatEnvInliningReport(allMatches));
  process.exit(1);
}

main();
