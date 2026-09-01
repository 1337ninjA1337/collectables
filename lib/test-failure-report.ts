/**
 * Which test failed, said once, at the end of the run.
 *
 * WHY THIS EXISTS. On PR #473 the `test` job reported `# fail 1` of 7213 and
 * the failing case could not be named. `npm test` runs node's `tap` reporter,
 * which prints `not ok <n> - <name>` inline at the moment of failure and then
 * summarises in the trailer with COUNTS only — so the one line carrying the
 * name sits somewhere inside a 146-second run's log, thousands of lines above
 * the end, and every log reader that returns a tail returns the trailer
 * instead. The run said a test failed and refused to say which. Re-running was
 * the only diagnosis available, and it passed, which ended the investigation
 * without answering it.
 *
 * The fix is not a different reporter — tap's inline detail is worth keeping,
 * and CI's own annotations read it. It is a SECOND reporter that stays silent
 * for the whole run and then writes the failures, and only the failures, as
 * the last thing in the log. A tail of any length now contains the names.
 *
 * This module is the fold: events in, a report out, no I/O and no process
 * state. `scripts/test-failure-reporter.ts` is the twelve lines that hand it
 * node's event stream and print what it returns.
 *
 * Node-pure on purpose (`node:path` and one text helper): imported by the
 * reporter, which node loads before any suite runs, and by the suite that
 * pins its behaviour.
 */

import * as path from "node:path";

// The `.ts` extension is load-bearing and must not be tidied away. Node's test
// runner imports a custom reporter through the DEFAULT loader — `tsx`'s resolve
// hook is not applied to it, verified by a link-time ERR_MODULE_NOT_FOUND on
// this exact specifier written extensionless — so this module and everything it
// pulls in are read by node's native type stripping, which does no extension
// inference at all. `scripts/test-failure-reporter.ts` says the same thing on
// its own import. `allowImportingTsExtensions` in tsconfig.json is what lets
// tsc agree.
import { describeThrown } from "./thrown-value.ts";

/**
 * The subset of a `test:*` reporter event this fold reads.
 *
 * Deliberately structural rather than an import of node's own
 * `TestEvent` type: the reporter contract is "an async iterable of objects
 * with a `type` and a `data`", the fields below are the ones documented as
 * stable, and typing against the full internal shape would couple this to a
 * node minor. Everything is optional because a malformed or future event must
 * fold to "nothing to report" rather than throw INSIDE the reporter that is
 * supposed to explain a failure.
 */
export interface TestReportEvent {
  readonly type: string;
  readonly data?: {
    readonly name?: unknown;
    readonly file?: unknown;
    readonly nesting?: unknown;
    readonly details?: {
      readonly type?: unknown;
      readonly error?: unknown;
    };
  };
}

/** One leaf test that failed, with the suite path that leads to it. */
export interface TestFailure {
  /** Repo-relative when the collector was given a root, absolute otherwise. */
  readonly file: string;
  /** Ancestor suite names, outermost first, ending with the test's own name. */
  readonly path: readonly string[];
  /** First line of whatever the case threw. */
  readonly message: string;
}

/**
 * The two ways node says "this node failed because something BELOW it did".
 *
 * A failing `it` inside two `describe`s produces three `test:fail` events: the
 * case, then each enclosing suite. Reporting all three would name the suite
 * twice and the case once, which is the noise this report exists to cut
 * through — so aggregates are dropped and only leaves are kept.
 *
 * The test is on the failure REASON (`failureType`) and NOT on how the node was
 * declared (`details.type`, `"suite"` vs `"test"`), because those two disagree
 * on the case that matters: a `describe` whose own body throws is
 * `type: "suite"` with a `testCodeFailure`, nothing below it will ever be
 * reported, and dropping it by declared type would lose the only event naming
 * it. Every node dropped here is one whose children are reported instead.
 */
const AGGREGATE_FAILURE_TYPE = "subtestsFailed";

/** True when the event describes a node that failed only because a child did. */
export function isAggregateFailure(event: TestReportEvent): boolean {
  const error = event.data?.details?.error as { failureType?: unknown } | undefined;
  return error?.failureType === AGGREGATE_FAILURE_TYPE;
}

/**
 * What to print for a failed case.
 *
 * `error` is node's `ERR_TEST_FAILURE` wrapper; the thing the case actually
 * threw is its `cause`. The wrapper's own message is a restatement
 * ("test failed"), so the cause is preferred and the wrapper is the fallback
 * for the shapes that carry no cause (a timeout, a cancelled test).
 */
export function failureMessage(event: TestReportEvent): string {
  const error = event.data?.details?.error;
  const cause = (error as { cause?: unknown } | null | undefined)?.cause;
  return describeThrown(cause ?? error);
}

const asString = (value: unknown): string => (typeof value === "string" ? value : "");
const asNesting = (value: unknown): number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;

export interface FailureCollector {
  /** Feed one reporter event. Never throws. */
  observe(event: TestReportEvent): void;
  /** The leaf failures seen so far, in the order they failed. */
  failures(): readonly TestFailure[];
}

/**
 * Folds a reporter event stream into the list of leaf failures.
 *
 * THE ANCESTRY IS REBUILT FROM `test:start`, not from the failure events,
 * because a suite's own `test:fail` arrives AFTER its children's — by the time
 * a case fails, nothing has yet told the reporter which `describe` it is in.
 * `test:start` arrives outermost-first, so keeping the last started name at
 * each nesting level gives the enclosing path at the moment a leaf fails.
 *
 * The stack is keyed BY FILE because node runs suites in concurrent child
 * processes and their events interleave in the parent: one shared stack would
 * report a case under a `describe` from a different file, which is worse than
 * reporting no path at all.
 *
 * @param relativeTo Directory to report file paths against — the repo root, in
 * practice. Omitted, paths stay as node reported them (absolute).
 */
export function createFailureCollector(relativeTo?: string): FailureCollector {
  const startedAt = new Map<string, string[]>();
  const failures: TestFailure[] = [];

  const displayFile = (file: string): string => {
    if (file === "") return "(unknown file)";
    return relativeTo ? path.relative(relativeTo, file) || file : file;
  };

  return {
    observe(event: TestReportEvent): void {
      if (event.type !== "test:start" && event.type !== "test:fail") return;
      const file = asString(event.data?.file);
      const name = asString(event.data?.name);
      const nesting = asNesting(event.data?.nesting);

      if (event.type === "test:start") {
        const stack = startedAt.get(file) ?? [];
        // Truncate first: a sibling starting at depth N invalidates every
        // name recorded below N by the previous sibling's subtree.
        stack.length = nesting;
        stack[nesting] = name;
        startedAt.set(file, stack);
        return;
      }

      if (isAggregateFailure(event)) return;
      // One entry per level of nesting, whatever the stack turned out to hold.
      // A level with no name — because its `test:start` was never seen, or
      // because the stack is shorter than the failure's own depth — is written
      // as "?" rather than skipped: the reader learns there is an enclosing
      // suite that could not be named, and the path's length keeps meaning the
      // case's depth. Skipping would render `outer › case` for something two
      // levels down, which is a wrong answer rather than a partial one.
      const stack = startedAt.get(file) ?? [];
      const trail: string[] = [];
      for (let depth = 0; depth < nesting; depth += 1) trail.push(stack[depth] ?? "?");
      // The leaf name comes from the failure event rather than the stack, so a
      // missed `test:start` costs the ancestry and not the case's identity.
      trail.push(name);
      failures.push({ file: displayFile(file), path: trail, message: failureMessage(event) });
    },
    failures(): readonly TestFailure[] {
      return failures;
    },
  };
}

/** Header the report opens with — exported so the suite can assert on it. */
export const FAILURE_REPORT_HEADING = "FAILING TESTS";

/** How a failure's suite path is joined into one line. */
export const FAILURE_PATH_SEPARATOR = " › ";

/**
 * The block written after the run, or `""` when nothing failed.
 *
 * Empty on success is the whole contract for a green run: this reporter shares
 * a log with tap's output and must add exactly nothing to it until there is
 * something to say.
 */
export function formatFailureReport(failures: readonly TestFailure[]): string {
  if (failures.length === 0) return "";
  const rule = "─".repeat(72);
  const lines = [
    "",
    rule,
    `${FAILURE_REPORT_HEADING} (${failures.length})`,
    rule,
  ];
  failures.forEach((failure, index) => {
    lines.push(`${index + 1}) ${failure.file}`);
    lines.push(`   ${failure.path.join(FAILURE_PATH_SEPARATOR)}`);
    lines.push(`   ${failure.message}`);
  });
  lines.push(rule, "");
  return lines.join("\n");
}
