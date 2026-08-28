import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import { readRepoFile as read, repoPath } from "./helpers/repo-file";

const DOC = "docs/metabase-connection.md";

describe("docs/metabase-connection.md (Power BI platform-parity fallback)", () => {
  it("file exists at the canonical path", () => {
    assert.ok(
      existsSync(repoPath(DOC)),
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

  /**
   * Quoted snake_case tokens in the guide are event names, or they are named.
   *
   * The hole here was written inline and unnamed — `.filter((name) =>
   * !["item_added_users"].includes(name))`, under a comment about "SQL keywords
   * / non-event tokens" in the plural over a list of one. Measured 2026-08-28:
   * the guide does not contain `'item_added_users'` anywhere, and neither does
   * the taxonomy, so the exclusion had stopped excusing anything — and the day
   * somebody quotes that token as an event this check would have skipped the
   * one name it exists to catch. The list is empty because nothing needs it.
   *
   * It stays as a NAMED list with the honesty half below rather than being
   * deleted, because a token that genuinely is not an event will turn up again
   * (the query language has plenty), and the version of this hole that goes
   * stale silently is the one written inline at the point of use.
   */
  it("only uses event names that exist in the typed taxonomy", () => {
    /** Quoted snake_case tokens in the guide that are NOT event names. */
    const NOT_EVENTS: readonly string[] = [];
    const taxonomy = read("lib/analytics-events.ts");
    const quoted = src.match(/'([a-z0-9_]+)'/g) ?? [];
    const snakeCase = quoted
      .map((q) => q.slice(1, -1))
      .filter((name) => /^[a-z]+(_[a-z]+)+$/.test(name));
    // Every hole, checked to still be a hole: an entry naming a token the guide
    // no longer quotes excuses nothing while quietly skipping that name on the
    // day it comes back.
    for (const excluded of NOT_EVENTS) {
      assert.ok(
        snakeCase.includes(excluded),
        `${excluded} is excluded from the taxonomy check and the guide no longer quotes it — drop the entry rather than leaving the hole`,
      );
    }
    // And the scan, checked to have scanned: a guide whose queries stopped
    // quoting anything passes this loop having read nothing.
    assert.ok(
      snakeCase.length > 0,
      "no quoted snake_case token was found in the guide at all, so this check is passing against a document it cannot read",
    );
    for (const name of snakeCase) {
      if (NOT_EVENTS.includes(name)) continue;
      if (taxonomy.includes(`${name}:`)) continue;
      assert.fail(`"${name}" is quoted like an event but is not in ANALYTICS_EVENTS`);
    }
  });
});
