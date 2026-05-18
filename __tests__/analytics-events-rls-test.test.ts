import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural assertions over the analytics_events RLS verification script
 * (Analytics #16). The SQL runs against Supabase out-of-band; this test
 * guards the *test itself* from regressing (e.g. someone weakening the
 * anon/authenticated deny checks), and confirms MANUAL-TASKS.md documents the
 * checklist per the CLAUDE.md DB-change rule.
 */

const ROOT = process.cwd();
const SQL = readFileSync(
  path.join(ROOT, "supabase", "tests", "analytics_events_rls_test.sql"),
  "utf8",
);
const MANUAL = readFileSync(path.join(ROOT, "MANUAL-TASKS.md"), "utf8");

describe("analytics_events RLS verification script", () => {
  it("checks the table exists and RLS is enabled", () => {
    assert.match(SQL, /to_regclass\('public\.analytics_events'\)\s+IS NULL/);
    assert.match(SQL, /relrowsecurity/);
    assert.match(SQL, /NOT rls_enabled/);
  });

  it("fails if any RLS policy exists (deny-all posture)", () => {
    assert.match(SQL, /FROM pg_policies/);
    assert.match(SQL, /tablename = 'analytics_events'/);
    assert.match(SQL, /policy_count <> 0/);
  });

  it("asserts anon holds no table privilege", () => {
    for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      assert.match(
        SQL,
        new RegExp(
          `has_table_privilege\\('anon', 'public\\.analytics_events', '${priv}'\\)`,
        ),
      );
    }
  });

  it("asserts authenticated holds no table privilege", () => {
    for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      assert.match(
        SQL,
        new RegExp(
          `has_table_privilege\\('authenticated', 'public\\.analytics_events', '${priv}'\\)`,
        ),
      );
    }
  });

  it("functionally denies SELECT as anon and as authenticated", () => {
    assert.match(SQL, /SET LOCAL ROLE anon;/);
    assert.match(SQL, /SET LOCAL ROLE authenticated;/);
    assert.match(SQL, /WHEN insufficient_privilege THEN/);
    assert.match(SQL, /SELECT AS anon was NOT denied/);
    assert.match(SQL, /SELECT AS authenticated was NOT denied/);
  });

  it("confirms the service_role / Power BI read path still works", () => {
    assert.match(SQL, /service\/superuser SELECT was denied/);
    assert.match(SQL, /RAISE NOTICE 'analytics_events RLS test PASSED/);
  });

  it("performs no DML (safe to run against production)", () => {
    assert.doesNotMatch(SQL, /\bINSERT\s+INTO\b/i);
    assert.doesNotMatch(SQL, /\bUPDATE\s+public\./i);
    assert.doesNotMatch(SQL, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(SQL, /\b(TRUNCATE|DROP\s+TABLE)\b/i);
  });
});

describe("MANUAL-TASKS.md documents the Analytics #16 checklist", () => {
  it("references the verification script and the run command", () => {
    assert.match(MANUAL, /analytics_events_rls_test\.sql/);
    assert.match(MANUAL, /psql "\$SUPABASE_DB_URL"/);
    assert.match(MANUAL, /Analytics #16/);
  });

  it("lists the deny-all checklist items", () => {
    assert.match(MANUAL, /Row level security is \*\*enabled\*\*/);
    assert.match(MANUAL, /\*\*Zero\*\* RLS policies/);
    assert.match(MANUAL, /`anon` role holds \*\*no\*\*/);
    assert.match(MANUAL, /`authenticated` role holds \*\*no\*\*/);
    assert.match(MANUAL, /`service_role`\/superuser \*\*succeeds\*\*/);
  });
});
