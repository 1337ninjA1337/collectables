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

import * as path from "node:path";

import {
  findMigrationNamingIssues,
  formatMigrationNamingReport,
} from "../lib/check-migration-naming";
import { GuardRootError } from "../lib/guard-root";
import {
  ScannedFloorError,
  assertParsedInputs,
  assertScannedFloor,
} from "../lib/scanned-floor";
import {
  asText,
  guardScanRoot,
  listDirNames,
  readTextInput,
} from "./guard-io";

const CHECK_NAME = "check-supabase-migration-naming";
const DEFAULT_REPO_ROOT = path.join(__dirname, "..");

function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);
  const migrationFilenames = listDirNames(
    path.join(repoRoot, "supabase", "migrations"),
  );

  assertScannedFloor(CHECK_NAME, migrationFilenames.length);

  const manualTasksContent = readTextInput(
    path.join(repoRoot, "MANUAL-TASKS.md"),
  );
  assertParsedInputs(CHECK_NAME, { "MANUAL-TASKS.md": manualTasksContent });

  const issues = findMigrationNamingIssues({
    migrationFilenames,
    manualTasksContent: asText(manualTasksContent),
  });

  if (issues.length === 0) {
    console.log(
      `${CHECK_NAME}: ${migrationFilenames.length} migration(s) all well-named and documented in MANUAL-TASKS.md.`,
    );
    return;
  }

  console.error(formatMigrationNamingReport(issues));
  process.exit(1);
}

try {
  main();
} catch (error) {
  if (error instanceof ScannedFloorError || error instanceof GuardRootError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
