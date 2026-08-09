import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { MINIMUM_NODE_VERSION } from "./helpers/render";

/**
 * Pins CI's Node version against the render harness's floor.
 *
 * The harness aliases `react-native` and `@expo/vector-icons` with
 * `module.registerHooks`, which shipped in Node 22.15. CI ran Node 20 when the
 * harness landed, and the result was the worst shape a failure can take: every
 * suite that imports the harness died at load with `registerHooks is not a
 * function`, the total test count silently DROPPED by the number of cases
 * those files contained, and the local run — on Node 22 — was green. Nothing
 * in the diff pointed at the runner.
 *
 * So the version lives in two places by necessity, and this is the assertion
 * that keeps them agreeing. A future "let's go back to 20" or a
 * `setup-node` bump that misses one job fails here, in a named test, rather
 * than as a count that quietly shrinks.
 */

const CI_YML = path.join(process.cwd(), ".github", "workflows", "ci.yml");

function nodeVersionPins(): number[] {
  const yml = readFileSync(CI_YML, "utf8");
  const matches = [...yml.matchAll(/node-version:\s*'?(\d+)'?/g)];
  return matches.map((match) => Number(match[1]));
}

describe("CI Node version vs the render harness floor", () => {
  it("declares a node-version for every setup-node step", () => {
    const yml = readFileSync(CI_YML, "utf8");
    const setupSteps = [...yml.matchAll(/uses:\s*actions\/setup-node@/g)].length;
    assert.equal(
      nodeVersionPins().length,
      setupSteps,
      "a setup-node step without an explicit node-version inherits the runner default",
    );
  });

  it("pins every job at or above the harness's minimum", () => {
    const pins = nodeVersionPins();
    assert.ok(pins.length > 0, "ci.yml must pin a Node version");
    for (const pin of pins) {
      assert.ok(
        pin >= MINIMUM_NODE_VERSION,
        `ci.yml pins Node ${pin}; the render harness needs >= ${MINIMUM_NODE_VERSION} for module.registerHooks`,
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
