/**
 * Migration apply-order / timestamp-collision scanner (BE-34).
 *
 * Pure module: no filesystem access. The test wrapper reads
 * `supabase/migrations/*.sql` filenames from disk and passes them here so the
 * logic can be unit-tested under `node --test` — including against synthetic
 * collision lists that must NOT exist on disk.
 *
 * Supabase derives a migration's `schema_migrations.version` from the leading
 * digits of its filename (the prefix before the first `_`) and applies
 * migrations in ascending version order, recording each version in
 * `schema_migrations` (a PRIMARY KEY). Two files that resolve to the SAME
 * version collide on `schema_migrations_pkey` (SQLSTATE 23505) when the runner
 * records the second one — which broke Supabase Preview CI when
 * `20260527_items_archived_at.sql` and `20260527_marketplace_transfers.sql`
 * both resolved to version `20260527`. The fix was to give the former a full
 * 14-digit timestamp (`20260527142510`). This module makes that ordering
 * contract explicit and machine-checked: every version parses, is unique, and
 * yields a single deterministic apply order.
 *
 * Versions are compared numerically (via BigInt), not lexicographically, so a
 * longer timestamp sorts AFTER a shorter same-prefixed one
 * (`20260527142510` > `20260527`) and a short numeric prefix sorts before a
 * long one (`9` < `100`) — matching how the runner orders by timestamp value.
 */

/** A migration filename paired with its parsed numeric version prefix. */
export type ParsedMigration = { file: string; version: string };

/** A set of migration files that resolve to the same `version`. */
export type VersionCollision = { version: string; files: string[] };

/**
 * Extract the numeric version prefix (digits before the first `_`) from a
 * migration filename, or `null` when the name is malformed (no leading
 * `<digits>_…` or not a `.sql` file).
 */
export function parseMigrationVersion(filename: string): string | null {
  const m = /^(\d+)_.+\.sql$/.exec(filename);
  return m ? m[1] : null;
}

/**
 * Split filenames into the ones with a valid `<digits>_….sql` prefix (parsed)
 * and the malformed ones. `.sql` filter is applied first so non-migration
 * files passed in are ignored rather than reported as malformed.
 */
export function parseMigrations(filenames: string[]): {
  parsed: ParsedMigration[];
  malformed: string[];
} {
  const parsed: ParsedMigration[] = [];
  const malformed: string[] = [];
  for (const file of filenames) {
    if (!file.endsWith(".sql")) continue;
    const version = parseMigrationVersion(file);
    if (version === null) {
      malformed.push(file);
    } else {
      parsed.push({ file, version });
    }
  }
  return { parsed, malformed };
}

/**
 * Group parsed migrations by version and return only the versions claimed by
 * more than one file — i.e. the timestamp collisions that would break the
 * `schema_migrations` PK. Result (and each `files` list) is sorted for
 * deterministic reporting.
 */
export function findVersionCollisions(filenames: string[]): VersionCollision[] {
  const { parsed } = parseMigrations(filenames);
  const byVersion = new Map<string, string[]>();
  for (const { file, version } of parsed) {
    const list = byVersion.get(version) ?? [];
    list.push(file);
    byVersion.set(version, list);
  }
  return [...byVersion.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([version, files]) => ({ version, files: [...files].sort() }))
    .sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0));
}

/** Numeric (BigInt) comparison of two all-digit version strings. */
function compareVersions(a: string, b: string): number {
  const av = BigInt(a);
  const bv = BigInt(b);
  return av < bv ? -1 : av > bv ? 1 : 0;
}

/**
 * The deterministic order Supabase applies migrations in: parsed files sorted
 * by ascending numeric version. Malformed files are dropped (use
 * `parseMigrations` to detect them). Ties keep input order but a tie means a
 * collision — guard with `findVersionCollisions` first.
 */
export function computeApplyOrder(filenames: string[]): ParsedMigration[] {
  const { parsed } = parseMigrations(filenames);
  return [...parsed].sort((a, b) => compareVersions(a.version, b.version));
}

/**
 * Format a collision/malformed report as a human-readable error, or an empty
 * string when the migration set is clean so callers can short-circuit.
 */
export function formatApplyOrderReport(
  collisions: VersionCollision[],
  malformed: string[] = [],
): string {
  if (collisions.length === 0 && malformed.length === 0) return "";
  const lines: string[] = [];
  if (collisions.length > 0) {
    lines.push(
      `Found ${collisions.length} migration timestamp collision(s) — these break schema_migrations_pkey (SQLSTATE 23505) on apply:`,
    );
    for (const { version, files } of collisions) {
      lines.push(`    version ${version} <- ${files.join(", ")}`);
    }
    lines.push(
      "Give one of each colliding pair a more specific timestamp (e.g. append HHMMSS) so every version is unique.",
    );
  }
  if (malformed.length > 0) {
    lines.push(
      `Found ${malformed.length} migration file(s) without a numeric <version>_ prefix: ${[...malformed].sort().join(", ")}`,
    );
  }
  return lines.join("\n");
}
