import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * BE-22a — `20260625_subscriptions.sql` creates the server-authoritative
 * `subscriptions` table: the durable source of truth for premium entitlement
 * (replacing the trust-the-client AsyncStorage flag).
 *
 * Structural guards (the real table/policies are exercised on the Docker-backed
 * supabase-test CI, not here):
 *   (1) one-row-per-user shape: user_id PK + FK→auth.users ON DELETE CASCADE;
 *   (2) status is CHECK-constrained to the four known states;
 *   (3) moddatetime trigger bumps updated_at (BE-9 convention);
 *   (4) a partial alive index on WHERE deleted_at IS NULL (BE-15 convention);
 *   (5) RLS enabled with SELECT-own ONLY — no client write policy;
 *   (6) idempotent (IF NOT EXISTS / DROP … IF EXISTS);
 *   (7) documented in MANUAL-TASKS.md + the README apply order.
 */

const ROOT = process.cwd();
const MIGRATION = readFileSync(
  path.join(ROOT, "supabase", "migrations", "20260625_subscriptions.sql"),
  "utf8",
);
const MANUAL = readFileSync(path.join(ROOT, "MANUAL-TASKS.md"), "utf8");
const README = readFileSync(path.join(ROOT, "README-DEPLOY.md"), "utf8");

// strip `-- ...` line comments so prose doesn't trip the SQL assertions.
const SQL = MIGRATION.replace(/--.*$/gm, "");

describe("subscriptions migration (BE-22a)", () => {
  it("creates the table with a user_id PK FK→auth.users ON DELETE CASCADE", () => {
    assert.match(SQL, /CREATE TABLE IF NOT EXISTS public\.subscriptions/i);
    assert.match(
      SQL,
      /user_id\s+uuid PRIMARY KEY REFERENCES auth\.users\s*\(\s*id\s*\)\s+ON DELETE CASCADE/i,
    );
  });

  it("CHECK-constrains status to the four known states", () => {
    assert.match(
      SQL,
      /CHECK\s*\(\s*status IN\s*\(\s*'active',\s*'inactive',\s*'expired',\s*'cancelled'\s*\)\s*\)/i,
    );
  });

  it("carries activated_at + current_period_end + a deleted_at tombstone", () => {
    assert.match(SQL, /activated_at\s+timestamptz/i);
    assert.match(SQL, /current_period_end\s+timestamptz/i);
    assert.match(SQL, /deleted_at\s+timestamptz/i);
  });

  it("auto-bumps updated_at via the moddatetime trigger (BE-9)", () => {
    assert.match(SQL, /DROP TRIGGER IF EXISTS handle_updated_at ON public\.subscriptions/i);
    assert.match(SQL, /extensions\.moddatetime\(updated_at\)/i);
  });

  it("adds a partial alive index WHERE deleted_at IS NULL (BE-15)", () => {
    assert.match(SQL, /CREATE INDEX IF NOT EXISTS subscriptions_alive_idx/i);
    assert.match(SQL, /WHERE deleted_at IS NULL/i);
  });

  it("enables RLS with a SELECT-own policy and NO client write policy", () => {
    assert.match(SQL, /ALTER TABLE public\.subscriptions ENABLE ROW LEVEL SECURITY/i);
    assert.match(SQL, /CREATE POLICY subscriptions_select_own[\s\S]*FOR SELECT[\s\S]*auth\.uid\(\) = user_id/i);
    // writes are service_role-only: no end-user INSERT/UPDATE/DELETE policy.
    assert.doesNotMatch(SQL, /FOR INSERT/i);
    assert.doesNotMatch(SQL, /FOR UPDATE/i);
    assert.doesNotMatch(SQL, /FOR DELETE/i);
  });

  it("is idempotent to re-apply", () => {
    assert.match(SQL, /CREATE TABLE IF NOT EXISTS/i);
    assert.match(SQL, /CREATE INDEX IF NOT EXISTS/i);
    assert.match(SQL, /DROP TRIGGER IF EXISTS/i);
    assert.match(SQL, /DROP POLICY IF EXISTS/i);
  });

  it("is documented in MANUAL-TASKS.md and the README apply order", () => {
    assert.ok(
      MANUAL.includes("## 20260625_subscriptions.sql"),
      "MANUAL-TASKS.md must have a section for the migration",
    );
    assert.match(README, /20260625_subscriptions\.sql/);
  });
});
