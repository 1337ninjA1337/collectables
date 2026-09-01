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
 * TWO CHECKS, and the second is the reason this is a guard rather than a text
 * scan. The extension rule can be read off the source. Erasability cannot:
 * `node --check` parses a `.ts` file with an `enum` in it quite happily and
 * says nothing, so the only reliable oracle is node's real loader. This spawns
 * it — one `import()` of the entry, in a child, with no tsx anywhere near it,
 * which is precisely what the test runner does.
 */

import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import {
  NATIVE_LOADER_REASON,
  REPORTER_GRAPH_ENTRY,
  formatGraphIssues,
  walkReporterGraph,
} from "../lib/check-reporter-graph";
import { checkError } from "../lib/check-error";
import { GuardRootError } from "../lib/guard-root";
import { ScannedFloorError, assertParsedInputs } from "../lib/scanned-floor";
import { describeThrown } from "../lib/thrown-value";
import { asText, guardScanRoot, readTextInput } from "./guard-io";

const CHECK_NAME = "check-reporter-graph";
const DEFAULT_REPO_ROOT = path.join(__dirname, "..");

/** How long node gets to import three side-effect-free modules. */
const LOAD_TIMEOUT_MS = 30_000;

/**
 * Asks node to import the entry the way the test runner does, and returns its
 * complaint if it has one.
 *
 * `process.execPath` with no loader flags, deliberately: adding `--import tsx`
 * here would resolve everything and prove nothing, since tsx is exactly the
 * thing that is NOT in the picture when the reporter loads.
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
function nodeLoadFailure(repoRoot: string, entry: string): string | null {
  const url = pathToFileURL(path.join(repoRoot, entry)).href;
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("NODE_TEST_")) delete env[key];
  }
  try {
    execFileSync(
      process.execPath,
      ["--input-type=module", "-e", `await import(${JSON.stringify(url)});`],
      {
        cwd: repoRoot,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: LOAD_TIMEOUT_MS,
      },
    );
    return null;
  } catch (error) {
    const failed = error as { stderr?: string };
    // node's own message names the file and the construct; keep the line that
    // says WHICH rule was broken and drop the stack under it, which belongs to
    // the loader rather than to the finding.
    const said = (failed.stderr ?? "")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => /^(SyntaxError|Error|TypeError)\b/.test(line));
    return said ?? describeThrown(error);
  }
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
  const loadFailure = issues.length === 0 ? nodeLoadFailure(repoRoot, REPORTER_GRAPH_ENTRY) : null;
  if (loadFailure) {
    issues.push(`node refused to import ${REPORTER_GRAPH_ENTRY}: ${loadFailure}`);
  }

  if (issues.length === 0) {
    console.log(
      `${CHECK_NAME}: node's own loader imported ${REPORTER_GRAPH_ENTRY} and the ${graph.files.length} file(s) it reaches — ${graph.files.join(", ")}.`,
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
