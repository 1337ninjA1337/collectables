import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Analytics #16 — the RLS leak check is executed against Supabase out-of-band;
 * this test guards the two things CI *can* assert: (1) the migration keeps its
 * default-deny posture (REVOKE ALL + RLS + no CREATE POLICY), and (2)
 * MANUAL-TASKS.md ships the operator-runnable anon/authenticated leak check so
 * the verification step can't silently disappear.
 */

const ROOT = process.cwd();
const MIGRATION = readFileSync(
  path.join(ROOT, "supabase", "migrations", "20260508_analytics_events.sql"),
  "utf8",
);
const MANUAL = readFileSync(path.join(ROOT, "MANUAL-TASKS.md"), "utf8");

// strip `-- ...` line comments so "No CREATE POLICY ... on purpose" prose
// doesn't trip the executable-SQL assertion below.
const MIGRATION_SQL = MIGRATION.replace(/--.*$/gm, "");

describe("analytics_events default-deny posture (Analytics #16)", () => {
  it("enables RLS on the table", () => {
    assert.match(
      MIGRATION,
      /ALTER TABLE public\.analytics_events ENABLE ROW LEVEL SECURITY/,
    );
  });

  it("revokes all privileges from anon and authenticated", () => {
    assert.match(MIGRATION, /REVOKE ALL ON public\.analytics_events FROM anon/);
    assert.match(
      MIGRATION,
      /REVOKE ALL ON public\.analytics_events FROM authenticated/,
    );
  });

  it("creates NO policy (RLS-with-no-policy is the deny mechanism)", () => {
    assert.doesNotMatch(
      MIGRATION_SQL,
      /CREATE\s+POLICY/i,
      "a policy on analytics_events would expose the event store to end users",
    );
  });
});

describe("MANUAL-TASKS.md ships the RLS leak check (Analytics #16)", () => {
  it("documents the leak check under the analytics_events section", () => {
    assert.match(MANUAL, /RLS leak check \(Analytics #16\)/);
  });

  it("checks both the anon and authenticated roles", () => {
    assert.match(MANUAL, /SET ROLE anon;/);
    assert.match(MANUAL, /SET ROLE authenticated;/);
    assert.match(MANUAL, /SELECT count\(\*\) FROM public\.analytics_events;/);
  });

  it("states the expected permission-denied failure for end users", () => {
    assert.match(MANUAL, /permission denied for table analytics_events/);
    assert.match(MANUAL, /42501/);
  });

  it("includes the service_role sanity counter-check", () => {
    assert.match(MANUAL, /SET ROLE service_role;/);
    assert.match(MANUAL, /service_role_visible_rows/);
  });

  it("frames a non-erroring anon/authenticated result as a leak regression", () => {
    assert.match(MANUAL, /data-leak regression/i);
  });
});
