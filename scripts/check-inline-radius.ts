#!/usr/bin/env tsx
/**
 * Fails when any inline `borderRadius: 999` / `22` / `24` or `gap: 10` /
 * `12` / `8` literal slips into `app/**` or `components/**` — geometry
 * must route through `RADIUS_PILL` / `RADIUS_CARD` / `RADIUS_CARD_LG` /
 * `SPACING_LIST` / `SPACING_CARD` / `SPACING_INLINE` from
 * `lib/design-tokens.ts` (see GEOMETRY_RULES in lib/check-inline-radius.ts).
 * Run via `npm run lint:radius` locally and via `npm run lint:ci` in CI.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  findInlineRadiusLiterals,
  formatRadiusReport,
  type RadiusMatch,
} from "../lib/check-inline-radius";

const REPO_ROOT = path.join(__dirname, "..");
const SCANNED_DIRS = ["app", "components"] as const;
const SOURCE_FILE_PATTERN = /\.tsx?$/;

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (SOURCE_FILE_PATTERN.test(entry.name)) out.push(full);
  }
  return out.sort();
}

function main(): void {
  const files = SCANNED_DIRS.flatMap((dir) =>
    listSourceFiles(path.join(REPO_ROOT, dir)),
  );

  const allMatches: RadiusMatch[] = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const rel = path.relative(REPO_ROOT, file);
    allMatches.push(...findInlineRadiusLiterals(rel, source));
  }

  if (allMatches.length === 0) {
    console.log(
      `check-inline-radius: scanned ${files.length} file(s), no inline geometry literals.`,
    );
    return;
  }

  console.error(formatRadiusReport(allMatches));
  process.exit(1);
}

main();
