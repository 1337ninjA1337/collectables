import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural assertions over the analytics_events RLS verification script
 * (Analytics #16). The SQL is executed against Supabase out-of-band; this
 * test guards the *test itself* from regressing into a vacuous check (eg.
 * losing the anon/authenticated roles, the positive control, or the
 * ROLLBACK that keeps the probe row from persisting).
 */

const ROOT = path.join(__dirname, "..");
const SQL_PATH = path.join(ROOT, "supabase", "tests", "analytics_events_rls.sql");
const SOURCE = readFileSync(SQL_PATH, "utf8");

describe("analytics_events RLS test script", () => {
  it("exists at the canonical supabase/tests path", () => {
    assert.ok(existsSync(SQL_PATH), "supabase/tests/analytics_events_rls.sql must be checked in");
  });

  it("probes both untrusted end-user roles", () => {
    assert.match(SOURCE, /ARRAY\['anon',\s*'authenticated'\]/);
  });

  it("asserts SELECT is denied at both defence layers", () => {
    // grant layer: REVOKE → insufficient_privilege
    assert.match(SOURCE, /insufficient_privilege/);
    // RLS layer: even with privilege, default-deny returns 0 rows
    assert.match(SOURCE, /leaked\s*<>\s*0/);
    assert.match(SOURCE, /LEAK: role % can SELECT/);
  });

  it("also asserts INSERT (write tampering) is denied", () => {
    assert.match(SOURCE, /could INSERT into analytics_events/);
  });

  it("has a positive control so the deny checks can't pass vacuously", () => {
    assert.match(SOURCE, /positive control failed/);
    assert.match(SOURCE, /__rls_probe_event__/);
    assert.match(SOURCE, /ALL ANALYTICS_EVENTS RLS CHECKS PASSED/);
  });

  it("runs in a rolled-back transaction so the probe never persists", () => {
    assert.match(SOURCE, /^BEGIN;/m);
    assert.match(SOURCE, /^ROLLBACK;/m);
    assert.doesNotMatch(SOURCE, /^COMMIT;/m);
  });

  it("is documented in MANUAL-TASKS.md per the CLAUDE.md DB rule", () => {
    const manual = readFileSync(path.join(ROOT, "MANUAL-TASKS.md"), "utf8");
    assert.match(manual, /analytics_events_rls\.sql/);
  });
});
