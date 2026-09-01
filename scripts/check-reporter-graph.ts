#!/usr/bin/env tsx
/**
 * Fails when the test reporter's module graph stops being loadable by node's
 * OWN loader — an import tidied to its extensionless spelling, or a file in
 * the graph gaining syntax that strip-only mode cannot erase. Both take the
 * ENTIRE suite run down at link time, so the suite cannot be the thing that
 * catches them; `lint:all` runs first and this is where it gets said.
 * See `lib/check-reporter-graph.ts` for why the graph is constrained at all.
 *
 * Run via `npm run lint:reporter-graph` locally and as part of `lint:ci`.
 *
 * TWO READINGS OF THE GRAPH, and neither is redundant.
 *
 * The TEXT WALK is a scan for repo-local specifiers. It is the only half that
 * can report every broken import in one run — node's loader stops at the
 * first — and the only half that works on a tree which does not load at all.
 *
 * The MEASURED graph is node importing the entry for real, with
 * `scripts/record-loaded-files.ts` registered as a loader hook printing each
 * file it resolves. This is the only half that can answer the erasability
 * question: `node --check` parses a `.ts` file with an `enum` in it quite
 * happily and exits 0, so a guard built on a syntax check would be green on
 * the exact change it exists to catch. It is also the guard's audit of its own
 * cheaper half — a file node loaded that the walk never reached means the
 * walk's findings are incomplete, and `missingFromWalk` says so rather than
 * letting the guard quietly check less than it reports.
 */

import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import {
  NATIVE_LOADER_REASON,
  REPORTER_GRAPH_ENTRY,
  formatGraphIssues,
  missingFromWalk,
  parseLoadedFiles,
  walkReporterGraph,
} from "../lib/check-reporter-graph";
import { checkError } from "../lib/check-error";
import { GuardRootError } from "../lib/guard-root";
import { ScannedFloorError, assertParsedInputs } from "../lib/scanned-floor";
import { describeThrown } from "../lib/thrown-value";
import { asText, guardScanRoot, readTextInput } from "./guard-io";

const CHECK_NAME = "check-reporter-graph";
const DEFAULT_REPO_ROOT = path.join(__dirname, "..");

/** The loader hook that turns the spawned import into a file list. */
const RECORDER_SCRIPT = "scripts/record-loaded-files.ts";

/** How long node gets to import three side-effect-free modules. */
const LOAD_TIMEOUT_MS = 30_000;

/** What the spawned import came back with: a complaint, or the files it loaded. */
type LoadOutcome =
  | { readonly kind: "failed"; readonly said: string }
  | { readonly kind: "loaded"; readonly files: readonly string[] };

/**
 * Imports the entry the way the test runner does, with the recorder attached.
 *
 * `process.execPath` with no loader flags beyond the recorder, deliberately:
 * adding `--import tsx` here would resolve everything and prove nothing, since
 * tsx is exactly the thing that is NOT in the picture when the reporter loads.
 *
 * `spawnSync` rather than `execFileSync`, and the difference is load-bearing:
 * the recorder writes on STDERR, which `execFileSync` hands back only on the
 * throwing path. Reading the measurement off a failure would mean the guard
 * could measure the graph only when it was broken.
 *
 * The environment is stripped of `NODE_TEST_*` because this guard is itself
 * spawned from the suites (`lint-guard-premise.test.ts` runs every registry
 * entry), and an inherited `NODE_TEST_CONTEXT` makes a child believe it is
 * part of a test run — the same variable that made this repo's first spawned
 * reporter case assert against a run that never used the reporter.
 *
 * The modules in this graph are pure: constants, functions, no top-level work.
 * Importing them is the check, and it has no side effect to undo.
 */
function importWithRecorder(repoRoot: string, entry: string): LoadOutcome {
  const url = pathToFileURL(path.join(repoRoot, entry)).href;
  const recorder = pathToFileURL(path.join(repoRoot, RECORDER_SCRIPT)).href;
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("NODE_TEST_")) delete env[key];
  }
  const program =
    'import { register } from "node:module";\n' +
    `register(${JSON.stringify(recorder)});\n` +
    `await import(${JSON.stringify(url)});\n`;

  const run = spawnSync(process.execPath, ["--input-type=module", "-e", program], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: LOAD_TIMEOUT_MS,
  });
  const stderr = run.stderr ?? "";

  if (run.error) return { kind: "failed", said: describeThrown(run.error) };
  if (run.status !== 0) {
    // node's own message names the file and the construct; keep the line that
    // says WHICH rule was broken and drop the stack under it, which belongs to
    // the loader rather than to the finding.
    const said = stderr
      .split("\n")
      .map((line) => line.trim())
      .find((line) => /^(SyntaxError|Error|TypeError)\b/.test(line));
    return { kind: "failed", said: said ?? `node exited ${String(run.status)}` };
  }
  return { kind: "loaded", files: parseLoadedFiles(stderr, repoRoot) };
}

function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);

  const entryText = readTextInput(path.join(repoRoot, REPORTER_GRAPH_ENTRY));
  // Spelled out rather than `[REPORTER_GRAPH_ENTRY]:`, and the literal is the
  // point: `scanned-floor.test.ts` reads every wrapper's source for the input
  // names its floor declares, because a computed key satisfies the floor at
  // run time while leaving nothing a reader (or that guard) can match.
  assertParsedInputs(CHECK_NAME, { "scripts/test-failure-reporter.ts": entryText });

  const graph = walkReporterGraph((relative) => {
    const value = readTextInput(path.join(repoRoot, relative));
    return typeof value === "string" ? asText(value) : null;
  });

  const issues = formatGraphIssues(graph);
  // Only when the walk is clean: a broken specifier means the import cannot
  // get far enough for its file list to describe anything.
  const outcome = issues.length === 0 ? importWithRecorder(repoRoot, REPORTER_GRAPH_ENTRY) : null;

  if (outcome?.kind === "failed") {
    issues.push(`node refused to import ${REPORTER_GRAPH_ENTRY}: ${outcome.said}`);
  }

  const loaded = outcome?.kind === "loaded" ? outcome.files : [];
  if (outcome?.kind === "loaded") {
    if (loaded.length === 0) {
      // The recorder printing nothing is the vacuous pass this whole fleet is
      // built to refuse: the import succeeded, so "the graph is empty" is a
      // broken measurement rather than a clean tree.
      issues.push(
        `the loader hook ${RECORDER_SCRIPT} recorded no files, though the import succeeded — the measurement is broken, not the graph`,
      );
    }
    for (const file of missingFromWalk(graph.files, loaded)) {
      issues.push(
        `node loaded ${file}, which the text walk never reached — the walk's findings are incomplete, so a broken import in that file would go unreported`,
      );
    }
  }

  if (issues.length === 0) {
    console.log(
      `${CHECK_NAME}: node's own loader imported ${REPORTER_GRAPH_ENTRY} and the ${loaded.length} file(s) it reaches — ${loaded.join(", ")}.`,
    );
    return;
  }

  console.error(
    checkError(
      CHECK_NAME,
      `the test reporter's module graph is not loadable by node's own loader, which would take the whole \`npm test\` run down before any suite ran (${NATIVE_LOADER_REASON}):\n` +
        issues.map((issue) => `    ${issue}`).join("\n"),
    ),
  );
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
