#!/usr/bin/env tsx
/**
 * Fails when a `useEffect` depends on a context function its provider rebuilds
 * inside the value factory, unless the pairing is sanctioned with a reason.
 * Run via `npm run lint:context-fn-deps` locally and as part of `lint:all`.
 *
 * The rule and the incident behind it live in `lib/context-function-deps.ts`.
 * The short version: fifty-eight of this tree's eighty-four context function
 * fields are a new closure on every value-factory recompute, and an effect
 * that re-fires does things — the shared-collection save in
 * `app/collection/[id].tsx` queued a network write and mounted a toast per
 * attempt until iOS Safari aborted the tab.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  type EffectDepFinding,
  type EffectDepProblem,
  effectDepAnnotations,
  effectDepProblems,
  effectDepsNaming,
  formatEffectDepReport,
  functionFieldsOf,
} from "../lib/context-function-deps";
import { runningUnderActions } from "../lib/github-annotations";
import { GuardRootError } from "../lib/guard-root";
import { ScannedFloorError, assertScannedWalk } from "../lib/scanned-floor";
import { guardScanRoot, listSourceFiles } from "./guard-io";

const CHECK_NAME = "check-context-function-deps";
const DEFAULT_REPO_ROOT = path.join(__dirname, "..");

/**
 * The first guard here whose two halves live in different roots.
 *
 * The providers it classifies are in `lib/`; the effects it holds to that
 * classification are in `app/` and `components/`, which is where screens are.
 * Spelled as a literal rather than taken from `RUNTIME_CODE_DIRS` for the
 * reason `lint-guard-partial-root.test.ts` reads it out of this file: a root
 * added or dropped here must fail that suite loudly, because its fixtures
 * stop meaning anything the moment the walk covers something they do not.
 */
const SCANNED_DIRS = ["app", "components", "lib"] as const;

/** Providers are named for what they are, and they all live in `lib/`. */
const CONTEXT_SUFFIX = "-context.tsx";

/**
 * The guard's own subject, floored.
 *
 * Fifty-eight factory-built function fields across six providers today. A run
 * that found none at all has not proved the rule — it has lost its subject,
 * which is what a rename of the value types or a move out of `lib/` would look
 * like from in here. Ten, not fifty-eight: providers legitimately move a
 * function to its own `useCallback`, and a floor that goes red for an
 * improvement teaches people to edit the floor.
 */
const VOLATILE_FIELD_FLOOR = 10;

function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);
  const files = listSourceFiles(repoRoot, SCANNED_DIRS);

  // A walk that lost a scan root proves its negative over a tree with a hole
  // in it, in exactly the same words as a walk that read everything.
  assertScannedWalk(CHECK_NAME, files);

  const read = (file: string) => fs.readFileSync(path.join(repoRoot, file), "utf8");
  const fields = files
    .filter((file) => file.endsWith(CONTEXT_SUFFIX))
    .flatMap((file) => functionFieldsOf(file, read(file)));
  const volatileFields = fields.filter((field) => field.supply === "factory-built");
  const volatileNames = new Set(volatileFields.map((field) => field.field));

  if (volatileNames.size < VOLATILE_FIELD_FLOOR) {
    console.error(
      `${CHECK_NAME}: read ${fields.length} function-valued context field(s) and only ${volatileNames.size} of them are built in a value factory, under a floor of ${VOLATILE_FIELD_FLOOR}. Either the providers moved their functions to their own useCallback — in which case lower the floor on purpose — or this guard has lost its subject.`,
    );
    process.exit(1);
  }

  const findings: EffectDepFinding[] = files.flatMap((file) =>
    effectDepsNaming(file, read(file), volatileNames),
  );
  const problems: EffectDepProblem[] = effectDepProblems(findings);

  if (problems.length === 0) {
    console.log(
      `${CHECK_NAME}: scanned ${files.length} file(s), ${volatileNames.size} factory-built context function(s), ${findings.length} effect(s) depending on one — all sanctioned with a reason.`,
    );
    return;
  }

  console.error(formatEffectDepReport(problems));
  if (runningUnderActions()) {
    for (const line of effectDepAnnotations(problems)) console.log(line);
  }
  process.exit(1);
}

try {
  main();
} catch (error) {
  // The floor failure is a guard result, not a crash — print the one line,
  // not a stack trace pointing at a helper the reader did not call.
  if (error instanceof ScannedFloorError || error instanceof GuardRootError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
