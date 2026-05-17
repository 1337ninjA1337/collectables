import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Analytics #16 — guards that MANUAL-TASKS.md ships an operator checklist for
 * verifying the `analytics_events` RLS lock-down on the live database. The SQL
 * is run out-of-band against Supabase; this structural test prevents the
 * verification steps from being silently dropped in a future doc edit.
 */

const MANUAL = readFileSync(
  path.join(process.cwd(), "MANUAL-TASKS.md"),
  "utf8",
);

describe("analytics_events RLS verification checklist (Analytics #16)", () => {
  it("has a dedicated verification section", () => {
    assert.match(MANUAL, /Verify the RLS lock-down \(Analytics #16\)/);
  });

  it("checks anon AND authenticated are denied SELECT", () => {
    assert.match(MANUAL, /SET ROLE anon;/);
    assert.match(MANUAL, /SET ROLE authenticated;/);
    assert.match(MANUAL, /permission denied for table analytics_events/);
  });

  it("documents the privileged (service_role / Power BI) read path", () => {
    assert.match(MANUAL, /the Power BI path|what Power BI uses/);
    assert.match(MANUAL, /SERVICE_ROLE_KEY/);
  });

  it("includes a REST-API cross-check, not just SQL roles", () => {
    assert.match(MANUAL, /rest\/v1\/analytics_events/);
    assert.match(MANUAL, /ANON_KEY/);
    assert.match(MANUAL, /401/);
  });

  it("tells the operator to re-run it after future migrations", () => {
    assert.match(MANUAL, /after every future migration|after every future/i);
  });
});
