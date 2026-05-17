import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Structural guard for the Analytics #16 RLS leakage test. The SQL itself
 * runs out-of-band against Supabase; this test ensures the assertion script
 * and its MANUAL-TASKS.md checklist stay present and keep covering BOTH the
 * anon and authenticated roles plus the service-role read-back — so a future
 * edit can't quietly weaken the leakage check.
 */

const ROOT = process.cwd();
const SQL_PATH = path.join(ROOT, "supabase", "tests", "analytics_events_rls.sql");
const MANUAL_TASKS = path.join(ROOT, "MANUAL-TASKS.md");

describe("analytics_events RLS leakage test (Analytics #16)", () => {
  it("ships the SQL assertion script", () => {
    assert.ok(
      existsSync(SQL_PATH),
      "supabase/tests/analytics_events_rls.sql must be checked in",
    );
  });

  const sql = readFileSync(SQL_PATH, "utf8");

  it("seeds a probe row and rolls back so the test is side-effect free", () => {
    assert.match(sql, /\bBEGIN\b/);
    assert.match(sql, /INSERT INTO public\.analytics_events/);
    assert.match(sql, /\bROLLBACK\b/);
    // No COMMIT — the probe row must never persist.
    assert.ok(!/\bCOMMIT\b/i.test(sql), "the test must not COMMIT the probe row");
  });

  it("asserts anon AND authenticated are denied SELECT", () => {
    assert.match(sql, /SET LOCAL ROLE anon/);
    assert.match(sql, /SET LOCAL ROLE authenticated/);
    // Both denial paths key off the privilege-denied SQLSTATE.
    const handlers = sql.match(/WHEN insufficient_privilege THEN/g) ?? [];
    assert.ok(
      handlers.length >= 2,
      "both anon and authenticated must catch insufficient_privilege",
    );
    assert.match(sql, /SECURITY FAIL: anon can SELECT/);
    assert.match(sql, /SECURITY FAIL: authenticated can SELECT/);
  });

  it("confirms the RLS-bypassing role can still read (pipeline not broken)", () => {
    assert.match(sql, /count\(\*\)[\s\S]*public\.analytics_events/);
    assert.match(sql, /SECURITY FAIL: service_role cannot read/);
  });

  it("is documented as a verification checklist in MANUAL-TASKS.md", () => {
    const manual = readFileSync(MANUAL_TASKS, "utf8");
    assert.match(manual, /Analytics #16/);
    assert.match(manual, /supabase\/tests\/analytics_events_rls\.sql/);
    assert.match(manual, /anon SELECT denied/);
    assert.match(manual, /authenticated SELECT denied/);
  });
});
