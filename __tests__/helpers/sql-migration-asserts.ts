import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Shared structural assertions for Supabase migration tests. The actual SQL is
 * executed against Supabase out-of-band; these helpers centralise the regex
 * shapes every `*-migration.test.ts` used to re-roll by hand so new migration
 * tests stay short and consistent.
 *
 * All helpers throw (via node:assert) with a message naming the missing shape,
 * so they can be called directly inside `it()` blocks.
 */

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Read a migration file from supabase/migrations/ relative to the repo root. */
export function loadMigrationSource(fileName: string): string {
  return readFileSync(
    path.join(process.cwd(), "supabase", "migrations", fileName),
    "utf8",
  );
}

/** Assert the migration creates the table (idempotently) in the public schema. */
export function assertCreatesTable(source: string, table: string): void {
  assert.match(
    source,
    new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${escapeRegExp(table)}\\b`),
    `missing idempotent CREATE TABLE for 'public.${table}'`,
  );
}

/** Assert every listed column name appears in the migration source. */
export function assertColumns(source: string, columns: string[]): void {
  for (const column of columns) {
    assert.match(
      source,
      new RegExp(`\\b${escapeRegExp(column)}\\b`),
      `missing column declaration for '${column}'`,
    );
  }
}

/**
 * Assert an idempotent index exists by name, and that its declaration is
 * followed by the given column expression (eg. "occurred_at DESC" or
 * "chat_id, created_at"). The expression is matched literally.
 */
export function assertIndex(source: string, name: string, on: string): void {
  assert.match(
    source,
    new RegExp(
      `CREATE INDEX IF NOT EXISTS ${escapeRegExp(name)}[\\s\\S]*?${escapeRegExp(on)}`,
    ),
    `missing index '${name}' on '${on}'`,
  );
}

/** Assert row level security is enabled on the table. */
export function assertRlsEnabled(source: string, table: string): void {
  assert.match(
    source,
    new RegExp(
      `ALTER TABLE public\\.${escapeRegExp(table)} ENABLE ROW LEVEL SECURITY`,
    ),
    `missing ENABLE ROW LEVEL SECURITY for 'public.${table}'`,
  );
}

/**
 * Assert the migration declares NO policy whose quoted name mentions the
 * table — the RLS-default-deny shape (eg. analytics_events is service-role
 * only; a stray SELECT policy would expose it to end users).
 */
export function assertNoPolicies(source: string, table: string): void {
  assert.doesNotMatch(
    source,
    new RegExp(`CREATE POLICY[^"]*"[^"]*${escapeRegExp(table)}[^"]*"`),
    `unexpected CREATE POLICY mentioning '${table}' (expected default-deny)`,
  );
}

/**
 * Assert MANUAL-TASKS.md documents the migration file per the CLAUDE.md
 * DB-change rule. Optional extra strings (eg. the table name) can be required
 * alongside the filename.
 */
export function assertManualTasksDocuments(
  migrationFile: string,
  alsoMentions: string[] = [],
): void {
  const manualTasks = readFileSync(
    path.join(process.cwd(), "MANUAL-TASKS.md"),
    "utf8",
  );
  assert.match(
    manualTasks,
    new RegExp(escapeRegExp(migrationFile)),
    `MANUAL-TASKS.md does not document '${migrationFile}'`,
  );
  for (const mention of alsoMentions) {
    assert.match(
      manualTasks,
      new RegExp(escapeRegExp(mention)),
      `MANUAL-TASKS.md entry for '${migrationFile}' does not mention '${mention}'`,
    );
  }
}
