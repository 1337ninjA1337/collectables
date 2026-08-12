import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Pins every workflow that runs the test harness to a FULL checkout.
 *
 * `npm test` stopped being history-free the moment
 * `__tests__/lint-guard-premise.test.ts` began executing every `LINT_GUARDS`
 * entry: one of them, `lint:baseline-provenance`, reads the previous revision
 * of `lib/privacy-body-baselines.ts` and refuses a shallow clone outright,
 * because a drift check with nothing to compare against is a pass that checked
 * nothing. ci.yml's test job had `fetch-depth: 0` and a comment saying why;
 * release.yml's Release Gate ran the same `npm test` at the default depth 1,
 * and reported two failures whose message named the fix.
 *
 * This is the same shape as `ci-node-version.test.ts` — a property of running
 * the suites that one workflow satisfied and another silently did not — so it
 * is derived the same way: any workflow whose steps invoke the runner must
 * check out full history, and the exemption is a property of the file's
 * contents rather than a list someone has to remember to extend.
 */

const WORKFLOWS_DIR = path.join(process.cwd(), ".github", "workflows");

/**
 * Commands that run the WHOLE suite, which is the thing that needs history —
 * `__tests__/lint-guard-premise.test.ts` is in it, and that file runs the
 * baseline guard. `npm run test:sentry` deliberately does not match: it runs
 * one suite file, in a job that removes @sentry from node_modules, and it has
 * no more use for git history than `npm run build` does.
 */
const RUNS_THE_WHOLE_SUITE =
  /(npm (run )?test(\s|$)|npm run lint:ci(\s|$)|npm run lint:all(\s|$)|npm run verify(\s|$))/;

interface Job {
  /** `<file> / <job id>` — the address a failure message has to name. */
  readonly name: string;
  readonly checkouts: number;
  readonly fullDepthCheckouts: number;
  readonly runsWholeSuite: boolean;
}

/**
 * Per JOB, not per file: ci.yml holds three jobs and only two of them run the
 * suites, so a file-level count would demand full history from the one that
 * runs a single suite with the SDK deleted. Split on the two-space-indented
 * job keys rather than pulling in a YAML parser for one shape.
 */
function jobsOf(file: string, yml: string): Job[] {
  const lines = yml
    .split("\n")
    .filter((line) => !/^\s*#/.test(line)); // prose, not steps
  const jobsAt = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (jobsAt === -1) return [];
  const jobs: Job[] = [];
  let current: string | null = null;
  let body: string[] = [];
  const flush = () => {
    if (current === null) return;
    const text = body.join("\n");
    jobs.push({
      name: `${file} / ${current}`,
      checkouts: [...text.matchAll(/uses:\s*actions\/checkout@/g)].length,
      fullDepthCheckouts: [...text.matchAll(/fetch-depth:\s*0\b/g)].length,
      runsWholeSuite: RUNS_THE_WHOLE_SUITE.test(text),
    });
  };
  for (const line of lines.slice(jobsAt + 1)) {
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) {
      flush();
      current = header[1];
      body = [];
    } else if (current !== null) {
      body.push(line);
    }
  }
  flush();
  return jobs;
}

function allJobs(): Job[] {
  return readdirSync(WORKFLOWS_DIR)
    .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
    .flatMap((file) =>
      jobsOf(file, readFileSync(path.join(WORKFLOWS_DIR, file), "utf8")),
    );
}

const ALL = allJobs();
const HARNESS_JOBS = ALL.filter((j) => j.runsWholeSuite);

describe("workflow checkout depth vs the guards npm test runs", () => {
  it("finds the jobs that run the whole suite at all", () => {
    // A rename or a restructure that leaves NO job running the suites would
    // make every assertion below vacuously true.
    assert.ok(
      ALL.length >= 8,
      `only ${ALL.length} jobs parsed out of .github/workflows — the job splitter stopped matching`,
    );
    for (const expected of ["ci.yml / test", "release.yml / validate"]) {
      assert.ok(
        HARNESS_JOBS.some((j) => j.name === expected),
        `${expected} no longer looks like it runs the whole suite; found ${
          HARNESS_JOBS.map((j) => j.name).join(", ") || "none"
        }`,
      );
    }
  });

  it("gives every whole-suite job a full-history checkout", () => {
    for (const job of HARNESS_JOBS) {
      assert.ok(
        job.checkouts > 0,
        `${job.name} runs the suites without checking anything out`,
      );
      assert.equal(
        job.fullDepthCheckouts,
        job.checkouts,
        `${job.name}: ${
          job.checkouts - job.fullDepthCheckouts
        } of its ${job.checkouts} checkout step(s) use the default depth-1. npm test runs lint:baseline-provenance, which fails in a shallow clone rather than skipping — add \`with: fetch-depth: 0\``,
      );
    }
  });

  it("leaves the jobs that never load the suites free to check out shallow", () => {
    // Documents the exemption rather than asserting a depth: a job that never
    // runs the whole suite has no history requirement from this direction, and
    // what matters is that it is exempt BECAUSE of that — not because it was
    // skipped. `sentry-sdk-absent` is the live example: one suite file, no
    // guards, no history.
    const exempt = ALL.filter((j) => !j.runsWholeSuite);
    assert.ok(
      exempt.some((j) => j.name === "ci.yml / sentry-sdk-absent"),
      "the single-suite sentry job should be exempt — if it now runs the whole suite it needs full history like the rest",
    );
  });

  it("agrees with the guard that actually needs the history", () => {
    // The requirement is not a style rule about checkouts; it is one guard's
    // stated precondition. If that sentence ever leaves the script, this test
    // is measuring nothing.
    const guard = readFileSync(
      path.join(process.cwd(), "scripts", "check-privacy-baseline-provenance.ts"),
      "utf8",
    );
    assert.match(guard, /SHALLOW clone/);
    assert.match(guard, /fetch-depth: 0/);
  });
});
