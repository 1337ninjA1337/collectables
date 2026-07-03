import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural guards for the EAS iOS preview build-on-merge workflow. The
 * workflow is fire-and-forget and its results live in the Expo dashboard, so
 * a silent misconfiguration (wrong profile, missing skip-gate, a --wait that
 * burns runner minutes) would otherwise go unnoticed for weeks.
 */

const root = process.cwd();
const workflow = readFileSync(
  path.join(root, ".github", "workflows", "eas-preview.yml"),
  "utf8",
);
const easJson = JSON.parse(readFileSync(path.join(root, "eas.json"), "utf8"));
const readmeDeploy = readFileSync(path.join(root, "README-DEPLOY.md"), "utf8");

describe("eas-preview workflow", () => {
  it("triggers on main pushes and manual dispatch", () => {
    assert.match(workflow, /push:\s*\n\s*branches: \[main\]/);
    assert.ok(workflow.includes("workflow_dispatch:"));
  });

  it("queues the exact fire-and-forget build command", () => {
    assert.ok(
      workflow.includes(
        "npx eas-cli@latest build --platform ios --profile preview --non-interactive --no-wait",
      ),
      "workflow must queue the preview build without waiting (a --wait would hold a runner for the whole native build)",
    );
  });

  it("builds a profile that exists in eas.json", () => {
    const match = workflow.match(/--profile (\S+)/);
    assert.ok(match, "workflow must pass an explicit --profile");
    assert.ok(
      easJson.build?.[match![1]],
      `eas.json has no '${match![1]}' build profile`,
    );
  });

  it("skips gracefully when EXPO_TOKEN is not configured", () => {
    assert.ok(
      workflow.includes('if [ -n "$EXPO_TOKEN" ]'),
      "workflow must probe the secret's presence",
    );
    const gatedSteps = workflow.match(
      /if: steps\.token\.outputs\.present == 'true'/g,
    );
    assert.ok(
      (gatedSteps?.length ?? 0) >= 2,
      "npm ci and the build step must both be gated on the token probe",
    );
  });

  it("caps queued builds via concurrency with cancel-in-progress", () => {
    assert.ok(workflow.includes("group: eas-preview"));
    assert.ok(workflow.includes("cancel-in-progress: true"));
  });

  it("requests only read permissions", () => {
    assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  });

  it("is documented in README-DEPLOY.md with the EXPO_TOKEN secret", () => {
    assert.ok(
      readmeDeploy.includes("eas-preview.yml"),
      "README-DEPLOY.md must reference the workflow",
    );
    assert.ok(
      readmeDeploy.includes("EXPO_TOKEN"),
      "README-DEPLOY.md must document the EXPO_TOKEN secret",
    );
  });
});
