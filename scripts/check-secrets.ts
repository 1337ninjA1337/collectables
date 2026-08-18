#!/usr/bin/env tsx
/**
 * Fails when a known secret pattern appears anywhere in the committed source
 * tree (SEC-14). Run via `npm run lint:secrets` locally, inside `lint:ci`,
 * and as a CI step so a credential can never land in git.
 *
 * The matcher lives in `lib/secret-scan.ts` so it can be unit-tested under
 * `node --test` without touching the filesystem; this wrapper only walks the
 * tree and prints the report.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  formatSecretReport,
  scanForSecrets,
  type SecretMatch,
} from "../lib/secret-scan";
import { GuardRootError } from "../lib/guard-root";
import { ScannedFloorError, assertScannedFloor } from "../lib/scanned-floor";
import { guardScanRoot, listFilesUnder } from "./guard-io";

const CHECK_NAME = "check-secrets";
const DEFAULT_REPO_ROOT = path.join(__dirname, "..");

/** Directories never worth scanning (build output, deps, vcs metadata). */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".expo",
  "coverage",
  "web-build",
]);

/** Only text formats that could plausibly carry a pasted credential. */
const SCAN_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".sql",
  ".sh",
  ".html",
  ".txt",
]);

/**
 * Files exempt from scanning: the scanner's own sources and tests embed the
 * patterns and sample strings by definition. `package-lock.json` carries
 * opaque integrity hashes and is machine-generated.
 */
const SKIP_FILES = new Set(
  [
    "lib/secret-scan.ts",
    "scripts/check-secrets.ts",
    "scripts/check-bundle-secrets.ts",
    "__tests__/secret-scan.test.ts",
    "package-lock.json",
  ].map((p) => path.normalize(p)),
);

function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);
  // The skip list is applied after the walk rather than inside it: it names
  // FILES, and a walk that knows about individual files is a walk with a
  // second rule in it.
  const files = listFilesUnder(repoRoot, {
    extensions: SCAN_EXTENSIONS,
    skipDirs: SKIP_DIRS,
  }).filter((rel) => !SKIP_FILES.has(path.normalize(rel)));

  // "scanned 0 file(s), no committed secrets" is the report an unreadable
  // repo root produces, and it exits 0. Assert the premise first.
  assertScannedFloor(CHECK_NAME, files.length);

  const matches: SecretMatch[] = [];
  for (const rel of files) {
    let source: string;
    try {
      source = fs.readFileSync(path.join(repoRoot, rel), "utf8");
    } catch {
      continue;
    }
    matches.push(...scanForSecrets(rel, source));
  }

  if (matches.length === 0) {
    console.log(
      `${CHECK_NAME}: scanned ${files.length} file(s), no committed secrets.`,
    );
    return;
  }

  console.error(formatSecretReport(matches));
  process.exit(1);
}

try {
  main();
} catch (error) {
  if (error instanceof ScannedFloorError || error instanceof GuardRootError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
