import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { readRepoFile } from "./helpers/repo-file";

/**
 * Structural guards for the EAS iOS preview build-on-merge workflow. The
 * workflow is fire-and-forget and its results live in the Expo dashboard, so
 * a silent misconfiguration (wrong profile, missing skip-gate, a --wait that
 * burns runner minutes) would otherwise go unnoticed for weeks.
 */

const workflow = readRepoFile(".github", "workflows", "eas-preview.yml");
const easJson = JSON.parse(readRepoFile("eas.json"));
const readmeDeploy = readRepoFile("README-DEPLOY.md");

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

  /**
   * The check is named "EAS iOS preview build" and goes green for having
   * QUEUED one. That is the right trade — waiting would hold a runner for a
   * twenty-minute native build whose result nothing here reads — but it leaves
   * a green check making a claim about building that nobody measured, which is
   * the reading a green check invites. These pin the sentence that corrects
   * it, in the place a reader lands.
   */
  it("says in its summary that a green check means queued, not built", () => {
    assert.match(workflow, /GITHUB_STEP_SUMMARY/, "the job must write a summary at all");
    assert.match(workflow, /QUEUED\. It has not been built/);
    assert.match(
      workflow,
      /not because the native app compiles/,
      "the summary has to name the claim it is NOT making, or it reads as a status line",
    );
  });

  it("writes that summary whatever happened, including the two non-build paths", () => {
    // A summary that only ran after a successful queue would be missing on
    // exactly the runs whose green (skipped token) or red (queue refused) is
    // hardest to read.
    assert.match(workflow, /Say what the green check means\n\s*if: always\(\)/);
    assert.match(workflow, /Nothing was queued\./, "the EXPO_TOKEN-absent path");
    assert.match(workflow, /The build was not queued\./, "the queue-failed path");
  });

  it("sends the reader where the outcome actually is", () => {
    // Best-effort link to the build page, and the dashboard as the fallback:
    // a summary that says "the outcome is elsewhere" without saying where is
    // the same dead end in politer words.
    assert.match(workflow, /build_url=/, "the queued build page is captured from the CLI output");
    assert.match(workflow, /https:\/\/expo\.dev/, "and the dashboard is named when it is not");
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

  it("makes the same queued-not-built point in the deploy doc", () => {
    // The summary is read by whoever opens the run; the doc is read by whoever
    // is deciding whether the native target is covered. Both audiences have
    // been getting the green check's optimistic reading.
    assert.match(readmeDeploy, /a build was queued/i);
    assert.match(readmeDeploy, /not that the\s+native app built/);
  });
});
