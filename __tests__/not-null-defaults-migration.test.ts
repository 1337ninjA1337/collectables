import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * BE-10 — `20260622_not_null_defaults.sql` repairs the live (hand-created)
 * tables so the columns the client always sends a concrete value for are
 * `NOT NULL` with the same default base_schema already declares.
 *
 * Structural guards (the executable DDL runs on the Docker-backed supabase-test
 * CI / fresh-preview replay, not here):
 *   (1) every targeted (table, column) pair is present in the VALUES list;
 *   (2) each column is repaired in three steps — backfill NULLs, SET DEFAULT,
 *       SET NOT NULL — so it's idempotent and never fails on existing rows;
 *   (3) the uuid FK columns are intentionally NOT enforced here (owned by BE-6);
 *   (4) it is documented in MANUAL-TASKS.md + the README apply order.
 */

const ROOT = process.cwd();
const MIGRATION = readFileSync(
  path.join(ROOT, "supabase", "migrations", "20260622_not_null_defaults.sql"),
  "utf8",
);
const MANUAL = readFileSync(path.join(ROOT, "MANUAL-TASKS.md"), "utf8");
const README = readFileSync(path.join(ROOT, "README-DEPLOY.md"), "utf8");

// strip `-- ...` line comments so the prose doesn't trip the SQL assertions.
const SQL = MIGRATION.replace(/--.*$/gm, "");

// Every (table, column) pair the client's upsert bodies always emit a value for.
const COLUMNS: [string, string][] = [
  ["profiles", "email"],
  ["profiles", "display_name"],
  ["profiles", "username"],
  ["profiles", "public_id"],
  ["profiles", "bio"],
  ["profiles", "avatar"],
  ["collections", "name"],
  ["collections", "cover_photo"],
  ["collections", "description"],
  ["collections", "owner_name"],
  ["collections", "visibility"],
  ["collections", "shared_with_user_ids"],
  ["collections", "created_at"],
  ["items", "title"],
  ["items", "acquired_at"],
  ["items", "acquired_from"],
  ["items", "description"],
  ["items", "variants"],
  ["items", "created_by"],
  ["items", "photos"],
  ["items", "is_wishlist"],
  ["items", "created_at"],
];

describe("not-null defaults migration (BE-10)", () => {
  it("lists every targeted (table, column) pair in the VALUES block", () => {
    for (const [tbl, col] of COLUMNS) {
      assert.match(
        SQL,
        new RegExp(`'${tbl}',\\s*'${col}'`),
        `missing ${tbl}.${col} in the VALUES list`,
      );
    }
    // exactly COLUMNS.length rows in the VALUES list (no stragglers).
    const rows = SQL.match(/\('(?:profiles|collections|items)',\s*'[a-z_]+',/g) ?? [];
    assert.equal(rows.length, COLUMNS.length);
  });

  it("repairs each column in three idempotent steps", () => {
    assert.match(SQL, /UPDATE public\.%I SET %I = %s WHERE %I IS NULL/i);
    assert.match(SQL, /ALTER TABLE public\.%I ALTER COLUMN %I SET DEFAULT %s/i);
    assert.match(SQL, /ALTER TABLE public\.%I ALTER COLUMN %I SET NOT NULL/i);
  });

  it("uses the safe scalar defaults base_schema declares", () => {
    assert.match(SQL, /'private'/); // visibility
    assert.match(SQL, /'\{\}'::uuid\[\]/); // shared_with_user_ids
    assert.match(SQL, /'\{\}'::text\[\]/); // photos
    assert.match(SQL, /false/); // is_wishlist
    assert.match(SQL, /now\(\)/); // created_at
  });

  it("does NOT enforce the uuid FK columns (owned by BE-6)", () => {
    assert.doesNotMatch(SQL, /'owner_user_id'/);
    assert.doesNotMatch(SQL, /'created_by_user_id'/);
  });

  it("is documented in MANUAL-TASKS.md and the README apply order", () => {
    assert.match(MANUAL, /## 20260622_not_null_defaults\.sql/);
    assert.match(README, /20260622_not_null_defaults\.sql/);
  });
});
