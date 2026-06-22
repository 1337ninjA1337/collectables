import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * BE-19 — `20260626_realtime_replica_identity.sql` makes UPDATE/DELETE realtime
 * events deliverable for collections, items and marketplace_listings by (1)
 * adding them to the `supabase_realtime` publication and (2) setting
 * `REPLICA IDENTITY FULL` so a DELETE/filtered-UPDATE carries the full
 * pre-image instead of just the primary key.
 *
 * Structural guards (the actual replication state lives on the Docker-backed
 * supabase-test CI, not here):
 *   (1) exactly the three realtime-extended tables are covered;
 *   (2) REPLICA IDENTITY FULL is set on each;
 *   (3) the publication ADD is guarded by a membership check (idempotent);
 *   (4) it is documented in MANUAL-TASKS.md + the README apply order.
 */

const ROOT = process.cwd();
const MIGRATION = readFileSync(
  path.join(ROOT, "supabase", "migrations", "20260626_realtime_replica_identity.sql"),
  "utf8",
);
const MANUAL = readFileSync(path.join(ROOT, "MANUAL-TASKS.md"), "utf8");
const README = readFileSync(path.join(ROOT, "README-DEPLOY.md"), "utf8");

// strip `-- ...` line comments so prose doesn't trip the SQL assertions.
const SQL = MIGRATION.replace(/--.*$/gm, "");

const TABLES = ["collections", "items", "marketplace_listings"];

describe("realtime replica-identity migration (BE-19)", () => {
  it("covers exactly the three realtime-extended tables in the loop array", () => {
    const arrayBlock = SQL.match(/ARRAY\[([\s\S]*?)\]/i);
    assert.ok(arrayBlock, "no ARRAY[...] table list found");
    const names = (arrayBlock![1].match(/'[a-z_]+'/g) ?? []).map((s) =>
      s.replace(/'/g, ""),
    );
    assert.deepEqual(new Set(names), new Set(TABLES));
    assert.equal(names.length, TABLES.length);
  });

  it("sets REPLICA IDENTITY FULL so DELETE carries the full pre-image", () => {
    assert.match(SQL, /REPLICA IDENTITY FULL/i);
  });

  it("adds the tables to the supabase_realtime publication, guarded for idempotency", () => {
    assert.match(SQL, /ALTER PUBLICATION supabase_realtime ADD TABLE/i);
    // The ADD must be wrapped in an existence check so re-applying is a no-op.
    assert.match(SQL, /IF NOT EXISTS\s*\(/i);
    assert.match(SQL, /pg_publication_tables/i);
  });

  it("is documented in MANUAL-TASKS.md and the README apply order", () => {
    assert.ok(
      MANUAL.includes("## 20260626_realtime_replica_identity.sql"),
      "MANUAL-TASKS.md must have a section for the migration",
    );
    assert.match(README, /20260626_realtime_replica_identity\.sql/);
  });
});
