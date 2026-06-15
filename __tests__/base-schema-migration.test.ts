import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * BE-1 — the base-schema migration is the single authoritative, idempotent
 * definition of the four core tables (`profiles`, `collections`, `items`,
 * `friend_requests`) so a fresh Supabase project can be bootstrapped from the
 * committed migrations alone. This test guards that the migration:
 *   (1) creates each table with IF NOT EXISTS (safe over the live schema),
 *   (2) carries the columns the REST builders in supabase-profiles-shapes.ts
 *       read/write, including the folded-in ALTERs, and
 *   (3) wires the foreign keys to auth.users / collections.
 *
 * The broader column-by-column parity sweep lives in BE-3.
 */

const ROOT = process.cwd();
const MIGRATION = readFileSync(
  path.join(ROOT, "supabase", "migrations", "20260423_base_schema.sql"),
  "utf8",
);

// strip `-- ...` line comments so prose doesn't trip the SQL assertions.
const SQL = MIGRATION.replace(/--.*$/gm, "");

describe("base schema migration (BE-1)", () => {
  it("creates all four core tables idempotently", () => {
    for (const table of ["profiles", "collections", "items", "friend_requests"]) {
      assert.match(
        SQL,
        new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`),
        `missing CREATE TABLE IF NOT EXISTS for ${table}`,
      );
    }
  });

  it("defines profiles columns from upsertProfileBody + DbProfile", () => {
    for (const col of [
      "id",
      "email",
      "display_name",
      "username",
      "public_id",
      "bio",
      "avatar",
      "display_currency",
      "created_at",
    ]) {
      assert.match(SQL, new RegExp(`\\b${col}\\b`), `profiles missing ${col}`);
    }
  });

  it("defines collections columns from upsertCollectionBody + DbCollection", () => {
    for (const col of [
      "name",
      "cover_photo",
      "description",
      "owner_name",
      "owner_user_id",
      "sort_order",
      "visibility",
      "shared_with_user_ids",
      "currency",
    ]) {
      assert.match(SQL, new RegExp(`\\b${col}\\b`), `collections missing ${col}`);
    }
  });

  it("defines items columns from upsertItemBody + DbItem", () => {
    for (const col of [
      "collection_id",
      "title",
      "acquired_at",
      "acquired_from",
      "variants",
      "photos",
      "created_by",
      "created_by_user_id",
      "cost",
      "cost_currency",
      "is_wishlist",
      "condition",
      "tags",
      "archived_at",
    ]) {
      assert.match(SQL, new RegExp(`\\b${col}\\b`), `items missing ${col}`);
    }
  });

  it("defines friend_requests columns from the friend-request shapes", () => {
    for (const col of ["from_user_id", "to_user_id"]) {
      assert.match(SQL, new RegExp(`\\b${col}\\b`), `friend_requests missing ${col}`);
    }
  });

  it("folds in the historical ALTERs as IF NOT EXISTS guards", () => {
    assert.match(SQL, /ADD COLUMN IF NOT EXISTS display_currency text/);
    assert.match(SQL, /ADD COLUMN IF NOT EXISTS currency text/);
    assert.match(SQL, /ADD COLUMN IF NOT EXISTS cost_currency text/);
    assert.match(SQL, /ADD COLUMN IF NOT EXISTS archived_at timestamptz/);
  });

  it("references auth.users for owner/user FKs and collections for items", () => {
    assert.match(SQL, /REFERENCES auth\.users \(id\)/);
    assert.match(SQL, /REFERENCES public\.collections \(id\)/);
  });

  it("guards against self friend requests and duplicate directed pairs", () => {
    assert.match(SQL, /from_user_id <> to_user_id/);
    assert.match(SQL, /friend_requests_pair_key/);
  });

  // Regression: a fresh DB applies migrations in filename order. Earlier
  // migrations (e.g. 20260424_chat_messages.sql's RLS policy) reference these
  // core tables, so the base schema MUST sort first or the replay fails with
  // "relation does not exist".
  it("sorts before every other migration so it applies first on a fresh DB", () => {
    const files = readdirSync(path.join(ROOT, "supabase", "migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    assert.equal(files[0], "20260423_base_schema.sql");
  });
});
