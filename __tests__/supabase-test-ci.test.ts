import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * BE-31 — a PR-time GitHub Actions job that applies every committed migration
 * to a throwaway, from-empty Postgres and runs the pgTAP suite against it.
 *
 * The job itself can only be exercised on the runner (it needs Docker + the
 * Supabase CLI), so this test guards the *structure*: the workflow exists and
 * is wired to the right commands/triggers, the CLI config it depends on is
 * committed, and there is at least one pgTAP test for `supabase test db` to
 * run. Mirrors the structural-assertion style of sentry-deploy-workflow.test.ts
 * and migration-versions-unique.test.ts.
 */
const root = process.cwd();
const workflow = readFileSync(
  path.join(root, ".github", "workflows", "supabase-test.yml"),
  "utf8",
);

describe("BE-31 — Supabase Tests workflow", () => {
  it("runs on pull_request", () => {
    assert.match(workflow, /^\s*pull_request:/m);
  });

  it("can be triggered manually", () => {
    assert.match(workflow, /workflow_dispatch:/);
  });

  it("triggers when migrations, tests or config change", () => {
    assert.match(workflow, /supabase\/migrations\/\*\*/);
    assert.match(workflow, /supabase\/tests\/\*\*/);
    assert.match(workflow, /supabase\/config\.toml/);
  });

  it("installs the Supabase CLI", () => {
    assert.match(workflow, /uses:\s*supabase\/setup-cli@v1/);
  });

  it("applies migrations to a scratch DB via `supabase db start`", () => {
    assert.match(workflow, /run:\s*supabase db start/);
  });

  it("runs the pgTAP suite via `supabase test db`", () => {
    assert.match(workflow, /run:\s*supabase test db/);
  });

  it("tears the scratch DB down even on failure", () => {
    assert.match(workflow, /if:\s*always\(\)/);
    assert.match(workflow, /supabase stop/);
  });

  it("needs no secrets (the scratch DB is ephemeral and local)", () => {
    assert.doesNotMatch(workflow, /secrets\./);
  });
});

describe("BE-31 — required CLI artifacts are committed", () => {
  it("commits supabase/config.toml so `supabase db start` can run", () => {
    const cfgPath = path.join(root, "supabase", "config.toml");
    assert.ok(existsSync(cfgPath), "supabase/config.toml must exist");
    const cfg = readFileSync(cfgPath, "utf8");
    assert.match(cfg, /project_id\s*=/, "config.toml needs a project_id");
    assert.match(cfg, /\[db\]/, "config.toml needs a [db] section");
    // The migrations' FKs reference auth.users, so the auth schema must boot.
    assert.match(cfg, /\[auth\]\s*[\s\S]*enabled\s*=\s*true/);
  });

  it("ships at least one pgTAP test for `supabase test db` to run", () => {
    const testsDir = path.join(root, "supabase", "tests");
    assert.ok(existsSync(testsDir), "supabase/tests/ must exist");
    const sqlTests = readdirSync(testsDir).filter((f) => f.endsWith(".sql"));
    assert.ok(sqlTests.length > 0, "expected at least one .sql pgTAP test");
  });

  it("the smoke test asserts the four core tables and folded-in columns", () => {
    const smoke = readFileSync(
      path.join(root, "supabase", "tests", "00_smoke_test.sql"),
      "utf8",
    );
    assert.match(smoke, /select plan\(/i);
    for (const table of ["profiles", "collections", "items", "friend_requests"]) {
      assert.match(
        smoke,
        new RegExp(`has_table\\('public',\\s*'${table}'`),
        `smoke test must assert ${table} exists`,
      );
    }
    for (const col of ["display_currency", "currency", "cost_currency", "archived_at"]) {
      assert.match(smoke, new RegExp(`'${col}'`), `smoke test must check ${col}`);
    }
    assert.match(smoke, /select \* from finish\(\)/i);
  });
});
