import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * BE-27 — `20260627_retention_sweeps.sql` adds daily `pg_cron` retention
 * sweeps so three classes of data don't grow forever:
 *   1. analytics_events long tail   — 13 months
 *   2. anonymous analytics (NULL)   — 30 days (most aggressive)
 *   3. soft-delete tombstones       — 90 days hard-delete grace
 *
 * Structural guards (the actual DELETEs/cron job run on the Docker-backed
 * supabase-test CI, not here):
 *   (1) one SECURITY DEFINER `run_retention_sweeps()` granted service_role-only;
 *   (2) each of the three windows is present with its documented interval;
 *   (3) the tombstone sweep covers exactly the four user-deletable tables;
 *   (4) cron scheduling is guarded on pg_cron + unschedule-before-schedule;
 *   (5) idempotent (`CREATE OR REPLACE`);
 *   (6) documented in MANUAL-TASKS.md + the README apply order;
 *   (7) the privacy policy spells out all three windows.
 */

const ROOT = process.cwd();
const MIGRATION = readFileSync(
  path.join(ROOT, "supabase", "migrations", "20260627_retention_sweeps.sql"),
  "utf8",
);
const MANUAL = readFileSync(path.join(ROOT, "MANUAL-TASKS.md"), "utf8");
const README = readFileSync(path.join(ROOT, "README-DEPLOY.md"), "utf8");
const APPSTORE = readFileSync(path.join(ROOT, "APPSTORE-SUBMISSION.md"), "utf8");

// strip `-- ...` line comments so prose doesn't trip the SQL assertions.
const SQL = MIGRATION.replace(/--.*$/gm, "");

const DELETABLE = ["collections", "items", "profiles", "friend_requests"];

describe("retention-sweeps migration (BE-27)", () => {
  it("defines a SECURITY DEFINER run_retention_sweeps() granted only to service_role", () => {
    assert.match(
      SQL,
      /CREATE OR REPLACE FUNCTION public\.run_retention_sweeps\(\)/i,
    );
    assert.match(SQL, /SECURITY DEFINER/i);
    assert.match(SQL, /SET search_path = public/i);
    assert.match(
      SQL,
      /REVOKE ALL ON FUNCTION public\.run_retention_sweeps\(\) FROM PUBLIC/i,
    );
    assert.match(
      SQL,
      /GRANT EXECUTE ON FUNCTION public\.run_retention_sweeps\(\) TO service_role/i,
    );
  });

  it("prunes the analytics_events long tail at 13 months", () => {
    assert.match(
      SQL,
      /DELETE FROM public\.analytics_events[\s\S]*?occurred_at < now\(\) - interval '13 months'/i,
    );
  });

  it("prunes abandoned anonymous analytics (user_id IS NULL) at 30 days", () => {
    assert.match(
      SQL,
      /DELETE FROM public\.analytics_events[\s\S]*?user_id IS NULL[\s\S]*?occurred_at < now\(\) - interval '30 days'/i,
    );
  });

  it("hard-deletes soft-delete tombstones after 90 days on the four deletable tables", () => {
    const arrayBlock = SQL.match(/FOREACH[\s\S]*?ARRAY\[([\s\S]*?)\]/i);
    assert.ok(arrayBlock, "no FOREACH ARRAY[...] tombstone table list found");
    const names = (arrayBlock![1].match(/'[a-z_]+'/g) ?? []).map((s) =>
      s.replace(/'/g, ""),
    );
    assert.deepEqual(new Set(names), new Set(DELETABLE));
    assert.equal(names.length, DELETABLE.length);
    assert.match(SQL, /deleted_at IS NOT NULL/i);
    assert.match(SQL, /deleted_at < now\(\) - interval ''90 days''/i);
  });

  it("schedules via pg_cron only when the extension exists, unscheduling first", () => {
    assert.match(SQL, /pg_extension WHERE extname = 'pg_cron'/i);
    assert.match(SQL, /cron\.unschedule\('retention-sweeps'\)/i);
    assert.match(
      SQL,
      /cron\.schedule\(\s*'retention-sweeps',\s*'0 3 \* \* \*'/i,
    );
  });

  it("is idempotent to re-apply (CREATE OR REPLACE, no bare CREATE FUNCTION)", () => {
    assert.match(SQL, /CREATE OR REPLACE FUNCTION/i);
    assert.doesNotMatch(SQL, /CREATE FUNCTION public\./i);
  });

  it("is documented in MANUAL-TASKS.md and the README apply order", () => {
    assert.ok(
      MANUAL.includes("## 20260627_retention_sweeps.sql"),
      "MANUAL-TASKS.md must have a section for the migration",
    );
    assert.match(README, /20260627_retention_sweeps\.sql/);
  });

  it("documents all three retention windows in the privacy policy", () => {
    const m = APPSTORE.match(/Server-side data retention[\s\S]*?\n\n/);
    assert.ok(m, "APPSTORE-SUBMISSION.md must have a server-side retention note");
    const para = m![0];
    assert.match(para, /13 months/);
    assert.match(para, /30 days/);
    assert.match(para, /90-day/);
    assert.match(para, /pg_cron/);
  });
});
