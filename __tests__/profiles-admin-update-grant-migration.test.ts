import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * SEC-ADMIN-1 — `20260617_profiles_admin_update_grant.sql` closes the
 * is_admin self-promotion hole that the column-level REVOKE in
 * `20260616_core_tables_rls.sql` left open (a table-level UPDATE grant from
 * Supabase's bootstrap silently overrides a per-column REVOKE). This guards the
 * static security posture:
 *   (1) table-level UPDATE on profiles is REVOKEd from both end-user roles,
 *   (2) UPDATE is re-granted per-column to authenticated EXCLUDING is_admin,
 *   (3) the migration sorts AFTER the RLS migration (is_admin must exist),
 *   (4) MANUAL-TASKS.md documents the migration with a live-grant audit query,
 *   (5) the pgTAP suite asserts self-promote stays denied after a table-level
 *       grant is replayed (defense in depth).
 */

const ROOT = process.cwd();
const MIGRATION_FILE = "20260617_profiles_admin_update_grant.sql";
const MIGRATION = readFileSync(
  path.join(ROOT, "supabase", "migrations", MIGRATION_FILE),
  "utf8",
);
const MANUAL = readFileSync(path.join(ROOT, "MANUAL-TASKS.md"), "utf8");
const PGTAP = readFileSync(
  path.join(ROOT, "supabase", "tests", "01_core_tables_rls.sql"),
  "utf8",
);

// strip `-- ...` line comments so prose doesn't trip the SQL assertions.
const SQL = MIGRATION.replace(/--.*$/gm, "");

// profiles columns from 20260423_base_schema.sql (+ folded ALTERs), minus is_admin.
const GRANTABLE_COLUMNS = [
  "id",
  "email",
  "display_name",
  "username",
  "public_id",
  "bio",
  "avatar",
  "display_currency",
  "created_at",
];

describe("profiles admin UPDATE-grant hardening migration (SEC-ADMIN-1)", () => {
  it("revokes table-level UPDATE on profiles from both end-user roles", () => {
    assert.match(
      SQL,
      /REVOKE\s+UPDATE\s+ON\s+public\.profiles\s+FROM\s+authenticated/i,
    );
    assert.match(
      SQL,
      /REVOKE\s+UPDATE\s+ON\s+public\.profiles\s+FROM\s+anon/i,
    );
  });

  it("re-grants UPDATE per-column to authenticated", () => {
    assert.match(
      SQL,
      /GRANT\s+UPDATE\s*\(([^)]*)\)\s+ON\s+public\.profiles\s+TO\s+authenticated/i,
    );
  });

  it("the per-column grant excludes is_admin but includes every other column", () => {
    const m = SQL.match(
      /GRANT\s+UPDATE\s*\(([^)]*)\)\s+ON\s+public\.profiles\s+TO\s+authenticated/i,
    );
    assert.ok(m, "per-column GRANT UPDATE on profiles must exist");
    const granted = m![1]
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    assert.ok(
      !granted.includes("is_admin"),
      "is_admin must NOT be in the per-column UPDATE grant",
    );
    for (const col of GRANTABLE_COLUMNS) {
      assert.ok(
        granted.includes(col),
        `column ${col} should be re-granted for UPDATE`,
      );
    }
  });

  it("does not re-grant any UPDATE back to anon", () => {
    assert.doesNotMatch(
      SQL,
      /GRANT\s+UPDATE[^;]*TO\s+anon/i,
      "anon must not regain UPDATE on profiles",
    );
  });

  it("sorts after the RLS migration that adds the is_admin column", () => {
    // version = digits before the first underscore.
    const version = (f: string) => f.slice(0, f.indexOf("_"));
    assert.ok(
      version(MIGRATION_FILE) > version("20260616_core_tables_rls.sql"),
      "must apply after the is_admin column exists",
    );
  });

  it("is documented in MANUAL-TASKS.md with a live-grant audit query", () => {
    assert.match(MANUAL, /## 20260617_profiles_admin_update_grant\.sql/);
    assert.match(MANUAL, /role_column_grants/);
    assert.match(MANUAL, /42501/);
  });

  it("the pgTAP suite covers the defense-in-depth replay", () => {
    assert.match(PGTAP, /grant update on public\.profiles to authenticated/i);
    assert.match(
      PGTAP,
      /self-promote stays denied after a table-level grant is replayed/i,
    );
  });
});
