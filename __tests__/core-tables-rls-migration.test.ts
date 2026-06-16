import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * BE-11a — the `20260616_core_tables_rls.sql` migration locks down the four
 * core tables (`profiles`, `collections`, `items`, `friend_requests`) that the
 * base schema deliberately left without RLS. This test guards the security
 * posture CI can assert statically:
 *   (1) RLS is enabled on every core table,
 *   (2) the SECURITY DEFINER visibility helpers exist with a pinned
 *       search_path (no temp-schema hijack),
 *   (3) the per-table policies match the documented model,
 *   (4) is_admin can't be self-granted (column UPDATE is revoked), and
 *   (5) the migration is idempotent (DROP POLICY IF EXISTS / CREATE OR REPLACE).
 *
 * The runtime anon/authenticated leak check runs out-of-band (see the
 * RLS leak check section in MANUAL-TASKS.md); BE-12 generalises it.
 */

const ROOT = process.cwd();
const MIGRATION = readFileSync(
  path.join(ROOT, "supabase", "migrations", "20260616_core_tables_rls.sql"),
  "utf8",
);
const MANUAL = readFileSync(path.join(ROOT, "MANUAL-TASKS.md"), "utf8");

// strip `-- ...` line comments so prose doesn't trip the SQL assertions.
const SQL = MIGRATION.replace(/--.*$/gm, "");

const CORE_TABLES = ["profiles", "collections", "items", "friend_requests"];

describe("core-tables RLS migration (BE-11a)", () => {
  it("enables RLS on every core table", () => {
    for (const table of CORE_TABLES) {
      assert.match(
        SQL,
        new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`),
        `RLS not enabled on ${table}`,
      );
    }
  });

  it("adds profiles.is_admin and revokes UPDATE on it from end-user roles", () => {
    assert.match(SQL, /ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false/);
    assert.match(SQL, /REVOKE UPDATE \(is_admin\) ON public\.profiles FROM authenticated/);
    assert.match(SQL, /REVOKE UPDATE \(is_admin\) ON public\.profiles FROM anon/);
  });

  it("defines the SECURITY DEFINER visibility helpers", () => {
    for (const fn of ["is_friend", "is_visible_to", "can_view_collection", "is_admin"]) {
      assert.match(
        SQL,
        new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`),
        `missing helper ${fn}`,
      );
    }
  });

  it("pins search_path on every SECURITY DEFINER helper (no temp-schema hijack)", () => {
    const definers = SQL.match(/SECURITY DEFINER/g) ?? [];
    const pinned = SQL.match(/SET search_path = public/g) ?? [];
    assert.equal(definers.length, 4, "expected exactly 4 SECURITY DEFINER helpers");
    assert.equal(
      pinned.length,
      definers.length,
      "every SECURITY DEFINER function must pin search_path",
    );
  });

  it("grants execute on every helper to authenticated", () => {
    for (const fn of ["is_friend", "is_visible_to", "can_view_collection", "is_admin"]) {
      assert.match(
        SQL,
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(`),
        `helper ${fn} not granted to authenticated`,
      );
    }
  });

  it("lets admins (only) delete other profiles", () => {
    assert.match(
      SQL,
      /CREATE POLICY "profiles_delete_own_or_admin"[\s\S]*?USING \(auth\.uid\(\) = id OR public\.is_admin\(auth\.uid\(\)\)\)/,
    );
  });

  it("gates collection + item reads through can_view_collection", () => {
    assert.match(
      SQL,
      /CREATE POLICY "collections_select_visible"[\s\S]*?public\.can_view_collection\(auth\.uid\(\), id\)/,
    );
    assert.match(
      SQL,
      /CREATE POLICY "items_select_visible"[\s\S]*?public\.can_view_collection\(auth\.uid\(\), collection_id\)/,
    );
  });

  it("restricts writes to the owner / sender", () => {
    assert.match(SQL, /CREATE POLICY "collections_insert_own"[\s\S]*?auth\.uid\(\) = owner_user_id/);
    assert.match(SQL, /CREATE POLICY "friend_requests_insert_sender"[\s\S]*?auth\.uid\(\) = from_user_id/);
  });

  it("never exposes an UPDATE policy on friend_requests (immutable rows)", () => {
    assert.doesNotMatch(
      SQL,
      /CREATE POLICY "[^"]*"\s+ON public\.friend_requests\s+FOR UPDATE/i,
    );
  });

  it("is idempotent — DROP POLICY IF EXISTS before each CREATE POLICY", () => {
    const creates = SQL.match(/CREATE POLICY/g) ?? [];
    const drops = SQL.match(/DROP POLICY IF EXISTS/g) ?? [];
    assert.ok(creates.length >= 14, `expected ≥14 policies, got ${creates.length}`);
    assert.equal(drops.length, creates.length, "every CREATE POLICY needs a matching DROP IF EXISTS");
  });

  it("is documented in MANUAL-TASKS.md", () => {
    assert.match(MANUAL, /## 20260616_core_tables_rls\.sql/);
    assert.match(MANUAL, /RLS leak check \(BE-11a\)/);
  });
});
