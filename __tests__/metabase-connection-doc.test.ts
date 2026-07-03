import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const DOC = "docs/metabase-connection.md";
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("docs/metabase-connection.md (Power BI platform-parity fallback)", () => {
  it("file exists at the canonical path", () => {
    assert.ok(
      existsSync(join(ROOT, DOC)),
      "docs/metabase-connection.md must be checked in so Linux engineers have a documented BI path",
    );
  });

  const src = read(DOC);

  it("documents a free cross-platform install (Docker + JAR)", () => {
    assert.match(src, /docker run/);
    assert.match(src, /metabase\/metabase/);
    assert.match(src, /jar/i);
    assert.match(src, /free/i);
  });

  it("references the same Supabase session-pooler connection as the Power BI guide", () => {
    assert.match(src, /pooler\.supabase\.com/);
    assert.match(src, /5432/);
    assert.match(src, /postgres\.<project-ref>/);
    assert.match(src, /powerbi:conn/);
  });

  it("flags the service-role / RLS caveat", () => {
    assert.match(src, /service[- ]role/i);
    assert.match(src, /RLS/);
  });

  it("translates all three DAX measures into SQL over analytics_events", () => {
    assert.match(src, /count\(DISTINCT user_id\)/i);
    // DAU excludes anonymous rows, mirroring NOT ISBLANK.
    assert.match(src, /user_id IS NOT NULL/);
    // Funnel + conversion events, same names as the DAX filters.
    for (const event of [
      "item_added",
      "listing_created",
      "signup_completed",
      "premium_activated",
    ]) {
      assert.match(
        src,
        new RegExp(`'${event}'`),
        `SQL measures must filter on '${event}'`,
      );
    }
    // 7-day window anchored to the newest event, mirroring DATESINPERIOD.
    assert.match(src, /interval '7 days'/);
    assert.match(src, /max\(occurred_at\)/i);
    // Guard against divide-by-zero, mirroring DAX DIVIDE.
    assert.match(src, /NULLIF/);
  });

  it("cross-links with the Power BI guide in both directions", () => {
    assert.match(src, /powerbi-connection\.md/);
    const powerbi = read("docs/powerbi-connection.md");
    assert.match(powerbi, /metabase-connection\.md/);
  });

  it("only uses event names that exist in the typed taxonomy", () => {
    const taxonomy = read("lib/analytics-events.ts");
    const quoted = src.match(/'([a-z0-9_]+)'/g) ?? [];
    const eventLike = quoted
      .map((q) => q.slice(1, -1))
      .filter((name) => /^[a-z]+(_[a-z]+)+$/.test(name))
      // SQL keywords / non-event tokens used in the queries.
      .filter((name) => !["item_added_users"].includes(name));
    for (const name of eventLike) {
      if (taxonomy.includes(`${name}:`)) continue;
      assert.fail(`"${name}" is quoted like an event but is not in ANALYTICS_EVENTS`);
    }
  });
});
