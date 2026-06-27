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

const REPO_ROOT = path.join(__dirname, "..");

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

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      const rel = path.relative(REPO_ROOT, full);
      if (!SCAN_EXTENSIONS.has(ext)) continue;
      if (SKIP_FILES.has(path.normalize(rel))) continue;
      out.push(full);
    }
  }
}

function main(): void {
  const files: string[] = [];
  walk(REPO_ROOT, files);
  files.sort();

  const matches: SecretMatch[] = [];
  for (const file of files) {
    let source: string;
    try {
      source = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const rel = path.relative(REPO_ROOT, file);
    matches.push(...scanForSecrets(rel, source));
  }

  if (matches.length === 0) {
    console.log(
      `check-secrets: scanned ${files.length} file(s), no committed secrets.`,
    );
    return;
  }

  console.error(formatSecretReport(matches));
  process.exit(1);
}

main();
