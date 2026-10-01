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
 *
 * It also fails when a provider's value factory cannot be READ, which for the
 * rule's first days was silently the same as "this file has nothing of mine in
 * it". Three of the eleven providers were in that state.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  type ContextArrayFinding,
  type ProviderReading,
  contextArrayAnnotations,
  formatContextArrayReport,
  readProvider,
} from "../lib/check-context-array-stability";
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
 * Twenty array-typed fields across five context values today. A run that
 * found NO array field at all has not proved the rule — it has lost its
 * subject, which is what a rename of the value types, a move out of `lib/`, or
 * a formatting change the type walk cannot read would look like from in here.
 * One, not twenty: a provider losing a list is ordinary, and a floor that
 * goes red for it teaches people to edit the floor.
 */
const FIELD_FLOOR = 1;

/**
 * Every provider must be one the readers can READ, and the count is the floor.
 *
 * Eleven files end in `-context.tsx` and for the life of this rule three of
 * them were read as "nothing here": two write a block-bodied factory and one
 * calls its value `api`. The rule printed the same clean line for them as for
 * the eight it checked, which is the failure mode this repository keeps
 * finding — a check with no stated subject is green forever. Both readers
 * cover all eleven now, so an unreadable provider is a FINDING, and a module
 * that declares no context value at all is named in the run's own output
 * rather than counted silently.
 */
const READABLE_PROVIDER_FLOOR = 11;

function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);
  const files = listSourceFiles(repoRoot, SCANNED_DIRS);

  // A walk that lost a scan root proves its negative over a tree with a hole
  // in it, in exactly the same words as a walk that read everything.
  assertScannedWalk(CHECK_NAME, files);

  const providers = files.filter((file) => file.endsWith(CONTEXT_SUFFIX));
  const readings: ProviderReading[] = providers.map((file) =>
    readProvider(file, fs.readFileSync(path.join(repoRoot, file), "utf8")),
  );
  const found: ContextArrayFinding[] = readings.flatMap((reading) => [...reading.findings]);
  const fields = readings.reduce((total, reading) => total + reading.fields.length, 0);
  const read = readings.filter((reading) => reading.verdict === "read");
  const subjectless = readings.filter((reading) => reading.verdict === "no-context-value");

  // Said on every run, pass or fail: the three answers this guard can give are
  // "checked", "could not read" and "no context value here", and the last two
  // used to be spelled the same way as the first.
  for (const reading of subjectless) {
    console.log(`${CHECK_NAME}: ${reading.file} declares no context value type — nothing here for this rule.`);
  }

  if (read.length < READABLE_PROVIDER_FLOOR) {
    console.error(
      `${CHECK_NAME}: read ${read.length} provider(s) of ${providers.length}, and the floor is ${READABLE_PROVIDER_FLOOR}. A provider this rule cannot read is not a provider it has checked. Either the readers need widening for a new shape, or a provider left \`lib/\` — the findings above name which.`,
    );
    if (found.length > 0) console.error(formatContextArrayReport(found));
    process.exit(1);
  }

  if (fields < FIELD_FLOOR) {
    console.error(
      `${CHECK_NAME}: scanned ${files.length} file(s), read ${providers.length} provider(s) and found no array-typed context field at all — this guard has lost its subject, not proved its rule. Check whether the value types were renamed or the providers moved.`,
    );
    process.exit(1);
  }

  if (found.length === 0) {
    console.log(
      `${CHECK_NAME}: scanned ${files.length} file(s), read ${read.length} of ${providers.length} provider(s), ${fields} array-typed field(s), all memoized on their own dependencies.`,
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
