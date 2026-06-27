#!/usr/bin/env tsx
/**
 * Fails when a real-looking credential value appears in a committed source
 * file or in the built `dist/` web bundle (SEC-14). Run via
 * `npm run lint:secrets` locally + in `npm run lint:ci`, and as a dedicated
 * post-build step in CI so the bundle is scanned with secrets inlined.
 *
 * Two scan surfaces:
 *   1. Committed source — every `git ls-files` text file (respects
 *      `.gitignore`, so `node_modules`/`dist`/`.env` are excluded).
 *   2. Built bundle — `dist/**` JS/HTML/JSON when present (the env-inlined
 *      output where an accidentally-`EXPO_PUBLIC_`-exposed service-role key
 *      would surface). Skipped silently when `dist/` is absent (local lint).
 *
 * Pattern logic lives in `lib/secret-patterns.ts` (pure, unit-tested).
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  scanContentForSecrets,
  formatSecretReport,
  type FileFindings,
} from "../lib/secret-patterns";

const REPO_ROOT = path.join(__dirname, "..");

// Binary / non-text extensions we never scan.
const SKIP_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
  ".pdf",
  ".zip",
  ".lock",
  ".pbix",
  ".pbit",
]);

// The scanner's own pattern/fixture files: their regex sources + concatenated
// fixtures are intentionally crafted not to match, but skip them so a future
// edit can't self-trip the gate.
const SELF_FILES = new Set([
  "lib/secret-patterns.ts",
  "scripts/check-secrets.ts",
  "__tests__/secret-patterns.test.ts",
]);

function listTrackedFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\0").filter(Boolean);
}

function walkDist(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDist(full, out);
    } else if (/\.(js|mjs|cjs|html|json|map|txt)$/.test(entry.name)) {
      out.push(full);
    }
  }
}

function scanFile(absPath: string, relPath: string): FileFindings | null {
  let content: string;
  try {
    content = fs.readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
  const findings = scanContentForSecrets(content);
  return findings.length > 0 ? { file: relPath, findings } : null;
}

function main(): void {
  const results: FileFindings[] = [];

  // 1. Committed source.
  let sourceCount = 0;
  for (const rel of listTrackedFiles()) {
    if (SELF_FILES.has(rel)) continue;
    if (SKIP_EXT.has(path.extname(rel).toLowerCase())) continue;
    const abs = path.join(REPO_ROOT, rel);
    sourceCount++;
    const fileResult = scanFile(abs, rel);
    if (fileResult) results.push(fileResult);
  }

  // 2. Built bundle (if present).
  const distDir = path.join(REPO_ROOT, "dist");
  let bundleCount = 0;
  if (fs.existsSync(distDir)) {
    const distFiles: string[] = [];
    walkDist(distDir, distFiles);
    for (const abs of distFiles) {
      bundleCount++;
      const rel = path.relative(REPO_ROOT, abs);
      const fileResult = scanFile(abs, rel);
      if (fileResult) results.push(fileResult);
    }
  }

  const report = formatSecretReport(results);
  const hasFindings = results.some((r) => r.findings.length > 0);

  if (hasFindings) {
    console.error(report);
    console.error(
      "\nNever commit credentials. Remove the secret, rotate it, and replace " +
        "the value with a placeholder (see CLAUDE.md).",
    );
    process.exit(1);
  }

  console.log(
    `check-secrets: scanned ${sourceCount} tracked file(s)` +
      (fs.existsSync(distDir) ? ` + ${bundleCount} bundle file(s)` : "") +
      ", no secrets detected.",
  );
}

main();
