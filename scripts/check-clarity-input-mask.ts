#!/usr/bin/env tsx
/**
 * Fails when a `.tsx` file under `app/` or `components/` renders a raw
 * `<TextInput` / `<input` without the Microsoft Clarity masking attribute —
 * an unmasked input would be recorded verbatim by Clarity session replay.
 * Use `MaskedTextInput` (components/masked-text-input.tsx) instead.
 * Run via `npm run lint:clarity-mask` locally and in CI (`lint:ci`).
 *
 * The rules live in `lib/check-clarity-input-mask.ts` so they can be
 * unit-tested under `node --test` without touching the filesystem.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  findClarityMaskViolations,
  formatClarityMaskReport,
} from "../lib/check-clarity-input-mask";
import { GuardRootError } from "../lib/guard-root";
import { ScannedFloorError, assertScannedFloor } from "../lib/scanned-floor";
import { guardScanRoot, listDirEntries } from "./guard-io";

const CHECK_NAME = "check-clarity-input-mask";
const DEFAULT_REPO_ROOT = path.join(__dirname, "..");
const SCAN_DIRS = ["app", "components"];

function collectTsxFiles(dir: string, out: string[]): void {
  for (const entry of listDirEntries(dir)) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectTsxFiles(full, out);
    else if (entry.isFile() && entry.name.endsWith(".tsx")) out.push(full);
  }
}

function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);
  const files: Record<string, string> = {};
  for (const dir of SCAN_DIRS) {
    const paths: string[] = [];
    collectTsxFiles(path.join(repoRoot, dir), paths);
    for (const full of paths) {
      const relative = path.relative(repoRoot, full).split(path.sep).join("/");
      files[relative] = fs.readFileSync(full, "utf8");
    }
  }

  assertScannedFloor(CHECK_NAME, Object.keys(files).length);

  const violations = findClarityMaskViolations(files);

  if (violations.length === 0) {
    console.log(
      `${CHECK_NAME}: ${Object.keys(files).length} file(s) scanned, every input masked.`,
    );
    return;
  }

  console.error(formatClarityMaskReport(violations));
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
