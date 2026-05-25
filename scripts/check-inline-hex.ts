#!/usr/bin/env tsx
/**
 * Fails when any 6-digit hex literal slips into `app/**.tsx` or
 * `components/**.tsx`. Run via `npm run lint:hex` locally and via
 * `npm run lint:ci` in CI.
 *
 * `lib/design-tokens.ts` is the only file allowed to carry hex literals;
 * it is not in the scan roots, so no allowlist is needed.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  findInlineHexLiterals,
  formatHexReport,
  type HexMatch,
} from "../lib/check-inline-hex";

const REPO_ROOT = path.join(__dirname, "..");
const SCAN_ROOTS = ["app", "components"];

function walkTsx(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTsx(full, out);
    } else if (entry.isFile() && full.endsWith(".tsx")) {
      out.push(full);
    }
  }
}

function main(): void {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    walkTsx(path.join(REPO_ROOT, root), files);
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
  process.exit(1);
}

main();
