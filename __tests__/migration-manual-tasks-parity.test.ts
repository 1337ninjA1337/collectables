import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  findUndocumentedMigrations,
  formatMigrationDocsReport,
  manualTaskSections,
} from "../lib/check-migration-docs";

/**
 * BE-32: every `supabase/migrations/*.sql` must carry a matching
 * `## <filename>` section in MANUAL-TASKS.md so a DB change can never land
 * without its manual-apply instructions (CLAUDE.md mandate). The first block
 * exercises the pure matcher; the second guards the real repo.
 */
describe("check-migration-docs matcher", () => {
  it("extracts H2 section headings and ignores deeper levels", () => {
    const sections = manualTaskSections(
      "# Title\n\n## 20260101_a.sql\n\n### nested\n\n## 20260102_b.sql\n",
    );
    assert.ok(sections.has("20260101_a.sql"));
    assert.ok(sections.has("20260102_b.sql"));
    assert.ok(!sections.has("nested"));
  });

  it("flags a migration with no matching section", () => {
    const undocumented = findUndocumentedMigrations(
      ["20260101_a.sql", "20260102_b.sql"],
      "## 20260101_a.sql\n\nApply foo.\n",
    );
    assert.deepEqual(undocumented, ["20260102_b.sql"]);
  });

  it("passes when every migration has its own section", () => {
    const undocumented = findUndocumentedMigrations(
      ["20260101_a.sql", "20260102_b.sql"],
      "## 20260101_a.sql\n\n## 20260102_b.sql\n",
    );
    assert.deepEqual(undocumented, []);
  });

  it("matches on the exact filename, not a prefix or partial heading", () => {
    // A section for the base schema must not satisfy a same-prefix migration.
    const undocumented = findUndocumentedMigrations(
      ["20260423_base_schema.sql", "20260423_base_extra.sql"],
      "## 20260423_base_schema.sql\n",
    );
    assert.deepEqual(undocumented, ["20260423_base_extra.sql"]);
  });

  it("ignores non-.sql entries", () => {
    const undocumented = findUndocumentedMigrations(
      ["README.md", "20260101_a.sql"],
      "## 20260101_a.sql\n",
    );
    assert.deepEqual(undocumented, []);
  });

  it("formats an actionable report and short-circuits when empty", () => {
    assert.equal(formatMigrationDocsReport([]), "");
    const report = formatMigrationDocsReport(["20260102_b.sql"]);
    assert.match(report, /MANUAL-TASKS\.md/);
    assert.match(report, /20260102_b\.sql/);
  });
});

describe("repo migrations are all documented in MANUAL-TASKS.md", () => {
  const root = process.cwd();
  const migrationFilenames = readdirSync(
    path.join(root, "supabase", "migrations"),
  ).filter((f) => f.endsWith(".sql"));
  const manualTasks = readFileSync(
    path.join(root, "MANUAL-TASKS.md"),
    "utf8",
  );

  it("has at least one migration to check (guards a no-op scan)", () => {
    assert.ok(migrationFilenames.length > 0);
  });

  it("every committed migration has a matching MANUAL-TASKS.md section", () => {
    const undocumented = findUndocumentedMigrations(
      migrationFilenames,
      manualTasks,
    );
    assert.deepEqual(
      undocumented,
      [],
      formatMigrationDocsReport(undocumented),
    );
  });
});
