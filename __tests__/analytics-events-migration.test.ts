import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural assertions over the analytics_events migration. The actual SQL is
 * executed against Supabase out-of-band; this test guards against accidental
 * regressions in the schema/RLS shape (eg. accidentally granting a SELECT
 * policy that would expose the long-tail event store to end users).
 */

const MIGRATION_PATH = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260508_analytics_events.sql",
);

const SOURCE = readFileSync(MIGRATION_PATH, "utf8");

describe("analytics_events migration", () => {
  it("creates the analytics_events table with the documented columns", () => {
    assert.match(SOURCE, /CREATE TABLE IF NOT EXISTS public\.analytics_events/);
    for (const column of [
      "id",
      "occurred_at",
      "user_id",
      "name",
      "properties",
    ]) {
      assert.match(
        SOURCE,
        new RegExp(`\\b${column}\\b`),
        `missing column declaration for '${column}'`,
      );
    }
  });

  it("uses jsonb for the properties column", () => {
    assert.match(SOURCE, /properties\s+jsonb/);
  });

  it("uses timestamptz with a default of now() for occurred_at", () => {
    assert.match(SOURCE, /occurred_at[\s\S]*timestamptz[\s\S]*DEFAULT now\(\)/);
  });

  it("uses gen_random_uuid as the id default", () => {
    assert.match(SOURCE, /id[\s\S]*uuid[\s\S]*DEFAULT gen_random_uuid\(\)/);
  });

  it("references auth.users for user_id with ON DELETE SET NULL", () => {
    assert.match(
      SOURCE,
      /user_id[\s\S]*REFERENCES auth\.users[\s\S]*ON DELETE SET NULL/,
    );
  });

  it("enforces a non-empty bounded event name", () => {
    assert.match(
      SOURCE,
      /CHECK\s*\(length\(name\)\s*>\s*0\s*AND\s*length\(name\)\s*<=\s*200\)/,
    );
  });

  it("indexes by occurred_at, by name+occurred_at, and by user_id+occurred_at", () => {
    assert.match(
      SOURCE,
      /CREATE INDEX IF NOT EXISTS analytics_events_occurred_at_idx[\s\S]*occurred_at DESC/,
    );
    assert.match(
      SOURCE,
      /CREATE INDEX IF NOT EXISTS analytics_events_name_occurred_idx[\s\S]*name, occurred_at DESC/,
    );
    assert.match(
      SOURCE,
      /CREATE INDEX IF NOT EXISTS analytics_events_user_occurred_idx[\s\S]*user_id, occurred_at DESC/,
    );
  });

  it("enables row level security", () => {
    assert.match(
      SOURCE,
      /ALTER TABLE public\.analytics_events ENABLE ROW LEVEL SECURITY/,
    );
  });

  it("revokes ALL privileges from anon and authenticated roles", () => {
    assert.match(SOURCE, /REVOKE ALL ON public\.analytics_events FROM anon/);
    assert.match(
      SOURCE,
      /REVOKE ALL ON public\.analytics_events FROM authenticated/,
    );
  });

  it("does not expose any policy on analytics_events (RLS-default-deny)", () => {
    assert.doesNotMatch(SOURCE, /CREATE POLICY[^"]*"[^"]*analytics_events[^"]*"/);
  });

  it("does not add the table to the supabase_realtime publication", () => {
    // We deliberately do not stream analytics events to clients.
    assert.doesNotMatch(
      SOURCE,
      /ALTER PUBLICATION supabase_realtime ADD TABLE public\.analytics_events/,
    );
  });

  it("is documented in MANUAL-TASKS.md per CLAUDE.md DB-change rule", () => {
    const manualTasks = readFileSync(
      path.join(process.cwd(), "MANUAL-TASKS.md"),
      "utf8",
    );
    assert.match(manualTasks, /20260508_analytics_events\.sql/);
    assert.match(manualTasks, /analytics_events/);
  });
});
