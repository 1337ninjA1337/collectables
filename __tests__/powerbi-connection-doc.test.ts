import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const DOC = "docs/powerbi-connection.md";

describe("docs/powerbi-connection.md (Analytics #14)", () => {
  it("file exists at the canonical path", () => {
    assert.ok(
      existsSync(join(ROOT, DOC)),
      "docs/powerbi-connection.md must be checked into the repo so the BI connection guide is reproducible",
    );
  });

  it("documents how to install Power BI Desktop (free)", () => {
    const src = readFileSync(join(ROOT, DOC), "utf8");
    assert.match(src, /Power BI Desktop/);
    assert.match(src, /free/i);
    // The Microsoft download page anchor we link must be the official one.
    assert.match(src, /aka\.ms\/pbi/);
    // Note Mac/Linux users need a workaround.
    assert.match(src, /mac|macOS|Linux/i);
  });

  it("references the Supabase session pooler / connection string", () => {
    const src = readFileSync(join(ROOT, DOC), "utf8");
    assert.match(src, /pooler\.supabase\.com/);
    assert.match(src, /5432/);
    assert.match(src, /postgres/);
  });

  it("flags that Power BI must use the service-role key (RLS-default-deny)", () => {
    const src = readFileSync(join(ROOT, DOC), "utf8");
    assert.match(src, /service[- ]role/i);
    assert.match(src, /RLS|row[- ]level security/i);
  });

  it("documents every analytics_events column from the Analytics #12 schema", () => {
    const src = readFileSync(join(ROOT, DOC), "utf8");
    for (const column of [
      "id",
      "occurred_at",
      "user_id",
      "name",
      "properties",
    ]) {
      assert.match(
        src,
        new RegExp(`\`${column}\``),
        `Schema reference must mention column \`${column}\``,
      );
    }
    assert.match(src, /jsonb/);
    assert.match(src, /timestamptz/);
    assert.match(src, /uuid/);
  });

  it("ships three sample DAX measures (DAU, listing funnel, premium conversion)", () => {
    const src = readFileSync(join(ROOT, DOC), "utf8");
    assert.match(src, /DAU\s*:=/);
    assert.match(src, /ListingsCreated\s*:=/);
    assert.match(src, /ItemsAdded\s*:=/);
    assert.match(src, /PremiumActivationsLast7d\s*:=/);
    assert.match(src, /PremiumConversionRate7d\s*:=/);
    // The funnel measures must reference the typed-union event names.
    assert.match(src, /"item_added"/);
    assert.match(src, /"listing_created"/);
    assert.match(src, /"signup_completed"/);
    assert.match(src, /"premium_activated"/);
  });

  it("uses DISTINCTCOUNT on user_id (not row count) so power users count once", () => {
    const src = readFileSync(join(ROOT, DOC), "utf8");
    assert.match(src, /DISTINCTCOUNT\s*\(\s*analytics_events\[user_id\]/);
  });

  it("references DirectQuery vs Import trade-off", () => {
    const src = readFileSync(join(ROOT, DOC), "utf8");
    assert.match(src, /DirectQuery/);
    assert.match(src, /Import/);
  });

  it("links the migration, taxonomy, and decision-record companions", () => {
    const src = readFileSync(join(ROOT, DOC), "utf8");
    assert.match(src, /20260508_analytics_events\.sql/);
    assert.match(src, /lib\/analytics-events\.ts/);
    assert.match(src, /analytics-platform\.md/);
  });

  it("notes screenshots are pending the Analytics #15 .pbit template", () => {
    const src = readFileSync(join(ROOT, DOC), "utf8");
    assert.match(src, /screenshots/i);
    assert.match(src, /pbit|Analytics #15/);
  });
});
