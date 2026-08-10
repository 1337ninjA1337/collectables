import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { MINIMUM_NODE_VERSION } from "./helpers/render";

/**
 * Pins every workflow that runs the test harness against the harness's own
 * Node floor.
 *
 * The harness aliases `react-native` and `@expo/vector-icons` with
 * `module.registerHooks`, which shipped in Node 22.15. CI ran Node 20 when the
 * harness landed, and the result was the worst shape a failure can take: every
 * suite that imports the harness died at load with `registerHooks is not a
 * function`, the total test count silently DROPPED by the number of cases
 * those files contained, and the local run — on Node 22 — was green. Nothing
 * in the diff pointed at the runner.
 *
 * The first version of this file checked `ci.yml` alone, on the belief that
 * "the deploy/release/eas workflows run `npm run build`, never the test
 * harness". That was wrong about ONE of them: `release.yml`'s Release Gate
 * runs `npm test` on every pull request, still pinned to 20 — so the same
 * outage was live on a second workflow for as long as the guard existed,
 * reporting 7 failures in place of 127 suites that never loaded. A guard
 * naming one file can only ever protect that file, so the scan is now derived:
 * any workflow whose steps invoke the runner must clear the floor, and the
 * exemption is a property of the file's contents rather than a list someone
 * has to remember to extend.
 */

const WORKFLOWS_DIR = path.join(process.cwd(), ".github", "workflows");

/** Commands that put a test suite in front of the Node runtime. */
const RUNS_THE_HARNESS = /(npm (run )?test\b|npm run lint:ci\b|tsx[^\n]*--test\b)/;

interface Workflow {
  readonly file: string;
  readonly yml: string;
  readonly pins: readonly number[];
  readonly setupSteps: number;
  readonly runsTests: boolean;
}

function workflows(): Workflow[] {
  return readdirSync(WORKFLOWS_DIR)
    .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
    .map((file) => {
      const yml = readFileSync(path.join(WORKFLOWS_DIR, file), "utf8");
      // Comments are prose — a note explaining the pin must not read as a
      // step that runs the suites.
      const commands = yml
        .split("\n")
        .filter((line) => !/^\s*#/.test(line))
        .join("\n");
      return {
        file,
        yml,
        pins: [...yml.matchAll(/node-version:\s*'?"?(\d+)/g)].map((m) => Number(m[1])),
        setupSteps: [...yml.matchAll(/uses:\s*actions\/setup-node@/g)].length,
        runsTests: RUNS_THE_HARNESS.test(commands),
      };
    });
}

const ALL = workflows();
const HARNESS_WORKFLOWS = ALL.filter((w) => w.runsTests);

describe("workflow Node pins vs the render harness floor", () => {
  it("finds the workflows that run the suites at all", () => {
    // A rename or a restructure that leaves NO workflow running the harness
    // would make every assertion below vacuously true.
    assert.ok(
      HARNESS_WORKFLOWS.length >= 2,
      `expected ci.yml and release.yml to run the suites; found ${HARNESS_WORKFLOWS.map((w) => w.file).join(", ") || "none"}`,
    );
    for (const expected of ["ci.yml", "release.yml"]) {
      assert.ok(
        HARNESS_WORKFLOWS.some((w) => w.file === expected),
        `${expected} no longer looks like it runs the test suites — update RUNS_THE_HARNESS or this expectation`,
      );
    }
  });

  it("declares a node-version for every setup-node step", () => {
    for (const workflow of ALL) {
      assert.equal(
        workflow.pins.length,
        workflow.setupSteps,
        `${workflow.file}: a setup-node step without an explicit node-version inherits the runner default`,
      );
    }
  });

  it("pins every harness-running job at or above the harness's minimum", () => {
    for (const workflow of HARNESS_WORKFLOWS) {
      assert.ok(
        workflow.pins.length > 0,
        `${workflow.file} runs the suites but pins no Node version`,
      );
      for (const pin of workflow.pins) {
        assert.ok(
          pin >= MINIMUM_NODE_VERSION,
          `${workflow.file} pins Node ${pin}; the render harness needs >= ${MINIMUM_NODE_VERSION} for module.registerHooks`,
        );
      }
    }
  });

  it("leaves the build-only workflows free to pin whatever they like", () => {
    // Documents the exemption rather than asserting a version: deploy.yml and
    // eas-preview.yml never load the harness, so their pin is a deploy
    // concern, not a correctness one. The assertion that matters is that they
    // are exempt BECAUSE they run no suites — not because they were skipped.
    for (const workflow of ALL.filter((w) => !w.runsTests)) {
      assert.doesNotMatch(
        workflow.yml.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n"),
        RUNS_THE_HARNESS,
        `${workflow.file} was classified as build-only but invokes the test runner`,
      );
    }
  });

  it("runs this process on a Node that has module.registerHooks at all", async () => {
    const { registerHooks } = await import("node:module");
    assert.equal(
      typeof registerHooks,
      "function",
      `module.registerHooks is missing on Node ${process.versions.node}`,
    );
    assert.ok(Number(process.versions.node.split(".")[0]) >= MINIMUM_NODE_VERSION);
  });
});
