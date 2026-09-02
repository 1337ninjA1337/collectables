import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";

import { repoPath, readRepoFile } from "./helpers/repo-file";

/**
 * Every document in `.tasks/`, classified — so a new one cannot skip the
 * question that cost this repo three audits.
 *
 * ## The question
 *
 * Three `.tasks/` documents described work as TO DO that had shipped in full
 * (`.security-upgrade.md`, `.be-suggestions.md`, `.design.md`). Each now opens
 * with a `STATUS AUDIT` table, and `status-audit-paths.test.ts` keeps those
 * tables' citations real.
 *
 * What neither of those does is say WHICH documents are supposed to carry an
 * audit. That list was three names in a test with no stated rationale, so the
 * next document added to `.tasks/` inherits nothing: it is a plan or a runbook
 * or a queue, and whichever it is, no case has an opinion.
 *
 * ## The classification
 *
 * A `.tasks/` document is exactly one of three things, and the difference is
 * whether "is this done?" is a question about THIS REPO:
 *
 *   - a PLAN describes work in the tree — auditable, and audited;
 *   - a RUNBOOK describes steps an operator takes OUTSIDE the tree (creating a
 *     PostHog project, pasting a key into GitHub Secrets). Nothing in the repo
 *     can be inspected to decide whether it is "done", so an audit table would
 *     be a fabrication;
 *   - a QUEUE is live state this loop reads and writes every run.
 *
 * The completeness case is the point: a file in none of the three fails, which
 * forces the decision at the moment somebody adds a document rather than
 * whenever a later run happens to notice.
 */

/** Plans: describe repo work, must carry a `STATUS AUDIT` block. */
const PLANS = [".security-upgrade.md", ".be-suggestions.md", ".design.md"] as const;

/**
 * Runbooks: operator steps outside the tree, so an audit is not applicable.
 *
 * The reason is recorded per file because "no audit" and "nobody has audited
 * it yet" look identical from outside, and the whole point of this session's
 * audits was that the second was mistaken for the first for months.
 */
const RUNBOOKS: Readonly<Record<string, string>> = {
  ".analytics-setup.md":
    "provisioning walkthrough for PostHog/Clarity env vars — the steps happen in third-party dashboards and GitHub Secrets, not in this tree",
  ".sentry-setup.md":
    "provisioning walkthrough for the Sentry DSN and env — same: nothing here can be read to decide whether it is done",
};

/** Queues: live state this loop reads and writes. */
const QUEUES = [".tasks.md", ".suggestions.md"] as const;

const TASKS_DIR = ".tasks";

function tasksDocs(): readonly string[] {
  return readdirSync(repoPath(TASKS_DIR))
    .filter((name) => name.endsWith(".md"))
    .sort();
}

describe(".tasks/ documents are classified", () => {
  it("finds the documents rather than an empty directory", () => {
    // A read that found nothing would make every case below vacuously true,
    // which is the failure mode every derived rule in this repo has had once.
    assert.ok(
      tasksDocs().length >= 5,
      `only ${String(tasksDocs().length)} markdown files in ${TASKS_DIR}/ — the directory read has probably broken`,
    );
  });

  it("puts every document in exactly one category", () => {
    // The completeness guard. A document in none of the three is one nobody
    // decided about, which is how a plan ends up read as a queue.
    const classified = new Set<string>([...PLANS, ...Object.keys(RUNBOOKS), ...QUEUES]);
    const unclassified = tasksDocs().filter((name) => !classified.has(name));
    assert.deepEqual(
      unclassified,
      [],
      `${unclassified.join(", ")} in ${TASKS_DIR}/ is neither a PLAN (describes repo work — give it a STATUS AUDIT), a RUNBOOK (operator steps outside the tree) nor a QUEUE (live loop state). Pick one in tasks-doc-classification.test.ts.`,
    );
  });

  it("carries no classification for a document that has been deleted", () => {
    // The other direction, the way every exemption list here is kept honest:
    // a name that no longer exists is a decision about nothing.
    const present = new Set(tasksDocs());
    const missing = [...PLANS, ...Object.keys(RUNBOOKS), ...QUEUES].filter(
      (name) => !present.has(name),
    );
    assert.deepEqual(missing, [], `classified but absent from ${TASKS_DIR}/: ${missing.join(", ")}`);
  });

  it("gives every plan the audit block its classification promises", () => {
    for (const plan of PLANS) {
      assert.match(
        readRepoFile(`${TASKS_DIR}/${plan}`),
        /## STATUS AUDIT/,
        `${plan} is classified as a plan and carries no STATUS AUDIT — audit it, or reclassify it`,
      );
    }
  });

  it("gives every runbook a stated reason, and no audit block", () => {
    for (const [runbook, why] of Object.entries(RUNBOOKS)) {
      assert.ok(why.length > 30, `${runbook}: "not auditable" needs a reason somebody can dispute`);
      assert.ok(
        !readRepoFile(`${TASKS_DIR}/${runbook}`).includes("## STATUS AUDIT"),
        `${runbook} is classified as a runbook and carries a STATUS AUDIT — one of the two is wrong`,
      );
    }
  });
});
