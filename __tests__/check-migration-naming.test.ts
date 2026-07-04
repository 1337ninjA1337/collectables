import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  MIGRATION_NAME_PATTERN,
  findMigrationNamingIssues,
  findMisnamedMigrations,
  formatMigrationNamingReport,
} from "../lib/check-migration-naming";

describe("check-migration-naming", () => {
  it("accepts the two sanctioned version-prefix shapes", () => {
    for (const name of [
      "20260424_chat_messages.sql",
      "20260527142510_items_archived_at.sql", // supabase-CLI 14-digit timestamp
      "20260628_marketplace_arrived_at.sql",
      "20990101_a.sql",
      "20260101_v2_backfill_step_1.sql",
    ]) {
      assert.ok(MIGRATION_NAME_PATTERN.test(name), `expected valid: ${name}`);
    }
  });

  it("rejects non-conforming filenames", () => {
    for (const name of [
      "chat_messages.sql", // no version prefix
      "2026042_chat.sql", // 7 digits
      "202604240_chat.sql", // 9 digits (neither 8 nor 14)
      "20260424-chat-messages.sql", // kebab-case
      "20260424_ChatMessages.sql", // uppercase
      "20260424_chat messages.sql", // space
      "20260424_.sql", // empty slug
      "20260424_chat.SQL", // wrong extension case
      "20260424_chat.sql.bak", // trailing suffix
      "README.md", // stray non-sql file in migrations/
    ]) {
      assert.ok(!MIGRATION_NAME_PATTERN.test(name), `expected invalid: ${name}`);
    }
  });

  it("findMisnamedMigrations returns violations sorted and passes a clean list", () => {
    assert.deepEqual(
      findMisnamedMigrations([
        "20260424_chat_messages.sql",
        "zz_last.sql",
        "README.md",
      ]),
      ["README.md", "zz_last.sql"],
    );
    assert.deepEqual(findMisnamedMigrations(["20260424_chat_messages.sql"]), []);
  });

  it("findMigrationNamingIssues combines naming + MANUAL-TASKS parity", () => {
    const issues = findMigrationNamingIssues({
      migrationFilenames: [
        "20260424_chat_messages.sql", // documented below
        "20260425_orphan.sql", // well-named but undocumented
        "bad-name.sql", // misnamed (and undocumented, flagged for both)
      ],
      manualTasksContent: "## 20260424_chat_messages.sql\n\napply sql\n",
    });
    assert.deepEqual(
      issues.map((i) => `${i.problem}:${i.file}`),
      [
        "misnamed:bad-name.sql",
        "undocumented:20260425_orphan.sql",
        "undocumented:bad-name.sql",
      ],
    );
  });

  it("returns no issues when everything conforms", () => {
    assert.deepEqual(
      findMigrationNamingIssues({
        migrationFilenames: ["20260424_chat_messages.sql"],
        manualTasksContent: "## 20260424_chat_messages.sql\n",
      }),
      [],
    );
  });

  it("formats a report naming each problem, and empty-string on success", () => {
    assert.equal(formatMigrationNamingReport([]), "");
    const report = formatMigrationNamingReport([
      { file: "bad.sql", problem: "misnamed", hint: "rename it" },
      { file: "x.sql", problem: "undocumented", hint: "document it" },
    ]);
    assert.match(report, /2 migration naming\/docs issue/);
    assert.match(report, /\[misnamed\] bad\.sql {2}-> {2}rename it/);
    assert.match(report, /\[undocumented\] x\.sql/);
  });

  it("the real supabase/migrations directory passes the full scan", () => {
    const migrationFilenames = readdirSync(
      path.join(process.cwd(), "supabase", "migrations"),
    );
    const manualTasksContent = readFileSync(
      path.join(process.cwd(), "MANUAL-TASKS.md"),
      "utf8",
    );
    assert.ok(migrationFilenames.length >= 25, "scanner sanity: migrations present");
    assert.deepEqual(
      findMigrationNamingIssues({ migrationFilenames, manualTasksContent }),
      [],
    );
  });

  it("is wired into package.json and CI", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    );
    assert.equal(
      pkg.scripts["lint:migration-naming"],
      "tsx scripts/check-supabase-migration-naming.ts",
    );
    assert.match(pkg.scripts["lint:ci"], /npm run lint:migration-naming/);
    const ci = readFileSync(
      path.join(process.cwd(), ".github", "workflows", "ci.yml"),
      "utf8",
    );
    assert.match(ci, /npm run lint:migration-naming/);
  });
});
