import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { readRepoFile as read } from "./helpers/repo-file";

/**
 * Pins the typecheck to the front of `npm test`.
 *
 * The bug this closes shipped twice. `npm test` runs the suites through
 * `tsx`, which STRIPS types without checking them, so a test file can be
 * type-incorrect and still pass locally — `dfdd0a1` went red on CI with a
 * TS2345 in a test file that `npm test` had just reported green. The local
 * order was source → `tsc --noEmit` → write tests → run tests → commit, so
 * the only file that could still be wrong was the one written AFTER the
 * typecheck, and nothing in the run said so.
 *
 * The fix is ordering discipline turned into a script hook: `pretest` runs
 * `npm run typecheck`, which npm invokes automatically before `test`. There
 * is no longer an order in which a human can run the two commands and miss a
 * type error in a test file. `test:only` is the deliberate escape hatch for
 * iterating on a suite without paying ~5s per run.
 *
 * These assertions are what stop the hook being quietly dropped: the shape
 * (a pretest that reaches a `tsc --noEmit`), the coverage (a tsconfig that
 * actually INCLUDES `__tests__`, since a typecheck that skips test files
 * would have missed the original bug), and the parity between the two test
 * scripts.
 */

const ROOT = process.cwd();

const pkg = JSON.parse(read("package.json")) as {
  scripts: Record<string, string>;
};

const tsconfig = JSON.parse(read("tsconfig.json")) as {
  include?: string[];
  exclude?: string[];
};

const TEST_GLOB = "__tests__/*.test.ts";

describe("npm test typechecks before it runs", () => {
  it("exposes a `typecheck` script that runs tsc with no emit", () => {
    const typecheck = pkg.scripts.typecheck;
    assert.ok(typecheck, "package.json must declare a `typecheck` script");
    assert.match(
      typecheck,
      /\btsc\b/,
      "`typecheck` must invoke tsc, not a linter that only strips types",
    );
    assert.match(
      typecheck,
      /--noEmit\b/,
      "`typecheck` must pass --noEmit so it never writes build output",
    );
  });

  it("wires the typecheck ahead of `npm test` via the pretest hook", () => {
    const pretest = pkg.scripts.pretest;
    assert.ok(
      pretest,
      "package.json must declare a `pretest` hook — npm runs it automatically before `test`",
    );
    // Either spelling is fine, as long as the typecheck genuinely runs first.
    const reachesTypecheck =
      /npm run typecheck\b/.test(pretest) || /\btsc\b.*--noEmit/.test(pretest);
    assert.ok(
      reachesTypecheck,
      `pretest must reach the typecheck; got "${pretest}"`,
    );
  });

  it("keeps `test` itself free of the typecheck so it is not run twice", () => {
    assert.doesNotMatch(
      pkg.scripts.test,
      /\btsc\b/,
      "the typecheck belongs in `pretest`; duplicating it in `test` doubles the cost",
    );
    assert.match(pkg.scripts.test, /--test\b/, "`test` must run the node test runner");
  });

  it("keeps `test:only` byte-identical to `test` as the no-typecheck escape hatch", () => {
    // test:only exists so a tight edit/run loop on one suite does not pay for
    // a full program typecheck each time. It has no `pretest:only` hook, so
    // npm runs nothing before it. The two commands must never drift — a
    // test:only that runs a different glob would silently skip suites.
    assert.equal(
      pkg.scripts["test:only"],
      pkg.scripts.test,
      "`test:only` must run exactly the same command as `test`, minus the hook",
    );
  });

  it("runs every suite in both scripts through the same glob", () => {
    for (const name of ["test", "test:only"]) {
      assert.ok(
        pkg.scripts[name].includes(TEST_GLOB),
        `"${name}" must run ${TEST_GLOB}`,
      );
    }
  });

  it("keeps lint:ci fail-fast on the typecheck before the slower guards", () => {
    const ci = pkg.scripts["lint:ci"];
    assert.ok(ci, "package.json must declare `lint:ci`");
    const typecheckAt = ci.indexOf("typecheck");
    const lintAllAt = ci.indexOf("lint:all");
    assert.ok(typecheckAt >= 0, "`lint:ci` must still typecheck");
    assert.ok(lintAllAt >= 0, "`lint:ci` must still run the guard aggregator");
    assert.ok(
      typecheckAt < lintAllAt,
      "`lint:ci` should typecheck first — 5s of tsc beats waiting out lint:all to learn the same thing",
    );
  });
});

describe("CI typechecks with the PINNED compiler", () => {
  // `npx tsc` resolves node_modules/.bin/tsc only when node_modules is
  // populated; on a cold checkout it silently downloads whatever TypeScript
  // is latest on the registry instead. That was observed here reporting two
  // errors (a missing `expo/tsconfig.base`, a deprecated `baseUrl`) that the
  // pinned ~5.9 compiler does not — a red typecheck with nothing wrong in the
  // tree. `npm run typecheck` can only ever run the pinned binary.
  const WORKFLOWS = ["ci.yml", "release.yml"];

  for (const file of WORKFLOWS) {
    it(`${file} runs the typecheck through npm, not npx`, () => {
      const yml = read(path.join(".github", "workflows", file));
      // Only executable lines — a comment is allowed to name `npx tsc` while
      // explaining why no step may run it.
      const commands = yml
        .split("\n")
        .filter((line) => !/^\s*#/.test(line))
        .join("\n");
      assert.doesNotMatch(
        commands,
        /npx\s+tsc\b/,
        `${file} must call \`npm run typecheck\` so it uses the pinned TypeScript`,
      );
      assert.match(
        commands,
        /run:\s*npm run typecheck/,
        `${file} must typecheck before it builds or releases`,
      );
    });
  }

  it("pins TypeScript as a devDependency rather than resolving it at run time", () => {
    const manifest = JSON.parse(read("package.json")) as {
      devDependencies?: Record<string, string>;
    };
    assert.ok(
      manifest.devDependencies?.typescript,
      "typescript must stay a devDependency for `tsc` to resolve locally",
    );
  });
});

describe("the typecheck actually covers the test files", () => {
  it("includes every .ts in the program", () => {
    assert.ok(
      tsconfig.include?.includes("**/*.ts"),
      "tsconfig `include` must keep the repo-wide **/*.ts glob that pulls in __tests__",
    );
  });

  it("does not exclude the test directory", () => {
    // A `tsc --noEmit` that skips __tests__ would pass on exactly the bug
    // this whole prelude exists to catch.
    for (const pattern of tsconfig.exclude ?? []) {
      assert.ok(
        !pattern.includes("__tests__"),
        `tsconfig excludes ${pattern}, which would hide type errors in test files`,
      );
    }
  });

  it("leaves no test file outside the glob npm test runs", async () => {
    // `__tests__/*.test.ts` is one level deep. A suite parked in a
    // subdirectory typechecks (the tsconfig glob is recursive) but never
    // EXECUTES — the same silent-coverage-loss shape as the Node 20 pin.
    const { readdirSync } = await import("node:fs");
    const testsDir = path.join(ROOT, "__tests__");
    const stray: string[] = [];
    const walk = (dir: string, depth: number) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full, depth + 1);
        } else if (entry.name.endsWith(".test.ts") && depth > 0) {
          stray.push(path.relative(ROOT, full));
        }
      }
    };
    walk(testsDir, 0);
    assert.deepEqual(
      stray,
      [],
      `these .test.ts files are nested below __tests__/ and never run: ${stray.join(", ")}`,
    );
  });
});
