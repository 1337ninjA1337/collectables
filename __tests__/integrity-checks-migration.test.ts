import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * BE-7 — `20260619_integrity_checks.sql` backfills the data-integrity CHECK
 * constraints + the friend-request directed-pair uniqueness onto the existing
 * (hand-created) live tables, which `CREATE TABLE IF NOT EXISTS` in the base
 * schema can never repair. This test guards the parts CI can assert statically:
 *   (1) each CHECK is added under an existence guard (idempotent),
 *   (2) the enums match the app's allowed values,
 *   (3) the friend-request pair unique is the *directed* key, and
 *   (4) the migration is documented in MANUAL-TASKS.md.
 */

const ROOT = process.cwd();
const MIGRATION = readFileSync(
  path.join(ROOT, "supabase", "migrations", "20260619_integrity_checks.sql"),
  "utf8",
);
const MANUAL = readFileSync(path.join(ROOT, "MANUAL-TASKS.md"), "utf8");

// strip `-- ...` line comments so prose doesn't trip the SQL assertions.
const SQL = MIGRATION.replace(/--.*$/gm, "");

describe("integrity CHECK constraints migration (BE-7)", () => {
  it("adds the collections.visibility enum CHECK under a guard", () => {
    assert.match(SQL, /pg_get_constraintdef\(oid\) ILIKE '%visibility%'/);
    assert.match(
      SQL,
      /ADD CONSTRAINT collections_visibility_check\s+CHECK \(visibility IN \('public', 'private'\)\)/,
    );
  });

  it("adds the items.condition enum CHECK under a guard", () => {
    assert.match(SQL, /pg_get_constraintdef\(oid\) ILIKE '%condition%'/);
    assert.match(
      SQL,
      /ADD CONSTRAINT items_condition_check\s+CHECK \(condition IN \('new', 'excellent', 'good', 'fair'\)\)/,
    );
  });

  it("adds the friend_requests no-self CHECK under a guard", () => {
    assert.match(
      SQL,
      /ADD CONSTRAINT friend_requests_no_self\s+CHECK \(from_user_id <> to_user_id\)/,
    );
  });

  it("creates the DIRECTED pair unique index (not least/greatest)", () => {
    assert.match(
      SQL,
      /CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_pair_key\s+ON public\.friend_requests \(from_user_id, to_user_id\)/,
    );
    // An undirected key would break the mutual-friendship model — must NOT appear.
    assert.doesNotMatch(SQL, /least\s*\(/i);
    assert.doesNotMatch(SQL, /greatest\s*\(/i);
  });

  it("does not invent a collections.role CHECK (role is not a DB column)", () => {
    assert.doesNotMatch(SQL, /role IN/i);
  });

  it("guards every CHECK add so a re-run is a no-op", () => {
    const adds = SQL.match(/ADD CONSTRAINT/g) ?? [];
    const guards = SQL.match(/IF NOT EXISTS \(/g) ?? [];
    assert.equal(adds.length, 3);
    assert.equal(guards.length, 3);
  });

  it("is documented in MANUAL-TASKS.md", () => {
    assert.match(MANUAL, /## 20260619_integrity_checks\.sql/);
  });
});
