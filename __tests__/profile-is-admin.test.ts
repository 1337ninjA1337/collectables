import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * BE-11b structural pins — threading the server-authoritative
 * `profiles.is_admin` flag onto `UserProfile.isAdmin` and deriving the
 * `social-context` admin gate from it (with the username/email allowlist kept
 * as an offline/seed fallback). The column is read-only from the client: the
 * RLS migration (20260616_core_tables_rls.sql) REVOKEs UPDATE(is_admin), so
 * `upsertProfileBody` must never write it.
 */
function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("UserProfile type — isAdmin field", () => {
  const src = read("lib/types.ts");
  it("declares an optional `isAdmin?: boolean` so legacy/offline rows can omit it", () => {
    assert.match(src, /UserProfile\s*=\s*\{[\s\S]*?isAdmin\?:\s*boolean;[\s\S]*?\};/);
  });
});

describe("DB shape — DbProfile + toUserProfile map is_admin", () => {
  const src = read("lib/supabase-profiles.ts");

  it("DbProfile row type carries the nullable is_admin column", () => {
    assert.match(src, /type\s+DbProfile\s*=\s*\{[\s\S]*?is_admin\?:\s*boolean\s*\|\s*null;[\s\S]*?\};/);
  });

  it("toUserProfile forwards row.is_admin onto isAdmin (false fallback)", () => {
    assert.match(src, /isAdmin:\s*row\.is_admin\s*\?\?\s*false,/);
  });
});

describe("upsertProfileBody — is_admin is read-only from the client", () => {
  const src = read("lib/supabase-profiles-shapes.ts");

  it("does NOT include is_admin in the upsert body (column REVOKEs UPDATE)", () => {
    const fn = src.match(/export function upsertProfileBody[\s\S]*?\n}/);
    assert.ok(fn, "upsertProfileBody should be defined");
    const returned = fn![0].match(/return\s*\{[\s\S]*?\};/);
    assert.ok(returned, "upsertProfileBody should return an object literal");
    assert.doesNotMatch(returned![0], /is_admin/);
  });
});

describe("social-context — admin gate prefers the server flag", () => {
  const src = read("lib/social-context.tsx");

  it("returns true when the self profile's isAdmin flag is set", () => {
    assert.match(src, /if\s*\(selfProfile\?\.isAdmin\)\s*\{\s*return\s+true;/);
  });

  it("keeps the username/email allowlist as an offline fallback", () => {
    assert.match(
      src,
      /selfProfile\?\.username\s*===\s*"1337antoxa"\s*\|\|\s*selfProfile\?\.email\s*===\s*"1337\.antoxa@gmail\.com"/,
    );
  });
});

describe("functional — toUserProfile-equivalent mapping resolves isAdmin", () => {
  // Mirror the pure mapping the module performs, exercising the null-coalesce
  // branches without importing the react-native-coupled module.
  function mapIsAdmin(row: { is_admin?: boolean | null }): boolean {
    return row.is_admin ?? false;
  }

  it("maps a true flag through", () => {
    assert.equal(mapIsAdmin({ is_admin: true }), true);
  });

  it("maps NULL/undefined to false (not an admin)", () => {
    assert.equal(mapIsAdmin({ is_admin: null }), false);
    assert.equal(mapIsAdmin({}), false);
  });
});
