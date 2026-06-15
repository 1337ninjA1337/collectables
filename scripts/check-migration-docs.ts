#!/usr/bin/env tsx
/**
 * Fails when a `supabase/migrations/*.sql` file has no matching `## <filename>`
 * section in MANUAL-TASKS.md (BE-32). Run via `npm run lint:migration-docs`
 * locally and in CI so a new migration can never land undocumented.
 *
 * The matching logic lives in `lib/check-migration-docs.ts` so it can be
 * unit-tested under `node --test` without touching the filesystem.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  findUndocumentedMigrations,
  formatMigrationDocsReport,
} from "../lib/check-migration-docs";

const REPO_ROOT = path.join(__dirname, "..");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");
const MANUAL_TASKS = path.join(REPO_ROOT, "MANUAL-TASKS.md");

function main(): void {
  const migrationFilenames = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"));
  const manualTasksContent = fs.readFileSync(MANUAL_TASKS, "utf8");

  const undocumented = findUndocumentedMigrations(
    migrationFilenames,
    manualTasksContent,
  );

  if (undocumented.length === 0) {
    console.log(
      `check-migration-docs: ${migrationFilenames.length} migration(s) all documented in MANUAL-TASKS.md.`,
    );
    return;
  }

  console.error(formatMigrationDocsReport(undocumented));
  process.exit(1);
}

main();
