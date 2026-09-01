/**
 * The second reporter `npm test` runs: silent for the whole run, then the
 * names of the tests that failed.
 *
 * Node's `--test-reporter` takes a module whose default export consumes the
 * runner's event stream and yields text. This one yields NOTHING until the
 * stream ends — tap owns stdout and the play-by-play; this owns the last lines
 * of the log, which is the only part a truncated CI log reader ever returns.
 * See `lib/test-failure-report.ts` for the failure this closes and why the
 * ancestry has to be rebuilt from `test:start`.
 *
 * Wired in package.json, not in ci.yml, so `npm test` behaves the same way on
 * a laptop as it does in CI — a reporter that only ran in CI would be a
 * diagnosis nobody could reproduce locally.
 *
 * Two things this must never do, both because it is the thing that runs when
 * something has ALREADY gone wrong: throw (it would replace the failure it is
 * reporting with its own), and write on a green run (it would put noise in
 * every passing log, and a reporter people learn to ignore reports nothing).
 */

// Explicit `.ts` extensions, deliberately: node imports a custom reporter with
// the default loader rather than through `tsx`'s hooks, so this file and its
// whole import graph are read by node's native type stripping, which resolves
// no extensions. Written extensionless, the run dies at link time with
// ERR_MODULE_NOT_FOUND before a single suite has started.
import {
  createFailureCollector,
  formatFailureReport,
  type TestReportEvent,
} from "../lib/test-failure-report.ts";
import { describeThrown } from "../lib/thrown-value.ts";

/**
 * `process.cwd()` is the repo root for every entry point that runs the suites
 * (`npm test`, `npm run test:only`, `npm run test:sentry` — npm sets the cwd
 * to the package directory), so failures are reported as `__tests__/x.test.ts`
 * rather than as a runner-machine absolute path a reader cannot paste.
 */
export default async function* testFailureReporter(
  source: AsyncIterable<TestReportEvent>,
): AsyncGenerator<string> {
  const collector = createFailureCollector(process.cwd());
  try {
    for await (const event of source) {
      collector.observe(event);
    }
  } catch (error) {
    // A stream that broke mid-run still has whatever it delivered, and that is
    // more than the trailer ever said. Report the partial list, then say the
    // list is partial — swallowing this would turn a runner-level fault into a
    // green-looking silence from the one component watching for failures.
    yield formatFailureReport(collector.failures());
    yield `\ntest-failure-reporter: the event stream ended early — ${describeThrown(error)}\n`;
    return;
  }
  yield formatFailureReport(collector.failures());
}
