#!/usr/bin/env tsx
/**
 * Fails when any 6-digit hex literal slips into `app/**`, `components/**`
 * or `lib/**` (`.ts` and `.tsx` alike). Run via `npm run lint:hex` locally
 * and via `npm run lint:ci` in CI.
 *
 * The few modules that legitimately produce color values (the design-tokens
 * source itself, the deterministic placeholder palette, the standalone HTML
 * templates) are exempted by exact path via `HEX_ALLOWLIST` in
 * `lib/check-inline-hex.ts` — the matcher skips them, so the walk stays dumb.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  findInlineHexLiterals,
  formatGitHubAnnotations,
  formatHexReport,
  type HexMatch,
} from "../lib/check-inline-hex";

const REPO_ROOT = path.join(__dirname, "..");
const SCAN_ROOTS = ["app", "components", "lib"];
const SOURCE_FILE_PATTERN = /\.tsx?$/;

function walkSources(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSources(full, out);
    } else if (entry.isFile() && SOURCE_FILE_PATTERN.test(entry.name)) {
      out.push(full);
    }
  }
}

function main(): void {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    walkSources(path.join(REPO_ROOT, root), files);
  }
  files.sort();

  const allMatches: HexMatch[] = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const rel = path.relative(REPO_ROOT, file);
    allMatches.push(...findInlineHexLiterals(rel, source));
  }

  if (allMatches.length === 0) {
    console.log(`check-inline-hex: scanned ${files.length} file(s), no inline hex literals.`);
    return;
  }

  console.error(formatHexReport(allMatches));
  if (process.env.GITHUB_ACTIONS === "true") {
    // Surface each finding as a line-level annotation on the PR diff.
    for (const annotation of formatGitHubAnnotations(allMatches)) {
      console.log(annotation);
    }
  }
  process.exit(1);
}

main();
