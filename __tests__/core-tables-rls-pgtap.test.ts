import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// BE-12b — structural guard for the executable pgTAP RLS test that runs in the
// BE-31 `supabase test db` harness (Docker runner only). This offline test
// just asserts the SQL file exists and exercises the right surface; the actual
// assertions are validated on the PR's Supabase-test CI, not here.

const sql = readFileSync(
  path.join(process.cwd(), "supabase", "tests", "01_core_tables_rls.sql"),
  "utf8",
);

describe("BE-12b — core-tables RLS pgTAP test", () => {
  it("is a self-contained pgTAP plan", () => {
    assert.match(sql, /^\s*begin;/im);
    assert.match(sql, /select plan\(\d+\)/i);
    assert.match(sql, /select \* from finish\(\)/i);
    assert.match(sql, /rollback;/i);
  });

  it("declares a plan count matching the number of assertions", () => {
    const planMatch = sql.match(/select plan\((\d+)\)/i);
    assert.ok(planMatch, "plan(N) must be present");
    const declared = Number(planMatch![1]);
    // Count pgTAP assertion calls (is / throws_ok / lives_ok).
    const assertions = (sql.match(/select\s+(is|throws_ok|lives_ok)\(/gi) ?? [])
      .length;
    assert.equal(
      assertions,
      declared,
      `plan(${declared}) must equal the ${assertions} assertions present`,
    );
  });

  it("seeds auth.users so the FKs to auth resolve", () => {
    assert.match(sql, /insert into auth\.users/i);
  });

  it("switches tenants via request.jwt.claims under the authenticated role", () => {
    assert.match(sql, /set local role authenticated/i);
    assert.match(sql, /request\.jwt\.claims/);
    // resets privilege before pgTAP's catalog-reading finish().
    assert.match(sql, /reset role/i);
  });

  it("unit-tests each SECURITY DEFINER visibility helper", () => {
    for (const fn of ["is_friend", "is_visible_to", "can_view_collection", "is_admin"]) {
      assert.match(sql, new RegExp(`public\\.${fn}\\(`), `must call ${fn}`);
    }
  });

  it("asserts cross-tenant write denies via 42501", () => {
    assert.match(sql, /throws_ok/i);
    assert.match(sql, /'42501'/);
    // self-promotion through the REVOKEd is_admin column is covered.
    assert.match(sql, /is_admin\s*=\s*true/i);
  });

  it("covers public / shared / friend read-visibility paths", () => {
    assert.match(sql, /public/);
    assert.match(sql, /shared/);
    assert.match(sql, /friend/i);
  });
});
