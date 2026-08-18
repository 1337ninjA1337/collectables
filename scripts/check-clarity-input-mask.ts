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
import { MARKUP_EXTENSIONS } from "../lib/source-dirs";
import { guardScanRoot, listSourceFiles } from "./guard-io";

const CHECK_NAME = "check-clarity-input-mask";
const DEFAULT_REPO_ROOT = path.join(__dirname, "..");
const SCANNED_DIRS = ["app", "components"] as const;

function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);
  const files: Record<string, string> = {};
  for (const relative of listSourceFiles(repoRoot, SCANNED_DIRS, MARKUP_EXTENSIONS)) {
    files[relative] = fs.readFileSync(path.join(repoRoot, relative), "utf8");
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
