import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const PGTAP = "supabase/tests/03_bi_sql_equivalents.sql";
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// The executable half runs in the Supabase Tests workflow (Docker pgTAP);
// this offline test pins the token-level parity between the pgTAP fixture
// test and the documented Metabase SQL so the two can't silently diverge.
describe("supabase/tests/03_bi_sql_equivalents.sql (offline parity)", () => {
  it("pgTAP file exists so `supabase test db` picks it up", () => {
    assert.ok(existsSync(join(ROOT, PGTAP)));
  });

  const pgtap = read(PGTAP);
  const doc = read("docs/metabase-connection.md");

  it("validates the same measure semantics the docs describe", () => {
    for (const token of [
      "count(DISTINCT user_id)",
      "user_id IS NOT NULL",
      "date_trunc('day', occurred_at)",
      "NULLIF",
      "interval '7 days'",
    ]) {
      assert.ok(pgtap.includes(token), `pgTAP must keep: ${token}`);
      assert.ok(doc.includes(token), `metabase doc must keep: ${token}`);
    }
  });

  it("filters on the same four event names as the documented measures", () => {
    for (const event of [
      "item_added",
      "listing_created",
      "signup_completed",
      "premium_activated",
    ]) {
      assert.ok(pgtap.includes(`'${event}'`), `pgTAP missing '${event}'`);
    }
  });

  it("asserts the three expected results (funnel 0.6667, conversion 0.5)", () => {
    assert.match(pgtap, /0\.6667/);
    assert.match(pgtap, /0\.5/);
    assert.match(pgtap, /select plan\(3\)/);
  });

  it("seeds an anonymous (NULL user_id) row so the exclusion paths are exercised", () => {
    assert.match(pgtap, /\(null,/);
  });

  it("is transactional (begin … rollback) like the other pgTAP files", () => {
    assert.match(pgtap, /^begin;/m);
    assert.match(pgtap, /^rollback;\s*$/m);
  });
});
