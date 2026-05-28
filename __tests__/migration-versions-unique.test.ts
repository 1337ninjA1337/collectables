import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";

/**
 * Supabase derives a migration's `schema_migrations.version` from the leading
 * timestamp of its filename (the digits before the first `_`). Two files that
 * share that prefix collide on `schema_migrations_pkey` (SQLSTATE 23505) when
 * the runner records the second one — which broke the Supabase Preview CI when
 * `20260527_items_archived_at.sql` and `20260527_marketplace_transfers.sql`
 * both resolved to version `20260527`. This guard keeps every version unique.
 */
describe("supabase migration versions", () => {
  const dir = path.join(process.cwd(), "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));

  it("every migration filename starts with a numeric version + underscore", () => {
    for (const f of files) {
      assert.match(f, /^\d+_.+\.sql$/, `migration ${f} is missing a numeric version prefix`);
    }
  });

  it("no two migrations share the same version prefix", () => {
    const byVersion = new Map<string, string[]>();
    for (const f of files) {
      const version = f.slice(0, f.indexOf("_"));
      const list = byVersion.get(version) ?? [];
      list.push(f);
      byVersion.set(version, list);
    }
    const dupes = [...byVersion.entries()].filter(([, list]) => list.length > 1);
    assert.equal(
      dupes.length,
      0,
      `duplicate migration version(s): ${dupes.map(([v, l]) => `${v} -> ${l.join(", ")}`).join("; ")}`,
    );
  });
});
