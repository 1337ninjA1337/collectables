#!/usr/bin/env tsx
/**
 * Fails when a `<Pressable>` in `app/**` or `components/**` is an icon and
 * nothing else with no `accessibilityLabel`, or carries one written as a bare
 * string literal instead of a `t()` call, or when any element is hidden from
 * assistive technology on one platform but not the other. Run via
 * `npm run lint:a11y-jsx` locally and via `npm run lint:ci` in CI.
 *
 * Walks the two roots that render UI, `.tsx` only: a rule about what a screen
 * reader announces has nothing to say about a `.ts` helper, which is the same
 * narrowing `check-clarity-input-mask` makes and for the same reason.
 *
 * The matching itself is `lib/check-a11y-jsx.ts`, which is where the
 * reasoning about JSX tag parsing lives — this half is the walk and the exit
 * status.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  findUnlabeledIconButtons,
  formatIconLabelReport,
  type IconLabelFinding,
} from "../lib/check-a11y-jsx";
import { GuardRootError } from "../lib/guard-root";
import { ScannedFloorError, assertScannedFloor } from "../lib/scanned-floor";
import { MARKUP_EXTENSIONS } from "../lib/source-dirs";
import { guardScanRoot, listSourceFiles } from "./guard-io";

const CHECK_NAME = "check-a11y-jsx";
const DEFAULT_REPO_ROOT = path.join(__dirname, "..");
const SCANNED_DIRS = ["app", "components"] as const;

function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);
  const files = listSourceFiles(repoRoot, SCANNED_DIRS, MARKUP_EXTENSIONS);

  // A walk that lost a scan root reports "every icon button is named" in
  // exactly the same words as a walk that read everything.
  assertScannedFloor(CHECK_NAME, files.length);

  const findings: IconLabelFinding[] = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(repoRoot, file), "utf8");
    findings.push(...findUnlabeledIconButtons(file, source));
  }

  if (findings.length === 0) {
    console.log(
      `${CHECK_NAME}: scanned ${String(files.length)} screen file(s), every icon-only Pressable is named, every name is localized, every hidden node is hidden on iOS, Android and the web, every icon is hidden or named, and every disabled button says so.`,
    );
    return;
  }

  console.error(formatIconLabelReport(findings));
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
