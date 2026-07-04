#!/usr/bin/env tsx
/**
 * Fails when any `<TextInput` in `app/**.tsx` or `components/**.tsx` lacks
 * the Clarity mask spread ({...CLARITY_MASK_PROPS} from lib/clarity-mask.ts)
 * or when a raw `<input` element appears at all. Run via
 * `npm run lint:clarity-mask` locally and via `npm run lint:ci` in CI.
 *
 * docs/analytics-platform.md declares "mask all <input>s" as a hard
 * requirement for the Microsoft Clarity session-replay integration — a
 * single forgotten input (e.g. the email-OTP form) would leak what users
 * type into the replay recordings. This step makes the requirement
 * mechanical instead of aspirational.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  findUnmaskedInputs,
  formatClarityMaskReport,
  type ClarityMaskViolation,
} from "../lib/check-clarity-mask";

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

  const violations: ClarityMaskViolation[] = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const rel = path.relative(REPO_ROOT, file);
    violations.push(...findUnmaskedInputs(rel, source));
  }

  if (violations.length === 0) {
    console.log(
      `check-clarity-mask: scanned ${files.length} file(s), every text input is masked.`,
    );
    return;
  }

  console.error(formatClarityMaskReport(violations));
  process.exit(1);
}

main();
