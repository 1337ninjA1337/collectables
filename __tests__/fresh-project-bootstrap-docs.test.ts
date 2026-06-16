import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// BE-4 — the offline (doc) half: README-DEPLOY.md must document how to
// bootstrap a fresh Supabase project from the committed migrations alone,
// run them in order, point a build at it, and confirm end-to-end.

const readme = readFileSync(
  path.join(process.cwd(), "README-DEPLOY.md"),
  "utf8",
);

const bootstrapSection = (() => {
  const start = readme.indexOf(
    "## Bootstrapping a fresh Supabase project from committed migrations",
  );
  assert.notEqual(start, -1, "bootstrap section heading must exist");
  const after = readme.indexOf("\n## ", start + 1);
  return readme.slice(start, after === -1 ? undefined : after);
})();

describe("BE-4 — fresh-project bootstrap docs", () => {
  it("documents creating the project + grabbing API credentials", () => {
    assert.match(bootstrapSection, /New project/);
    assert.match(bootstrapSection, /EXPO_PUBLIC_SUPABASE_URL/);
    assert.match(bootstrapSection, /EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  });

  it("documents applying migrations in order via supabase db push", () => {
    assert.match(bootstrapSection, /supabase db push/);
    assert.match(bootstrapSection, /supabase link/);
    assert.match(bootstrapSection, /filename order|in order/i);
  });

  it("flags it as needing live creds / not exercisable in CI", () => {
    assert.match(bootstrapSection, /cannot be exercised from CI|live Supabase login/i);
  });

  it("documents pointing a build at the new project", () => {
    assert.match(bootstrapSection, /npm run build/);
    assert.match(bootstrapSection, /\.env/);
  });

  it("documents an end-to-end confirmation covering each core table", () => {
    assert.match(bootstrapSection, /Confirm end-to-end/i);
    assert.match(bootstrapSection, /collection/i);
    assert.match(bootstrapSection, /item/i);
    assert.match(bootstrapSection, /friend request/i);
    assert.match(bootstrapSection, /RLS/);
  });

  it("documents deploying the edge functions the app calls", () => {
    for (const fn of ["delete-account", "delete-image", "analytics-mirror"]) {
      assert.match(bootstrapSection, new RegExp(`functions deploy ${fn}`));
    }
  });

  it("lists every committed migration in the apply-order block", () => {
    const migrations = readdirSync(
      path.join(process.cwd(), "supabase", "migrations"),
    ).filter((f) => f.endsWith(".sql"));
    assert.ok(migrations.length >= 12, "expected the full migration set");
    for (const file of migrations) {
      assert.match(
        bootstrapSection,
        new RegExp(file.replace(/[.]/g, "\\.")),
        `apply-order list must mention ${file}`,
      );
    }
  });

  it("lists the migrations in true lexicographic apply order", () => {
    const migrations = readdirSync(
      path.join(process.cwd(), "supabase", "migrations"),
    )
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const positions = migrations.map((f) => bootstrapSection.indexOf(f));
    for (let i = 1; i < positions.length; i++) {
      assert.ok(
        positions[i] > positions[i - 1],
        `${migrations[i]} must appear after ${migrations[i - 1]}`,
      );
    }
  });
});
