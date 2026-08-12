#!/usr/bin/env tsx
/**
 * Fails when a file under `supabase/migrations/` violates the
 * `<version>_<snake_case>.sql` naming convention (the version prefix drives
 * apply order) or lacks its `## <filename>` section in MANUAL-TASKS.md.
 * Run via `npm run lint:migration-naming` locally and in CI.
 *
 * The rules live in `lib/check-migration-naming.ts` so they can be
 * unit-tested under `node --test` without touching the filesystem.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  findMigrationNamingIssues,
  formatMigrationNamingReport,
} from "../lib/check-migration-naming";
import { ScannedFloorError, assertScannedFloor } from "../lib/scanned-floor";

const CHECK_NAME = "check-supabase-migration-naming";
const REPO_ROOT = path.join(__dirname, "..");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");
const MANUAL_TASKS = path.join(REPO_ROOT, "MANUAL-TASKS.md");

function main(): void {
  const migrationFilenames = fs.readdirSync(MIGRATIONS_DIR);
  const manualTasksContent = fs.readFileSync(MANUAL_TASKS, "utf8");

  assertScannedFloor(CHECK_NAME, migrationFilenames.length);

  const issues = findMigrationNamingIssues({
    migrationFilenames,
    manualTasksContent,
  });

  if (issues.length === 0) {
    console.log(
      `${CHECK_NAME}: ${migrationFilenames.length} migration(s) all well-named and documented.`,
    );
    return;
  }

  console.error(formatMigrationNamingReport(issues));
  process.exit(1);
}

try {
  main();
} catch (error) {
  if (error instanceof ScannedFloorError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
