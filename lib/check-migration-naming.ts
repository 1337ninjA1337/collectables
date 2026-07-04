/**
 * Migration filename-convention scanner used by
 * `scripts/check-supabase-migration-naming.ts` and its tests.
 *
 * Pure module: no filesystem access. The CLI wrapper reads
 * `supabase/migrations/` and `MANUAL-TASKS.md` from disk and passes their
 * names/contents here so the rules can be unit-tested under `node --test`
 * without mocking `fs`.
 *
 * Every migration must be named `<version>_<slug>.sql` where `<version>` is
 * either the repo's usual date prefix (`YYYYMMDD`, 8 digits) or a full
 * Supabase-CLI timestamp (`YYYYMMDDhhmmss`, 14 digits — eg. the shipped
 * `20260527142510_items_archived_at.sql`), and `<slug>` is snake_case
 * `[a-z0-9_]+`. The version prefix is what `migration-apply-order` sorts on,
 * so a misnamed file would silently apply out of order.
 *
 * The MANUAL-TASKS.md parity half reuses `findUndocumentedMigrations` from
 * `lib/check-migration-docs.ts` — one source of truth for the CLAUDE.md
 * DB-change rule, surfaced by both lint steps.
 */

import { findUndocumentedMigrations } from "./check-migration-docs";

/** `YYYYMMDD_snake_case.sql` or `YYYYMMDDhhmmss_snake_case.sql`. */
export const MIGRATION_NAME_PATTERN = /^\d{8}(?:\d{6})?_[a-z0-9_]+\.sql$/;

export type MigrationNamingIssue = {
  file: string;
  problem: "misnamed" | "undocumented";
  hint: string;
};

/** Return the filenames that violate MIGRATION_NAME_PATTERN. Sorted. */
export function findMisnamedMigrations(filenames: string[]): string[] {
  return filenames.filter((name) => !MIGRATION_NAME_PATTERN.test(name)).sort();
}

/**
 * Full scan: naming-convention violations plus MANUAL-TASKS.md parity, as one
 * sorted issue list (misnamed first, then undocumented, each alphabetical).
 */
export function findMigrationNamingIssues(input: {
  migrationFilenames: string[];
  manualTasksContent: string;
}): MigrationNamingIssue[] {
  const issues: MigrationNamingIssue[] = [];
  for (const file of findMisnamedMigrations(input.migrationFilenames)) {
    issues.push({
      file,
      problem: "misnamed",
      hint: "rename to <YYYYMMDD>_<snake_case>.sql (or a 14-digit supabase-CLI timestamp prefix)",
    });
  }
  for (const file of findUndocumentedMigrations(
    input.migrationFilenames,
    input.manualTasksContent,
  )) {
    issues.push({
      file,
      problem: "undocumented",
      hint: `add a "## ${file}" H2 section to MANUAL-TASKS.md (CLAUDE.md DB-change rule)`,
    });
  }
  return issues;
}

/**
 * Format the issue list as a human-readable error. Returns an empty string
 * when nothing is wrong so callers can short-circuit.
 */
export function formatMigrationNamingReport(
  issues: MigrationNamingIssue[],
): string {
  if (issues.length === 0) return "";
  const lines: string[] = [];
  lines.push(
    `Found ${issues.length} migration naming/docs issue(s) under supabase/migrations/.`,
  );
  for (const issue of issues) {
    lines.push(`    [${issue.problem}] ${issue.file}  ->  ${issue.hint}`);
  }
  return lines.join("\n");
}
