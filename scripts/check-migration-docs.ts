#!/usr/bin/env tsx
/**
 * Fails when a `supabase/migrations/*.sql` file has no matching `## <filename>`
 * section in MANUAL-TASKS.md (BE-32). Run via `npm run lint:migration-docs`
 * locally and in CI so a new migration can never land undocumented.
 *
 * The matching logic lives in `lib/check-migration-docs.ts` so it can be
 * unit-tested under `node --test` without touching the filesystem.
 */

import * as path from "node:path";

import {
  findUndocumentedMigrations,
  formatMigrationDocsReport,
} from "../lib/check-migration-docs";
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

const CHECK_NAME = "check-migration-docs";
const DEFAULT_REPO_ROOT = path.join(__dirname, "..");

function main(): void {
  const repoRoot = guardScanRoot(CHECK_NAME, DEFAULT_REPO_ROOT);
  const migrationFilenames = listDirNames(
    path.join(repoRoot, "supabase", "migrations"),
  ).filter((f) => f.endsWith(".sql"));

  // Migrations are append-only: a count under the floor means the directory
  // moved, not that migrations were deleted. Asserted before MANUAL-TASKS.md
  // is read, so a scan root that holds neither fails on the cause.
  assertScannedFloor(CHECK_NAME, migrationFilenames.length);

  const manualTasksContent = readTextInput(
    path.join(repoRoot, "MANUAL-TASKS.md"),
  );
  assertParsedInputs(CHECK_NAME, { "MANUAL-TASKS.md": manualTasksContent });

  const undocumented = findUndocumentedMigrations(
    migrationFilenames,
    asText(manualTasksContent),
  );

  if (undocumented.length === 0) {
    console.log(
      `${CHECK_NAME}: ${migrationFilenames.length} migration(s) all documented in MANUAL-TASKS.md.`,
    );
    return;
  }

  console.error(formatMigrationDocsReport(undocumented));
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
