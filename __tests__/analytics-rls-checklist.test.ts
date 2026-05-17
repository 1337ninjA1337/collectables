import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Analytics #16 — structural guard over the RLS-lockdown verification
 * checklist in MANUAL-TASKS.md. We can't run a live Supabase role check in
 * CI, so the deliverable is an operator-runnable SQL checklist; this test
 * makes sure it stays present and keeps asserting the right posture
 * (anon + authenticated denied, service_role allowed).
 */

const MANUAL_TASKS = readFileSync(
  join(__dirname, "..", "MANUAL-TASKS.md"),
  "utf8",
);

describe("MANUAL-TASKS.md analytics_events RLS checklist (Analytics #16)", () => {
  it("has an Analytics #16 verification section for analytics_events", () => {
    assert.match(MANUAL_TASKS, /Verify the RLS lock-down \(Analytics #16\)/);
    assert.match(MANUAL_TASKS, /public\.analytics_events/);
  });

  it("checks anon and authenticated are denied SELECT, service_role allowed", () => {
    assert.match(MANUAL_TASKS, /SET ROLE anon;/);
    assert.match(MANUAL_TASKS, /SET ROLE authenticated;/);
    assert.match(MANUAL_TASKS, /SET ROLE service_role;/);
    // anon + authenticated must expect a permission-denied error.
    const denied = MANUAL_TASKS.match(/permission denied for table analytics_events/g) ?? [];
    assert.ok(
      denied.length >= 2,
      "expected anon + authenticated steps to both EXPECT a permission-denied error",
    );
  });

  it("documents the remediation if the lock-down regresses", () => {
    assert.match(
      MANUAL_TASKS,
      /REVOKE ALL ON public\.analytics_events FROM anon, authenticated/,
    );
    assert.match(MANUAL_TASKS, /DROP POLICY/);
  });

  it("ties the checklist to a pass/fail acceptance list", () => {
    // Three checkboxes — the operator-facing acceptance criteria.
    const boxes = MANUAL_TASKS.match(/- \[ \] Step [123]/g) ?? [];
    assert.equal(boxes.length, 3, "expected exactly three Step-N checkboxes");
  });
});
