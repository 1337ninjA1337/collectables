import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * The `sentry-sdk-absent` CI job runs the sentry test surface with the whole
 * `@sentry` scope deleted from node_modules — the runtime complement to the
 * structural no-static-import guard (`lint:peer-dep-free`). These assertions
 * keep the job's load-bearing details from regressing.
 *
 * The runner invocation moved out of the YAML and into a `test:sentry`
 * script: this was the last CI path executing suites through a hand-written
 * `npx tsx --test` line, so its flags were a copy of `npm test`'s that
 * nothing kept in sync — and the `--import ./__tests__/test-globals.ts`
 * setup file is load-bearing (without the global reset, module state leaks
 * between suites and produces false failures). `npx` was also the wrong
 * launcher for the same reason it is wrong for `tsc`: it resolves the pinned
 * binary only when node_modules is populated, and this job's whole premise
 * is deleting part of node_modules.
 */
describe("ci.yml — sentry-sdk-absent smoke job", () => {
  const ci = read(".github/workflows/ci.yml");

  it("defines the job", () => {
    assert.match(ci, /sentry-sdk-absent:/);
  });

  it("deletes the whole @sentry scope (not just @sentry/react-native) to catch transitive imports", () => {
    assert.match(ci, /rm -rf node_modules\/@sentry\s*$/m);
  });

  it("runs the suites through the `test:sentry` script, not a hand-written npx line", () => {
    assert.match(ci, /npm run test:sentry/);
    const commands = ci
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
    assert.doesNotMatch(
      commands,
      /npx\s+tsx\s+[^\n]*--test\b/,
      "the runner flags belong in a package.json script where they stay in sync with `npm test`",
    );
  });

  it("deletes the scope BEFORE running the suites", () => {
    const step = ci.slice(ci.indexOf("rm -rf node_modules/@sentry"));
    const runAt = step.indexOf("npm run test:sentry");
    assert.ok(
      runAt > 0,
      "the sentry run must follow the deletion in the same step — a run before it proves nothing",
    );
  });
});

describe("test:sentry shares its runner flags with npm test", () => {
  const pkg = JSON.parse(read("package.json")) as {
    scripts: Record<string, string>;
  };

  it("is declared", () => {
    assert.ok(pkg.scripts["test:sentry"], "package.json must declare `test:sentry`");
  });

  it("keeps everything except the glob byte-identical to `test`", () => {
    // The two commands may only differ in which files they select. A
    // divergent flag here is exactly the drift moving this out of the YAML
    // was meant to make impossible.
    const stripGlob = (cmd: string) => cmd.replace(/__tests__\/[^\s]+\.test\.ts/, "<glob>");
    assert.equal(
      stripGlob(pkg.scripts["test:sentry"]),
      stripGlob(pkg.scripts.test),
      "`test:sentry` must differ from `test` only in its glob",
    );
  });

  it("selects a strict subset of the suites `npm test` runs", () => {
    // A sentry suite reachable ONLY from this job would never be typechecked
    // (the job has no typecheck step, by design) and would run with the SDK
    // absent but never with it present.
    const glob = /__tests__\/([^\s]+)\.test\.ts/.exec(pkg.scripts["test:sentry"])?.[1];
    assert.equal(glob, "sentry-*", "`test:sentry` must run the sentry-* glob");
    const files = readdirSync(join(ROOT, "__tests__")).filter((n) =>
      /^sentry-.*\.test\.ts$/.test(n),
    );
    assert.ok(files.length > 0, "the sentry-* glob must match at least one suite");
    // `npm test`'s glob is one level deep too, so every match above is also
    // run by the main suite — assert the shape rather than trusting it.
    assert.match(pkg.scripts.test, /__tests__\/\*\.test\.ts/);
  });

  it("the setup file both scripts reference exists", () => {
    assert.doesNotThrow(() => read("__tests__/test-globals.ts"));
  });
});

describe("the job's missing typecheck is deliberate and written down", () => {
  const ci = read(".github/workflows/ci.yml");

  it("states why the job does not typecheck", () => {
    // This is the whole point of the entry: the asymmetry with the `test`
    // job is invisible from the job definition, and the next hand-rolled
    // suite-running job will copy whatever this one does.
    const jobStart = ci.lastIndexOf("#", ci.indexOf("sentry-sdk-absent:"));
    const header = ci.slice(Math.max(0, ci.lastIndexOf("\n\n", jobStart)), ci.indexOf("sentry-sdk-absent:"));
    assert.match(
      header,
      /typecheck/i,
      "the job's header comment must name the typecheck asymmetry and what covers it",
    );
  });

  it("keeps the `test` job's named Typecheck step, which is what covers it", () => {
    assert.match(ci, /- name: Typecheck\n\s+run: npm run typecheck/);
  });
});
