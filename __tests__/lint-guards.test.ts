import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  LINT_ALL_EXEMPT,
  LINT_GUARDS,
  expectedNpmScriptCommand,
  formatLintAllReport,
  lintAllExitCode,
  type LintGuardResult,
} from "../lib/lint-guards";

const ROOT = process.cwd();

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const pkg = JSON.parse(read("package.json")) as {
  scripts: Record<string, string>;
};

describe("LINT_GUARDS — registry shape", () => {
  it("has unique npm-script ids and non-empty descriptions", () => {
    const ids = LINT_GUARDS.map((g) => g.npmScript);
    assert.equal(new Set(ids).size, ids.length, "duplicate guard ids");
    for (const guard of LINT_GUARDS) {
      assert.match(guard.npmScript, /^lint:[a-z-]+$/);
      assert.ok(guard.description.length > 0, `${guard.npmScript} needs a description`);
    }
  });

  it("every guard's script file exists on disk", () => {
    for (const guard of LINT_GUARDS) {
      assert.ok(
        existsSync(path.join(ROOT, guard.scriptPath)),
        `${guard.npmScript} points at a missing file: ${guard.scriptPath}`,
      );
    }
  });

  it("every guard's npm script matches the registry command exactly", () => {
    // The registry and package.json can never drift: `npm run <guard>` and
    // the aggregator's fan-out must execute the identical command.
    for (const guard of LINT_GUARDS) {
      assert.equal(
        pkg.scripts[guard.npmScript],
        expectedNpmScriptCommand(guard),
        `package.json "${guard.npmScript}" drifted from the registry`,
      );
    }
  });

  it("every lint:* script is either a registry guard or documented exempt", () => {
    // Completeness drift guard: a future `lint:foo` script must either join
    // the aggregator or state why it can't (build output, network, …).
    const registryIds = new Set(LINT_GUARDS.map((g) => g.npmScript));
    const lintScripts = Object.keys(pkg.scripts).filter(
      (name) => name === "lint" || name.startsWith("lint:"),
    );
    for (const name of lintScripts) {
      assert.ok(
        registryIds.has(name) || name in LINT_ALL_EXEMPT,
        `"${name}" is neither in LINT_GUARDS nor in LINT_ALL_EXEMPT — add it to one`,
      );
    }
    // …and the exempt list can't carry stale entries for scripts that no
    // longer exist or that joined the registry.
    for (const name of Object.keys(LINT_ALL_EXEMPT)) {
      assert.ok(name in pkg.scripts, `LINT_ALL_EXEMPT has a stale entry: ${name}`);
      assert.ok(
        !registryIds.has(name),
        `"${name}" is both a registry guard and exempt — pick one`,
      );
    }
  });
});

describe("formatLintAllReport / lintAllExitCode", () => {
  const pass = (npmScript: string): LintGuardResult => ({
    npmScript,
    ok: true,
    durationMs: 10,
    output: "clean",
  });
  const fail = (npmScript: string, output: string): LintGuardResult => ({
    npmScript,
    ok: false,
    durationMs: 20,
    output,
  });

  it("reports an all-green run with the pass count and exit code 0", () => {
    const results = [pass("lint:hex"), pass("lint:secrets")];
    const report = formatLintAllReport(results);
    assert.match(report, /✓ lint:hex \(10ms\)/);
    assert.match(report, /✓ lint:secrets \(10ms\)/);
    assert.match(report, /lint-all: 2\/2 guards passed\./);
    assert.equal(lintAllExitCode(results), 0);
  });

  it("includes every failing guard's output and names them in the summary", () => {
    const results = [
      pass("lint:hex"),
      fail("lint:secrets", "found key in lib/foo.ts:12"),
      fail("lint:radius", "app/x.tsx:3 borderRadius: 999"),
    ];
    const report = formatLintAllReport(results);
    assert.match(report, /✗ lint:secrets \(20ms\)/);
    assert.match(report, /--- lint:secrets output ---\nfound key in lib\/foo\.ts:12/);
    assert.match(report, /--- lint:radius output ---/);
    assert.match(
      report,
      /lint-all: 1\/3 guards passed — failed: lint:secrets, lint:radius/,
    );
    assert.equal(lintAllExitCode(results), 1);
  });

  it("an empty result set is a failure — a broken fan-out must not pass", () => {
    assert.equal(lintAllExitCode([]), 1);
  });
});

describe("lint:all — wiring", () => {
  it("package.json declares lint:all and lint:ci delegates to it", () => {
    assert.equal(pkg.scripts["lint:all"], "tsx scripts/lint-all.ts");
    assert.equal(
      pkg.scripts["lint:ci"],
      "npx tsc --noEmit && npm run lint:all && npm test",
    );
  });

  it("ci.yml runs the aggregator as a single blocking step", () => {
    const ci = read(".github/workflows/ci.yml");
    assert.match(ci, /run:\s*npm run lint:all/);
    const step = ci.slice(ci.indexOf("Code-style guards (lint:all)"));
    assert.ok(
      !/continue-on-error/.test(step.slice(0, 200)),
      "the lint:all CI step must be blocking",
    );
  });

  it("ci.yml no longer runs any registry guard as its own step", () => {
    // Anti-drift: a guard re-added as an individual step would run twice
    // and re-open the step-list ↔ registry drift this aggregator closed.
    const ci = read(".github/workflows/ci.yml");
    for (const guard of LINT_GUARDS) {
      // Boundary-aware: `npm run lint:secrets:bundle` (a legitimate
      // post-build step) must not count as running `lint:secrets`.
      const direct = new RegExp(`npm run ${guard.npmScript}(?![:\\w-])`);
      assert.ok(
        !direct.test(ci),
        `ci.yml runs ${guard.npmScript} directly — it already runs via lint:all`,
      );
    }
  });

  it("the aggregator script fans out over the registry and fails on any guard", () => {
    const src = read("scripts/lint-all.ts");
    assert.match(src, /from "\.\.\/lib\/lint-guards"/);
    assert.match(src, /LINT_GUARDS\.map\(/);
    assert.match(src, /spawnSync\("npx", \["tsx", scriptPath, \.\.\.args\]/);
    assert.match(src, /process\.exit\(exitCode\)/);
  });
});
