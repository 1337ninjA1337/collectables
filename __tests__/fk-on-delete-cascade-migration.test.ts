import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * BE-6 — `20260618_fk_on_delete_cascade.sql` normalises the six core
 * cross-table foreign keys to an explicit ON DELETE CASCADE on the *existing*
 * (hand-created) live tables, which `CREATE TABLE IF NOT EXISTS` in the base
 * schema can never repair. This test guards the parts CI can assert statically:
 *   (1) the temp helper drops any existing single-column FK then re-adds a
 *       CASCADE FK,
 *   (2) every targeted (table, column → ref) FK is normalised,
 *   (3) the helper lives in pg_temp (auto-dropped, no leak / cleanup), and
 *   (4) the migration is documented in MANUAL-TASKS.md.
 *
 * The executable behaviour (the actual cascade on a delete) is covered by the
 * `02_fk_cascade.sql` pgTAP test on the Docker-backed supabase-test CI.
 */

const ROOT = process.cwd();
const MIGRATION = readFileSync(
  path.join(ROOT, "supabase", "migrations", "20260618_fk_on_delete_cascade.sql"),
  "utf8",
);
const MANUAL = readFileSync(path.join(ROOT, "MANUAL-TASKS.md"), "utf8");

// strip `-- ...` line comments so prose doesn't trip the SQL assertions.
const SQL = MIGRATION.replace(/--.*$/gm, "");

// (table, column, referenced table, constraint name) for each normalised FK.
const FKS: Array<[string, string, string, string]> = [
  ["profiles", "id", "auth.users", "profiles_id_fkey"],
  ["collections", "owner_user_id", "auth.users", "collections_owner_user_id_fkey"],
  ["items", "collection_id", "public.collections", "items_collection_id_fkey"],
  ["items", "created_by_user_id", "auth.users", "items_created_by_user_id_fkey"],
  ["friend_requests", "from_user_id", "auth.users", "friend_requests_from_user_id_fkey"],
  ["friend_requests", "to_user_id", "auth.users", "friend_requests_to_user_id_fkey"],
];

describe("FK ON DELETE CASCADE migration (BE-6)", () => {
  it("defines a pg_temp helper that drops then re-adds the FK", () => {
    assert.match(SQL, /CREATE OR REPLACE FUNCTION pg_temp\.ensure_cascade_fk\(/);
    // drops every existing single-column FK on the column...
    assert.match(SQL, /DROP CONSTRAINT %I/);
    assert.match(SQL, /con\.conkey = ARRAY\[v_attnum\]/);
    // ...then re-adds one with an explicit ON DELETE CASCADE.
    assert.match(SQL, /ADD CONSTRAINT %I FOREIGN KEY \(%I\) REFERENCES %s \(%I\) ON DELETE CASCADE/);
  });

  it("normalises every targeted core foreign key", () => {
    for (const [table, column, ref, conname] of FKS) {
      const call = new RegExp(
        `ensure_cascade_fk\\(\\s*'${table}',\\s*'${column}',\\s*'${ref.replace(
          ".",
          "\\.",
        )}',\\s*'id',\\s*'${conname}'`,
      );
      assert.match(SQL, call, `missing cascade normalisation for ${table}.${column}`);
    }
  });

  it("covers exactly the six core FKs (no more, no fewer)", () => {
    const calls = SQL.match(/ensure_cascade_fk\(/g) ?? [];
    // 1 definition + 6 invocations.
    assert.equal(calls.length, FKS.length + 1);
  });

  it("uses a pg_temp helper so nothing persists past the session", () => {
    // No persistent function is created in public/another schema.
    assert.doesNotMatch(SQL, /CREATE OR REPLACE FUNCTION public\./);
    assert.match(SQL, /pg_temp\.ensure_cascade_fk/);
  });

  it("is documented in MANUAL-TASKS.md", () => {
    assert.match(MANUAL, /## 20260618_fk_on_delete_cascade\.sql/);
    assert.match(MANUAL, /confdeltype/);
  });
});
