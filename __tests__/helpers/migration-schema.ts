import assert from "node:assert/strict";
import { readdirSync } from "node:fs";

import { readRepoFile, repoPath } from "./repo-file";

/**
 * Reading the committed schema out of `supabase/migrations/`, said once.
 *
 * Three suites had grown their own walk of that directory with their own regex
 * about the same tables:
 *
 *  - `base-schema-parity.test.ts` concatenates every migration and pulls a
 *    `CREATE TABLE public.<name> ( … )` body out of it, to hold the REST URL
 *    builders' column names to the schema;
 *  - `profiles-search.test.ts` walks the same files for
 *    `CREATE UNIQUE INDEX … ON profiles (col)`, because `PROFILE_FIELDS`'
 *    `unique` flag and `PROFILE_EXACT_SEARCH_LIMIT` both rest on it;
 *  - `fk-index-coverage-migration.test.ts` and friends read individual files
 *    through `sql-migration-asserts.ts`, which is the per-FILE half of this
 *    job and stays where it is.
 *
 * Each was the right CLAIM in the right suite with the READING duplicated,
 * which is the shape most of this repository's history is about removing. The
 * 2026-10-17 suggestion asked for exactly this — a `columnsOf("profiles")` /
 * `uniqueIndexesOn("profiles")` pair beside `readRepoFile` — on the grounds
 * that a third instance was where the duplication would start to differ.
 *
 * ## What these readers can and cannot see
 *
 * Comments are stripped before anything is matched, because prose naming a
 * column is how a parity assertion passes over a schema that never declared
 * it. `20260619_integrity_checks.sql` has a header block listing the
 * constraints it would add if Postgres let it, and that file is why the strip
 * is not optional: unstripped, it asserts a `UNIQUE` the database does not
 * have.
 *
 * {@link uniqueIndexesOn} reports a column as unique only when a UNIQUE index
 * or constraint covers THAT COLUMN ALONE. A composite index
 * (`friend_requests_pair_key` on `(from_user_id, to_user_id)`) makes the PAIR
 * unique and neither column, so counting its members would be wrong rather
 * than incomplete — the directed-pair index is in this tree today and would
 * be the first thing to report falsely.
 *
 * What it still cannot see is a partial index (`… WHERE deleted_at IS NULL`),
 * which constrains a subset of rows and would be reported as unqualified
 * uniqueness. None exists on a column any caller asks about; the day one
 * does, this is the function to teach about `WHERE`.
 */

/** Every committed migration, concatenated and comment-stripped. */
export const ALL_MIGRATIONS_SQL: string = readdirSync(repoPath("supabase", "migrations"))
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readRepoFile("supabase", "migrations", file).replace(/--.*$/gm, ""))
  .join("\n");

/**
 * The body of `CREATE TABLE [IF NOT EXISTS] public.<table> ( … )`.
 *
 * Anchored on the `CREATE TABLE` keyword rather than on a bare
 * `public.<table> (`, so an index, policy or `ALTER` line that also names the
 * table can never be mistaken for its definition. Brace-counted to the
 * matching paren, because a column's own `DEFAULT now()` and a table-level
 * `CHECK ( … )` both nest.
 */
export function tableBody(table: string): string {
  const opener = new RegExp(
    `create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?public\\.${table}\\s*\\(`,
    "i",
  );
  const found = opener.exec(ALL_MIGRATIONS_SQL);
  assert.ok(found, `migrations are missing CREATE TABLE public.${table}`);
  const open = ALL_MIGRATIONS_SQL.indexOf("(", found.index);
  let depth = 0;
  for (let index = open; index < ALL_MIGRATIONS_SQL.length; index += 1) {
    const char = ALL_MIGRATIONS_SQL[index];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return ALL_MIGRATIONS_SQL.slice(open + 1, index);
    }
  }
  throw new Error(`unterminated CREATE TABLE for ${table}`);
}

/** The table body's top-level items, split on the commas that separate them. */
function topLevelItems(body: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) {
      items.push(body.slice(start, index));
      start = index + 1;
    }
  }
  items.push(body.slice(start));
  return items.map((item) => item.trim()).filter((item) => item.length > 0);
}

/** The keywords that open a TABLE-level constraint rather than a column. */
const CONSTRAINT_KEYWORDS = new Set([
  "primary",
  "unique",
  "check",
  "constraint",
  "foreign",
  "exclude",
  "like",
]);

/** The first word of a table-body item, lower-cased — a column name or a keyword. */
function itemHead(item: string): string {
  return (/^"?([a-zA-Z_][a-zA-Z0-9_]*)"?/.exec(item)?.[1] ?? "").toLowerCase();
}

/**
 * The columns `public.<table>` actually has.
 *
 * Its `CREATE TABLE` declarations plus every later
 * `ALTER TABLE … ADD COLUMN [IF NOT EXISTS] <col>`, which is how four of this
 * schema's columns arrived (`display_currency`, `is_admin`, `updated_at`,
 * `deleted_at`). Table-level constraints are skipped by their opening
 * keyword, so a `UNIQUE (a, b)` line is not reported as a column called
 * "unique".
 */
export function columnsOf(table: string): ReadonlySet<string> {
  const columns = new Set<string>();
  for (const item of topLevelItems(tableBody(table))) {
    const head = itemHead(item);
    if (head.length > 0 && !CONSTRAINT_KEYWORDS.has(head)) columns.add(head);
  }
  const added = new RegExp(
    `alter\\s+table\\s+(?:only\\s+)?(?:public\\.)?${table}\\s+add\\s+column\\s+(?:if\\s+not\\s+exists\\s+)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?`,
    "gi",
  );
  for (const match of ALL_MIGRATIONS_SQL.matchAll(added)) columns.add(match[1].toLowerCase());
  return columns;
}

/** The columns of a parenthesised index/constraint column list. */
function indexColumns(list: string): string[] {
  return list
    .split(",")
    .map((part) => part.trim().replace(/\s+(asc|desc)$/i, "").replace(/"/g, ""))
    .filter((part) => /^[a-z_][a-z0-9_]*$/i.test(part));
}

/**
 * The columns of `public.<table>` that a UNIQUE index or constraint covers on
 * their own — so an exact match on one identifies at most one row.
 *
 * Single-column only, deliberately: see this module's header. Three shapes
 * are read, because this schema uses two of them and the third is what a
 * contributor reaching for `ALTER TABLE` would write —
 * `CREATE UNIQUE INDEX … ON … (col)`, an inline `UNIQUE` on a column
 * declaration, and `ALTER TABLE … ADD CONSTRAINT … UNIQUE (col)`. A
 * `PRIMARY KEY` is NOT one of them: it is unique, and it is also the thing
 * every caller already knows is unique, so reporting it would make the set
 * answer a different question from the one its name asks.
 */
export function uniqueIndexesOn(table: string): ReadonlySet<string> {
  const unique = new Set<string>();
  const createIndex = new RegExp(
    `create\\s+unique\\s+index(?:\\s+if\\s+not\\s+exists)?\\s+[a-z0-9_"]+\\s+on\\s+(?:public\\.)?${table}\\s*\\(([^)]*)\\)`,
    "gi",
  );
  const addConstraint = new RegExp(
    `alter\\s+table\\s+(?:only\\s+)?(?:public\\.)?${table}\\s+add\\s+constraint\\s+[a-z0-9_"]+\\s+unique\\s*\\(([^)]*)\\)`,
    "gi",
  );
  for (const source of [createIndex, addConstraint]) {
    for (const match of ALL_MIGRATIONS_SQL.matchAll(source)) {
      const columns = indexColumns(match[1]);
      if (columns.length === 1) unique.add(columns[0].toLowerCase());
    }
  }
  for (const item of topLevelItems(tableBody(table))) {
    const head = itemHead(item);
    if (head.length === 0 || CONSTRAINT_KEYWORDS.has(head)) continue;
    if (/\bunique\b/i.test(item.slice(head.length))) unique.add(head);
  }
  return unique;
}
