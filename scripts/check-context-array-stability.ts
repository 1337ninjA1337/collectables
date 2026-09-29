#!/usr/bin/env tsx
/**
 * Fails when an array-typed field of a `*ContextValue` in `lib/` is built
 * inside the provider's value factory instead of being memoized on its own
 * dependencies. Run via `npm run lint:context-arrays` locally and as part of
 * `lint:all`.
 *
 * The rule and the reason it is worth having live in
 * `lib/check-context-array-stability.ts`. The short version: the value factory
 * is itself a `useMemo` with a twenty-name dependency list, so an array built
 * inside it gets a fresh identity on any unrelated context update — and
 * `lint:chunked-items` accepts every consumer of such an array as stable
 * because a provider is supposed to have done this.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  type ContextArrayFinding,
  arrayFields,
  contextArrayAnnotations,
  contextValueType,
  findContextArrayRisks,
  formatContextArrayReport,
} from "../lib/check-context-array-stability";
import { scannableCode } from "../lib/declaration-scan";
import { runningUnderActions } from "../lib/github-annotations";
import { GuardRootError } from "../lib/guard-root";
import { ScannedFloorError, assertScannedWalk } from "../lib/scanned-floor";
import { guardScanRoot, listSourceFiles } from "./guard-io";

const CHECK_NAME = "check-context-array-stability";
const DEFAULT_REPO_ROOT = path.join(__dirname, "..");

/**
 * `lib/` alone, which is where every provider in this tree lives.
 *
 * Not the RUNTIME_CODE_DIRS walk the other four guards take: `app/` holds
 * screens and `components/` holds markup, and neither declares a context value.
 * A provider that moved out of `lib/` would be a finding for
 * `lint:ships-to-client` and for the mental model `NON_MARKUP_REASONS` argues
 * about, not a hole in this rule — but the subject floor below is what would
 * actually notice.
 */
const SCANNED_DIRS = ["lib"] as const;

/** Providers are named for what they are, and this is the whole of the rule's reach. */
const CONTEXT_SUFFIX = "-context.tsx";

/**
 * The guard's own subject, floored.
 *
 * Nineteen array-typed fields across four context values today. A run that
 * found NO array field at all has not proved the rule — it has lost its
 * subject, which is what a rename of the value types, a move out of `lib/`, or
 * a formatting change the type walk cannot read would look like from in here.
 * One, not nineteen: a provider losing a list is ordinary, and a floor that
 * goes red for it teaches people to edit the floor.
 */
const FIELD_FLOOR = 1;

function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);
  const files = listSourceFiles(repoRoot, SCANNED_DIRS);

  // A walk that lost a scan root proves its negative over a tree with a hole
  // in it, in exactly the same words as a walk that read everything.
  assertScannedWalk(CHECK_NAME, files);

  const providers = files.filter((file) => file.endsWith(CONTEXT_SUFFIX));
  const found: ContextArrayFinding[] = [];
  let fields = 0;
  for (const file of providers) {
    const source = fs.readFileSync(path.join(repoRoot, file), "utf8");
    const valueType = contextValueType(scannableCode(source));
    if (valueType) fields += arrayFields(valueType.body).length;
    found.push(...findContextArrayRisks(file, source));
  }

  if (fields < FIELD_FLOOR) {
    console.error(
      `${CHECK_NAME}: scanned ${files.length} file(s), read ${providers.length} provider(s) and found no array-typed context field at all — this guard has lost its subject, not proved its rule. Check whether the value types were renamed or the providers moved.`,
    );
    process.exit(1);
  }

  if (found.length === 0) {
    console.log(
      `${CHECK_NAME}: scanned ${files.length} file(s), ${providers.length} provider(s), ${fields} array-typed field(s), all memoized on their own dependencies.`,
    );
    return;
  }

  console.error(formatContextArrayReport(found));
  if (runningUnderActions()) {
    for (const line of contextArrayAnnotations(found)) console.log(line);
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
