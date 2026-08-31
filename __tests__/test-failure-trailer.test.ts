import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  createFailureCollector,
  failureMessage,
  formatFailureTrailer,
  lineFromStack,
  type FailingCase,
  type TestRunnerEvent,
} from "@/lib/test-failure-trailer";
import { readRepoFile, REPO_ROOT } from "./helpers/repo-file";
import { tsxLoaderIn } from "./helpers/guard-fixture";

/**
 * The trailer exists because a case failed once in CI and could not be named:
 * tap prints `not ok` where the failure happens and its own trailer is counts
 * only, so on a 7000-case run the name is thousands of lines above the end of
 * the log — past any tail, and gone once the re-run is green.
 *
 * Two halves are tested here. The collector is fed fabricated event streams,
 * because the interesting cases (a `describe` aggregate, interleaved files,
 * concurrent starts) are precisely the ones that are awkward to provoke for
 * real. And the wiring is run for real, once, through the flags package.json
 * actually carries — the trailer's whole value is that node accepts it as a
 * second reporter, which no amount of unit testing can establish.
 */

const FILE = "/repo/__tests__/example.test.ts";
const ROOT = "/repo";

function start(name: string, nesting: number, file = FILE): TestRunnerEvent {
  return { type: "test:start", data: { name, nesting, file } };
}

function fail(
  name: string,
  nesting: number,
  options: {
    file?: string;
    line?: number;
    stack?: string;
    message?: string;
    failureType?: string;
  } = {},
): TestRunnerEvent {
  return {
    type: "test:fail",
    data: {
      name,
      nesting,
      file: options.file ?? FILE,
      line: options.line ?? 1,
      details: {
        error: {
          message: options.message ?? "boom",
          failureType: options.failureType ?? "testCodeFailure",
          ...(options.stack === undefined ? {} : { stack: options.stack }),
        },
      },
    },
  };
}

function collect(events: readonly TestRunnerEvent[]): readonly FailingCase[] {
  const collector = createFailureCollector(ROOT);
  for (const event of events) collector.observe(event);
  return collector.failures();
}

describe("createFailureCollector — naming the case", () => {
  it("joins the describe ancestry, because leaf names are written to be read under one", () => {
    const failures = collect([
      start("outer group", 0),
      start("nested", 1),
      start("is idempotent", 2),
      fail("is idempotent", 2, { line: 42 }),
    ]);
    assert.deepEqual(
      failures.map((failure) => failure.name),
      ["outer group › nested › is idempotent"],
    );
    assert.equal(failures[0]?.file, "__tests__/example.test.ts");
    assert.equal(failures[0]?.line, 42);
  });

  it("reports one entry per broken assertion, not one per ancestor", () => {
    // A `describe` containing a failure emits its own `test:fail` with
    // failureType `subtestsFailed`. Counting those would name three failures
    // for one broken assertion, two of them at lines with nothing wrong.
    const failures = collect([
      start("outer group", 0),
      start("nested", 1),
      start("deep", 2),
      fail("deep", 2),
      fail("nested", 1, { failureType: "subtestsFailed", message: "1 subtest failed" }),
      fail("outer group", 0, { failureType: "subtestsFailed", message: "1 subtest failed" }),
    ]);
    assert.deepEqual(
      failures.map((failure) => failure.name),
      ["outer group › nested › deep"],
    );
  });

  it("keeps each file's ancestry to itself, because node runs files in parallel", () => {
    const other = "/repo/__tests__/other.test.ts";
    const failures = collect([
      start("suite A", 0),
      start("suite B", 0, other),
      start("case in B", 1, other),
      start("case in A", 1),
      fail("case in B", 1, { file: other }),
      fail("case in A", 1),
    ]);
    assert.deepEqual(
      failures.map((failure) => failure.name),
      ["suite B › case in B", "suite A › case in A"],
    );
  });

  it("falls back to the bare name when the stack disagrees with the failing case", () => {
    // Two cases running concurrently in one file interleave their starts, so
    // the name at this depth is somebody else's and the ancestry above it may
    // be too. A wrong ancestry is worse than none: `file:line` still says
    // exactly which case this is.
    const failures = collect([
      start("suite", 0),
      start("first", 1),
      start("second", 1),
      fail("first", 1, { line: 7 }),
    ]);
    assert.deepEqual(
      failures.map((failure) => failure.name),
      ["first"],
    );
    assert.equal(failures[0]?.line, 7);
  });

  it("names a file that failed to load, which has no start event at all", () => {
    const failures = collect([fail("__tests__/broken.test.ts", 0, { message: "Cannot find module" })]);
    assert.deepEqual(
      failures.map((failure) => failure.name),
      ["__tests__/broken.test.ts"],
    );
  });

  it("reports a path outside the root absolute rather than as a pile of ../", () => {
    const failures = collect([fail("elsewhere", 0, { file: "/other/tree/x.test.ts" })]);
    assert.equal(failures[0]?.file, "/other/tree/x.test.ts");
  });
});

describe("lineFromStack — which line the trailer points at", () => {
  const stack = [
    `    at TestContext.<anonymous> (${FILE}:257:14)`,
    "    at Test.runInAsyncScope (node:async_hooks:214:14)",
  ].join("\n");

  it("prefers the source-mapped stack over the event's declaration line", () => {
    // Under tsx the event's `line` is the esbuild output's — every case in
    // every suite here reports 2 — while the stack is source-mapped and points
    // at the assertion that failed.
    const failures = collect([start("a case", 0), fail("a case", 0, { line: 2, stack })]);
    assert.equal(failures[0]?.line, 257);
  });

  it("reads through the ERR_TEST_FAILURE wrapper to the cause node puts the assertion in", () => {
    // The event's own error is node's wrapper: same message, no frames. The
    // AssertionError — and the only source-mapped stack there is — is its
    // `cause`. Reading the wrapper's stack is what reported line 2 for every
    // case in the repo.
    const failures = collect([
      start("a case", 0),
      {
        type: "test:fail",
        data: {
          name: "a case",
          nesting: 0,
          file: FILE,
          line: 2,
          details: {
            error: {
              message: "Expected values to be strictly equal:",
              failureType: "testCodeFailure",
              stack: "Error [ERR_TEST_FAILURE]: Expected values to be strictly equal:",
              cause: { message: "Expected values to be strictly equal:\n\n1 !== 2\n", stack },
            },
          },
        },
      },
    ]);
    assert.equal(failures[0]?.line, 257);
    assert.equal(failures[0]?.message, "Expected values to be strictly equal:");
  });

  it("keeps the event's line when no frame names the test file", () => {
    // A timeout has no frame in the suite; under plain node, with no
    // transform, the declaration line is right anyway.
    const failures = collect([
      start("a case", 0),
      fail("a case", 0, { line: 31, stack: "    at Timeout._onTimeout (node:internal/x:1:1)" }),
    ]);
    assert.equal(failures[0]?.line, 31);
  });

  it("reads nothing out of a stack that is not one", () => {
    assert.equal(lineFromStack(undefined, FILE), undefined);
    assert.equal(lineFromStack(stack, ""), undefined);
    assert.equal(lineFromStack(`at (${FILE}:not-a-number:3)`, FILE), undefined);
  });
});

describe("failureMessage", () => {
  it("keeps the first non-empty line, where the assertion says what it wanted", () => {
    assert.equal(
      failureMessage({ message: "Expected values to be strictly equal:\n\n1 !== 2\n" }),
      "Expected values to be strictly equal:",
    );
  });

  it("truncates rather than pasting a whole diff into the trailer", () => {
    const long = failureMessage({ message: "x".repeat(500) });
    assert.ok(long.length < 250, `trailer message should stay one line, got ${String(long.length)}`);
    assert.ok(long.endsWith("…"), "a truncated message should say it was truncated");
  });

  it("survives a thrown non-Error", () => {
    assert.equal(failureMessage("just a string"), "just a string");
    assert.equal(failureMessage({ message: "   \n  " }), "(no message)");
  });
});

describe("formatFailureTrailer", () => {
  const failures: readonly FailingCase[] = [
    { name: "suite › case", file: "__tests__/a.test.ts", line: 12, message: "1 !== 2" },
    { name: "other", file: "__tests__/b.test.ts", line: undefined, message: "boom" },
  ];

  it("names each failure with an address a reader can open", () => {
    const trailer = formatFailureTrailer(failures);
    assert.match(trailer, /suite › case/);
    assert.match(trailer, /__tests__\/a\.test\.ts:12/);
    assert.match(trailer, /1 !== 2/);
    // No line number is not a reason to drop the file.
    assert.match(trailer, /__tests__\/b\.test\.ts\n/);
  });

  it("says something on a green run, so the trailer can be seen to be wired", () => {
    // A signal only visible when something is broken is a signal nobody can
    // tell has stopped working — which is the failure this whole trailer
    // exists because of.
    assert.match(formatFailureTrailer([]), /test-failures: none\./);
  });

  it("counts in words a person reads, not a leaked pluralisation pattern", () => {
    assert.match(formatFailureTrailer(failures), /2 failing cases/);
    assert.match(formatFailureTrailer([failures[0]!]), /1 failing case\b/);
    assert.doesNotMatch(formatFailureTrailer(failures), /case\(s\)/);
  });
});

describe("package.json wiring", () => {
  const pkg = JSON.parse(readRepoFile("package.json")) as { scripts: Record<string, string> };
  const wired = ["test", "test:only", "test:sentry"] as const;

  for (const script of wired) {
    it(`\`${script}\` keeps tap on stdout and adds the trailer reporter`, () => {
      const command = pkg.scripts[script] ?? "";
      // Naming tap explicitly is load-bearing: passing any --test-reporter
      // REPLACES the default, so without it the tap stream CI has always
      // produced would be gone and this trailer would be the whole output.
      assert.match(command, /--test-reporter=tap --test-reporter-destination=stdout/);
      assert.match(
        command,
        /--test-reporter=\.\/lib\/test-failure-trailer\.ts --test-reporter-destination=stdout/,
      );
    });
  }

  it("the reporter module imports nothing, because node's loader parses it, not tsx's", () => {
    // The reporter is resolved by node itself, before the runner's child
    // processes exist, so node's type stripping is what reads it: an
    // extensionless `../lib/…` specifier there is ERR_MODULE_NOT_FOUND, which
    // is how the thin `scripts/` entry point this started as failed.
    const src = readRepoFile("lib/test-failure-trailer.ts");
    assert.doesNotMatch(src, /^\s*import\s/m, "an import here breaks the reporter under node's loader");
    assert.match(src, /export default failureTrailerReporter;/);
  });
});

describe("the wiring node actually runs", () => {
  it("prints the failing case's name after the tap stream, and exits non-zero", () => {
    // The one case that proves the flags: node has to accept a second
    // reporter, load a TypeScript one through tsx, and let it write to the
    // same stdout the tap stream is on. The flags come out of package.json
    // rather than being retyped, so this fails if the wiring drifts.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "failure-trailer-"));
    try {
      const fixture = path.join(dir, "fixture.test.ts");
      fs.writeFileSync(
        fixture,
        [
          'import { describe, it } from "node:test";',
          'import assert from "node:assert/strict";',
          'describe("the group", () => {',
          '  it("passes", () => { assert.ok(true); });',
          '  it("fails on purpose", () => { assert.equal(1, 2); });',
          "});",
          "",
        ].join("\n"),
      );

      const pkg = JSON.parse(readRepoFile("package.json")) as { scripts: Record<string, string> };
      const args = (pkg.scripts.test ?? "")
        .split(/\s+/)
        .slice(1)
        .map((arg) => (arg === "__tests__/*.test.ts" ? fixture : arg));

      // NODE_TEST_CONTEXT is set in this process because a test runner is what
      // is running us; inherited, node sees a recursive `run()` and skips the
      // child's files entirely — a green spawn that executed nothing.
      const { NODE_TEST_CONTEXT: _inherited, ...env } = process.env;
      // `node --import tsx`, never the `tsx` bin: the bin is a wrapper that
      // spawns its own node child holding this pipe, so a timeout on it cannot
      // end the run. `lint-guard-premise` sweeps every suite for that spawn.
      const run = spawnSync(process.execPath, ["--import", tsxLoaderIn(REPO_ROOT), ...args], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env,
        timeout: 120_000,
        killSignal: "SIGKILL",
      });

      assert.equal(run.status, 1, `a failing suite must still exit non-zero:\n${run.stderr}`);
      assert.match(run.stdout, /^not ok/m, "the tap stream must survive the second reporter");
      const trailer = run.stdout.slice(run.stdout.indexOf("test-failures:"));
      assert.match(trailer, /1 failing case\b/);
      assert.match(trailer, /the group › fails on purpose/);
      assert.match(trailer, /fixture\.test\.ts:5/);
      assert.ok(
        run.stdout.indexOf("test-failures:") > run.stdout.indexOf("# fail 1"),
        "the trailer must come AFTER tap's own summary — being reachable by a tail is the whole point",
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
