import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * Structural assertions over the Power BI starter assets (Analytics #15a).
 * The .pbit binary (Analytics #15b) is generated from these and can only be
 * validated in Power BI Desktop; these text assets are the CI-verifiable
 * source of truth and the copy-paste fallback.
 */

const ROOT = join(__dirname, "..");
const M = "docs/powerbi/queries.m";
const DAX = "docs/powerbi/measures.dax";
const README = "docs/powerbi/README.md";

const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("docs/powerbi/queries.m (Analytics #15a)", () => {
  it("exists at the canonical path", () => {
    assert.ok(existsSync(join(ROOT, M)), `${M} must be checked in`);
  });

  it("exposes the four Supabase connection parameters", () => {
    const src = read(M);
    for (const p of [
      "SupabaseHost",
      "SupabasePort",
      "SupabaseDb",
      "SupabaseSchema",
    ]) {
      assert.match(src, new RegExp(`\\b${p}\\b`), `missing param ${p}`);
    }
  });

  it("connects via PostgreSQL.Database to the analytics_events table", () => {
    const src = read(M);
    assert.match(src, /PostgreSQL\.Database\s*\(\s*Server\s*,\s*SupabaseDb\s*\)/);
    assert.match(src, /Item\s*=\s*"analytics_events"/);
  });

  it("parses the jsonb properties column defensively", () => {
    const src = read(M);
    assert.match(src, /Json\.Document/);
    assert.match(src, /properties/);
    // try/otherwise so a malformed row doesn't fail the whole refresh.
    assert.match(src, /try\s+Json\.Document\(_\)\s+otherwise\s+null/);
  });

  it("calls out the service_role / RLS requirement", () => {
    const src = read(M);
    assert.match(src, /service_role/);
    assert.match(src, /RLS|denies/i);
  });
});

describe("docs/powerbi/measures.dax (Analytics #15a)", () => {
  it("exists at the canonical path", () => {
    assert.ok(existsSync(join(ROOT, DAX)), `${DAX} must be checked in`);
  });

  it("declares all three starter measure groups verbatim", () => {
    const src = read(DAX);
    for (const name of [
      "DAU :=",
      "ItemsAdded :=",
      "ListingsCreated :=",
      "ListingFunnelRate :=",
      "SignupsLast7d :=",
      "PremiumActivationsLast7d :=",
      "PremiumConversionRate7d :=",
    ]) {
      assert.match(src, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("counts distinct users (not row count) and excludes anon DAU rows", () => {
    const src = read(DAX);
    assert.match(src, /DISTINCTCOUNT\s*\(\s*analytics_events\[user_id\]\s*\)/);
    assert.match(src, /NOT\s*\(\s*ISBLANK\s*\(\s*analytics_events\[user_id\]/);
  });

  it("uses a -7 DAY DATESINPERIOD window for the premium cohort", () => {
    const src = read(DAX);
    assert.match(src, /DATESINPERIOD\s*\([\s\S]*analytics_events\[occurred_at\][\s\S]*-7,\s*\n?\s*DAY/);
  });

  it("filters the funnel on the typed-union event names", () => {
    const src = read(DAX);
    assert.match(src, /analytics_events\[name\]\s*=\s*"item_added"/);
    assert.match(src, /analytics_events\[name\]\s*=\s*"listing_created"/);
    assert.match(src, /analytics_events\[name\]\s*=\s*"signup_completed"/);
    assert.match(src, /analytics_events\[name\]\s*=\s*"premium_activated"/);
  });
});

describe("docs/powerbi/README.md (Analytics #15a)", () => {
  it("exists and links the two importable assets", () => {
    assert.ok(existsSync(join(ROOT, README)), `${README} must be checked in`);
    const src = read(README);
    assert.match(src, /queries\.m/);
    assert.match(src, /measures\.dax/);
  });

  it("documents the paste path and the .pbit (#15b) relationship", () => {
    const src = read(README);
    assert.match(src, /Advanced Editor/);
    assert.match(src, /New measure/);
    assert.match(src, /\.pbit/);
    assert.match(src, /15b|service_role/);
  });

  it("cross-links the connection doc, migration, and event taxonomy", () => {
    const src = read(README);
    assert.match(src, /powerbi-connection\.md/);
    assert.match(src, /20260508_analytics_events\.sql/);
    assert.match(src, /analytics-events\.ts/);
  });
});

describe("powerbi assets <-> connection doc parity", () => {
  it("every measure name in measures.dax also appears in powerbi-connection.md", () => {
    const dax = read(DAX);
    const doc = read("docs/powerbi-connection.md");
    for (const name of [
      "DAU",
      "ItemsAdded",
      "ListingsCreated",
      "ListingFunnelRate",
      "SignupsLast7d",
      "PremiumActivationsLast7d",
      "PremiumConversionRate7d",
    ]) {
      assert.match(dax, new RegExp(`\\b${name}\\b`));
      assert.match(doc, new RegExp(`\\b${name}\\b`), `${name} drifted from the doc`);
    }
  });
});
