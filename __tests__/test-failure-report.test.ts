/**
 * The reporter that names the test that failed.
 *
 * PR #473's `test` job reported `# fail 1` of 7213 and could not say which
 * one. tap prints the name inline, thousands of lines before the end of a
 * 146-second log, and summarises in COUNTS — so every log reader that returns
 * a tail returns the counts. The diagnosis available was "re-run it", which
 * passed, which ended the investigation without answering the question.
 *
 * `lib/test-failure-report.ts` folds the runner's event stream into the list
 * of leaf failures and `scripts/test-failure-reporter.ts` writes it, once, at
 * the end of stderr. Three things have to hold and each is a different kind of
 * assertion:
 *
 *  - the FOLD is right (leaves kept, aggregates dropped, ancestry rebuilt from
 *    `test:start` because a suite's own failure event arrives after its
 *    children's) — unit cases over hand-built events;
 *  - the WIRING is right (both reporters and both destinations, on all three
 *    test scripts) — structural assertions on package.json;
 *  - the reporter LOADS AT ALL — a spawned run, because the one bug this file
 *    cannot catch by reading is the one that killed the first draft: node
 *    imports a custom reporter through its DEFAULT loader, not through tsx's
 *    hooks, so an extensionless import in that graph is ERR_MODULE_NOT_FOUND
 *    at link time and takes the whole suite run down with it.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  FAILURE_PATH_SEPARATOR,
  FAILURE_REPORT_HEADING,
  createFailureCollector,
  failureMessage,
  formatFailureReport,
  isAggregateFailure,
  type TestReportEvent,
} from "../lib/test-failure-report";
import { REPO_ROOT, readRepoFile as read } from "./helpers/repo-file";
import { SUITES_REL } from "./helpers/suite-files";

/** The `ERR_TEST_FAILURE` wrapper node puts around whatever a case threw. */
const wrapped = (failureType: string, message: string, cause?: unknown): Error =>
  Object.assign(new Error(message), { code: "ERR_TEST_FAILURE", failureType, cause });

const leafError = (cause: unknown) => wrapped("testCodeFailure", "test failed", cause);
const aggregateError = (n: number) => wrapped("subtestsFailed", `${n} subtests failed`);

const start = (file: string, nesting: number, name: string): TestReportEvent => ({
  type: "test:start",
  data: { file, nesting, name },
});

const fail = (
  file: string,
  nesting: number,
  name: string,
  error: unknown,
  detailsType = "test",
): TestReportEvent => ({
  type: "test:fail",
  data: { file, nesting, name, details: { type: detailsType, error } },
});

const FAKE_ROOT = "/repo";
const FILE_A = `${FAKE_ROOT}/${SUITES_REL}/a.test.ts`;
const FILE_B = `${FAKE_ROOT}/${SUITES_REL}/b.test.ts`;

const collect = (events: readonly TestReportEvent[], relativeTo?: string) => {
  const collector = createFailureCollector(relativeTo);
  for (const event of events) collector.observe(event);
  return collector.failures();
};

describe("isAggregateFailure", () => {
  it("drops a node that failed only because a child did", () => {
    assert.equal(isAggregateFailure(fail(FILE_A, 0, "outer", aggregateError(2), "suite")), true);
  });

  it("keeps a case that failed on its own code", () => {
    assert.equal(isAggregateFailure(fail(FILE_A, 1, "case", leafError(new Error("boom")))), false);
  });

  it("keeps a describe whose own body threw", () => {
    // Declared a suite, failed for its own reason: nothing below it will be
    // reported, so this event is the only one that can name it. Filtering on
    // `details.type` instead of on the failure reason would lose it.
    assert.equal(
      isAggregateFailure(fail(FILE_A, 0, "outer", leafError(new Error("bad describe")), "suite")),
      false,
    );
  });

  it("treats an event with no error as a leaf rather than throwing", () => {
    assert.equal(isAggregateFailure({ type: "test:fail" }), false);
  });
});

describe("failureMessage", () => {
  it("prefers the cause — the wrapper's own message is a restatement", () => {
    const event = fail(FILE_A, 1, "case", leafError(new Error("one is not two\n  at frame")));
    assert.equal(failureMessage(event), "one is not two");
  });

  it("falls back to the wrapper when nothing was caused (a timeout)", () => {
    const event = fail(FILE_A, 1, "case", wrapped("testTimeoutFailure", "test timed out after 1ms"));
    assert.equal(failureMessage(event), "test timed out after 1ms");
  });

  it("renders a thrown value that is not an Error", () => {
    // A case may throw anything; `describeThrown` is the repo's one answer for
    // that, and quoting is the point — a thrown string and an errno differ.
    assert.equal(failureMessage(fail(FILE_A, 1, "case", leafError("ENOENT"))), "'ENOENT'");
  });
});

describe("the fold over a run's events", () => {
  it("names a failing case with the suites that enclose it", () => {
    const failures = collect([
      start(FILE_A, 0, "outer"),
      start(FILE_A, 1, "inner"),
      start(FILE_A, 2, "the case"),
      fail(FILE_A, 2, "the case", leafError(new Error("boom"))),
      fail(FILE_A, 1, "inner", aggregateError(1), "suite"),
      fail(FILE_A, 0, "outer", aggregateError(1), "suite"),
    ]);
    assert.equal(failures.length, 1, "the two enclosing suites must not be reported again");
    assert.deepEqual(failures[0].path, ["outer", "inner", "the case"]);
    assert.equal(failures[0].message, "boom");
  });

  it("keeps a separate ancestry per file — node interleaves concurrent suites", () => {
    // One shared stack would file B's case under A's describe, which is worse
    // than reporting no path at all: it points the reader at the wrong file.
    const failures = collect([
      start(FILE_A, 0, "suite A"),
      start(FILE_B, 0, "suite B"),
      start(FILE_B, 1, "case B"),
      start(FILE_A, 1, "case A"),
      fail(FILE_B, 1, "case B", leafError(new Error("b broke"))),
      fail(FILE_A, 1, "case A", leafError(new Error("a broke"))),
    ]);
    assert.deepEqual(
      failures.map((f) => f.path),
      [
        ["suite B", "case B"],
        ["suite A", "case A"],
      ],
    );
  });

  it("forgets a finished subtree when the next sibling starts", () => {
    // Without the truncation, "second" inherits the depth-2 name left behind
    // by "first"'s child and reports a path that never existed.
    const failures = collect([
      start(FILE_A, 0, "outer"),
      start(FILE_A, 1, "first"),
      start(FILE_A, 2, "deep case"),
      fail(FILE_A, 2, "deep case", leafError(new Error("x"))),
      start(FILE_A, 1, "second"),
      fail(FILE_A, 1, "second", leafError(new Error("y"))),
    ]);
    assert.deepEqual(failures[1].path, ["outer", "second"]);
  });

  it("still names a case whose start event never arrived", () => {
    // The depth survives even when the name does not: "?" says there is one
    // enclosing suite and it could not be named, which a bare ["orphan"] would
    // silently misreport as a top-level case.
    const failures = collect([fail(FILE_A, 1, "orphan", leafError(new Error("z")))]);
    assert.deepEqual(failures[0].path, ["?", "orphan"]);
  });

  it("ignores every event type that is not a start or a failure", () => {
    const failures = collect([
      { type: "test:pass", data: { file: FILE_A, nesting: 0, name: "fine" } },
      { type: "test:diagnostic", data: { file: FILE_A, nesting: 0, name: "# pass 1" } },
      { type: "test:stderr" },
    ]);
    assert.deepEqual(failures, []);
  });

  it("survives a malformed event rather than replacing the failure with its own", () => {
    assert.doesNotThrow(() => collect([{ type: "test:fail" }, { type: "test:start" }]));
    assert.equal(collect([{ type: "test:fail" }])[0].file, "(unknown file)");
  });

  it("reports paths against the root it was given", () => {
    assert.equal(
      collect([fail(FILE_A, 0, "case", leafError(new Error("q")))], FAKE_ROOT)[0].file,
      path.join(SUITES_REL, "a.test.ts"),
    );
  });

  it("leaves paths absolute when it was given no root", () => {
    assert.equal(collect([fail(FILE_A, 0, "case", leafError(new Error("q")))])[0].file, FILE_A);
  });
});

describe("the report itself", () => {
  const failures = collect([
    start(FILE_A, 0, "outer"),
    start(FILE_A, 1, "the case"),
    fail(FILE_A, 1, "the case", leafError(new Error("one is not two"))),
  ], FAKE_ROOT);

  it("is empty on a green run — a reporter people learn to ignore reports nothing", () => {
    assert.equal(formatFailureReport([]), "");
  });

  it("counts the failures in its heading", () => {
    assert.match(formatFailureReport(failures), new RegExp(`${FAILURE_REPORT_HEADING} \\(1\\)`));
  });

  it("carries the file, the suite path and the message", () => {
    const report = formatFailureReport(failures);
    assert.ok(report.includes(path.join(SUITES_REL, "a.test.ts")));
    assert.ok(report.includes(`outer${FAILURE_PATH_SEPARATOR}the case`));
    assert.ok(report.includes("one is not two"));
  });
});

describe("package.json runs the reporter on every test entry point", () => {
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  const SCRIPTS = ["test", "test:only", "test:sentry"] as const;
  const REPORTER = "./scripts/test-failure-reporter.ts";

  it("the reporter the scripts name exists", () => {
    assert.doesNotThrow(() => read("scripts", "test-failure-reporter.ts"));
  });

  for (const name of SCRIPTS) {
    it(`${name} keeps tap on stdout and the failure report on stderr`, () => {
      const script = pkg.scripts[name];
      assert.ok(script, `package.json must declare \`${name}\``);
      // Node pairs reporters with destinations POSITIONALLY, so the order of
      // the four flags is the contract — swapped, the failure report would be
      // buried in stdout beside the tap stream it exists to escape.
      const PAIRED = [
        "--test-reporter=tap",
        "--test-reporter-destination=stdout",
        `--test-reporter=${REPORTER}`,
        "--test-reporter-destination=stderr",
      ].join(" ");
      assert.ok(
        script.includes(PAIRED),
        `\`${name}\` must pair each reporter with its own destination, tap first — expected to find\n  ${PAIRED}\nin\n  ${script}`,
      );
    });
  }

  it("suppresses only the warning the reporter's own loading provokes", () => {
    // Node sniffs the module type of a `.ts` file it loads outside tsx's hooks
    // and warns about the reparse. It is four lines of noise on every green
    // run; the flag is scoped to that one warning rather than to `--no-warnings`,
    // which would hide anything a suite legitimately warns about.
    for (const name of SCRIPTS) {
      assert.match(pkg.scripts[name], /--disable-warning=MODULE_TYPELESS_PACKAGE_JSON\b/);
      assert.doesNotMatch(pkg.scripts[name], /--no-warnings\b/);
    }
  });
});

describe("the reporter's import graph is loadable by node's own loader", () => {
  // The regression these two pin cost a full run: node imports a custom
  // reporter with the DEFAULT loader, tsx's resolve hook is never consulted,
  // and native type stripping infers no extensions. An import tidied to its
  // extensionless spelling is ERR_MODULE_NOT_FOUND before any suite starts.
  const GRAPH = [
    ["scripts", "test-failure-reporter.ts"],
    ["lib", "test-failure-report.ts"],
  ] as const;

  for (const segments of GRAPH) {
    it(`${segments.join("/")} names its repo-local imports with the extension`, () => {
      const src = read(segments[0], segments[1]);
      const specifiers = [...src.matchAll(/from\s+"(\.[^"]+)"/g)].map((m) => m[1]);
      assert.ok(specifiers.length > 0, "expected at least one repo-local import to check");
      for (const specifier of specifiers) {
        assert.match(
          specifier,
          /\.ts$/,
          `"${specifier}" must carry its .ts extension — node's default loader resolves none`,
        );
      }
    });
  }

  it("tsconfig lets tsc agree with the loader", () => {
    const tsconfig = JSON.parse(read("tsconfig.json")) as {
      compilerOptions?: Record<string, unknown>;
    };
    assert.equal(
      tsconfig.compilerOptions?.allowImportingTsExtensions,
      true,
      "the .ts specifiers above are a type error without this",
    );
  });
});

describe("a spawned run reports the case that failed", () => {
  /**
   * The command `npm test` actually runs, with the glob swapped for a fixture.
   *
   * Derived from package.json rather than written out here: a hand-copied flag
   * list is the thing that goes stale, and this case's whole value is that it
   * exercises the REAL wiring. `node --import tsx` rather than the `tsx` bin
   * for the reason `__tests__/helpers/guard-fixture.ts` gives — the bin is a
   * wrapper that spawns its own child, and the grandchild holds the stdout
   * pipe open past any timeout.
   */
  const runnerArgs = (fixture: string): string[] => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    const args = pkg.scripts.test.split(/\s+/).filter(Boolean);
    assert.equal(args.shift(), "tsx", "expected the `test` script to start with the tsx bin");
    const globAt = args.indexOf(`${SUITES_REL}/*.test.ts`);
    assert.ok(globAt >= 0, "expected the `test` script to end in the suite glob");
    args[globAt] = fixture;
    return ["--import", "tsx", ...args];
  };

  /**
   * This suite is itself running inside node's test runner, which marks its
   * children with `NODE_TEST_CONTEXT`. Inherited, that variable tells the
   * spawned runner it is a CHILD of a test run: it swaps to the v8-serialiser
   * reporter, ignores the `--test-reporter` flags entirely and exits 0 on a
   * failing suite. The first draft of this case read that as "the fixture
   * passed" — a green assertion about a run that never used the reporter.
   */
  const childEnv = (): NodeJS.ProcessEnv => {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith("NODE_TEST_")) delete env[key];
    }
    return env;
  };

  const runFixture = (body: string): { status: number; stderr: string } => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "failure-reporter-"));
    const fixture = path.join(dir, "fixture.test.ts");
    try {
      fs.writeFileSync(fixture, body, "utf8");
      try {
        const stdout = execFileSync(process.execPath, runnerArgs(fixture), {
          cwd: REPO_ROOT,
          env: childEnv(),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 120_000,
        });
        void stdout;
        return { status: 0, stderr: "" };
      } catch (error) {
        const failed = error as { status?: number; stderr?: string };
        return { status: failed.status ?? -1, stderr: failed.stderr ?? "" };
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  const RED = `
import { describe, it } from "node:test";
import assert from "node:assert/strict";
describe("a suite that is fine", () => {
  it("a case nobody needs to hear about", () => { assert.ok(true); });
});
describe("a suite with a problem", () => {
  it("the case CI could not name", () => { assert.equal("left", "right"); });
});
`;

  const GREEN = `
import { it } from "node:test";
import assert from "node:assert/strict";
it("nothing to report", () => { assert.ok(true); });
`;

  it("puts the failing case's name at the end of stderr", () => {
    const { status, stderr } = runFixture(RED);
    assert.equal(status, 1, `expected a failing run; stderr was:\n${stderr}`);
    assert.ok(
      stderr.includes(FAILURE_REPORT_HEADING),
      `expected the failure report in stderr; got:\n${stderr}`,
    );
    assert.ok(
      stderr.includes(`a suite with a problem${FAILURE_PATH_SEPARATOR}the case CI could not name`),
      `expected the failing case named with its suite; got:\n${stderr}`,
    );
    assert.ok(
      stderr.includes("fixture.test.ts"),
      `expected the failing file named; got:\n${stderr}`,
    );
  });

  it("says nothing about the cases that passed", () => {
    const { stderr } = runFixture(RED);
    assert.ok(
      !stderr.includes("a case nobody needs to hear about"),
      "a report that lists passing tests is the tap stream again, one file later",
    );
  });

  it("writes nothing at all when the run is green", () => {
    const { status, stderr } = runFixture(GREEN);
    assert.equal(status, 0);
    assert.equal(stderr, "", `a green run must add nothing to the log; got:\n${stderr}`);
  });
});
