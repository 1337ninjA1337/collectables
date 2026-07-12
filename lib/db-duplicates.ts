/**
 * Duplicate-row detection for the Supabase database, behind
 * `scripts/find-db-duplicates.ts` (`npm run db:find-duplicates`).
 *
 * Pure module: no filesystem or network access — the CLI fetches rows via
 * PostgREST and hands them over, so the detection logic is unit-testable
 * under `node --test`.
 *
 * A "duplicate" is defined per table by its NATURAL key — the columns that
 * identify one logical record to a user — not the surrogate `id` PK (which
 * can never collide). Tables whose natural key is already enforced by a
 * unique index (profiles.username/public_id, friend_requests pair,
 * marketplace_transfers.listing_id) are still scanned: the script verifies
 * LIVE data, and a live project restored from a backup or written before an
 * index landed can carry violations the schema claims impossible.
 *
 * Tables with a composite PRIMARY KEY equal to their natural key
 * (chat_reads, subscriptions) cannot hold duplicates and are skipped.
 */

export type DuplicateSpec = {
  /** PostgREST table name. */
  table: string;
  /** Natural-key columns that define a logical duplicate. */
  keyColumns: readonly string[];
  /**
   * Key columns that are free text: values are trimmed + lower-cased before
   * grouping so "Coins " and "coins" collapse into one key.
   */
  foldCase?: readonly string[];
  /**
   * Key columns where an empty/blank value means "not set" — rows with a
   * blank in any of these columns are skipped instead of grouped together
   * (every profile with email '' is not a duplicate of every other).
   */
  skipBlank?: readonly string[];
  /** Extra columns to fetch so the report is readable (id, created_at…). */
  reportColumns: readonly string[];
  /** PostgREST filter query params (e.g. "deleted_at=is.null"). */
  filters: readonly string[];
  /** SQL WHERE clause mirroring `filters` for the --sql output. */
  sqlWhere: string;
  /** One line explaining why this key means "duplicate" for this table. */
  reason: string;
};

export const DUPLICATE_SPECS: readonly DuplicateSpec[] = [
  {
    table: "profiles",
    keyColumns: ["email"],
    foldCase: ["email"],
    skipBlank: ["email"],
    reportColumns: ["id", "username", "public_id", "created_at"],
    filters: ["deleted_at=is.null"],
    sqlWhere: "deleted_at IS NULL AND btrim(email) <> ''",
    reason:
      "two alive profiles sharing an email — username/public_id are unique-indexed, email is not",
  },
  {
    table: "collections",
    keyColumns: ["owner_user_id", "name"],
    foldCase: ["name"],
    skipBlank: ["name"],
    reportColumns: ["id", "visibility", "created_at"],
    filters: ["deleted_at=is.null"],
    sqlWhere: "deleted_at IS NULL AND btrim(name) <> ''",
    reason:
      "same owner, same (case-folded) name — includes a double __wishlist__ per user",
  },
  {
    table: "items",
    keyColumns: ["collection_id", "title"],
    foldCase: ["title"],
    skipBlank: ["title"],
    reportColumns: ["id", "created_by_user_id", "created_at"],
    filters: ["deleted_at=is.null", "archived_at=is.null"],
    sqlWhere: "deleted_at IS NULL AND archived_at IS NULL AND btrim(title) <> ''",
    reason:
      "same collection, same (case-folded) title among alive, non-archived items — review before deleting, twins can be legitimate",
  },
  {
    table: "friend_requests",
    keyColumns: ["from_user_id", "to_user_id"],
    reportColumns: ["id", "created_at"],
    filters: ["deleted_at=is.null"],
    sqlWhere: "deleted_at IS NULL",
    reason:
      "same directed pair twice — the friend_requests_pair_key unique index should make this impossible; a hit means the index is missing on the live DB",
  },
  {
    table: "chat_messages",
    keyColumns: ["chat_id", "from_user_id", "text", "created_at"],
    reportColumns: ["id"],
    filters: [],
    sqlWhere: "TRUE",
    reason:
      "identical message from the same sender at the same instant — a client retry double-send",
  },
  {
    table: "marketplace_listings",
    keyColumns: ["item_id"],
    reportColumns: ["id", "owner_user_id", "mode", "created_at"],
    filters: ["sold_at=is.null"],
    sqlWhere: "sold_at IS NULL",
    reason:
      "two LIVE (unsold) listings for the same item — the app allows one live listing per item",
  },
  {
    table: "marketplace_transfers",
    keyColumns: ["listing_id"],
    reportColumns: ["id", "buyer_user_id", "transferred_at"],
    filters: [],
    sqlWhere: "TRUE",
    reason:
      "two sales recorded for one listing — marketplace_transfers_listing_uniq should make this impossible; a hit means the index is missing",
  },
  {
    table: "analytics_events",
    keyColumns: ["user_id", "name", "occurred_at"],
    reportColumns: ["id"],
    filters: [],
    sqlWhere: "TRUE",
    reason:
      "same event for the same user at the same instant — a client retry double-insert",
  },
];

export type DbRow = Record<string, unknown>;

export type DuplicateGroup = {
  /** Rendered natural-key value, `col=value` joined with " | ". */
  key: string;
  rows: DbRow[];
};

export type TableDuplicates = {
  spec: DuplicateSpec;
  scannedRows: number;
  groups: DuplicateGroup[];
};

function normalisedKeyPart(spec: DuplicateSpec, column: string, row: DbRow): string | null {
  const raw = row[column];
  const text = raw === null || raw === undefined ? "" : String(raw);
  const folded = spec.foldCase?.includes(column) ? text.trim().toLowerCase() : text;
  if (spec.skipBlank?.includes(column) && folded.trim() === "") return null;
  return folded;
}

/**
 * The grouping key for one row, or null when the row must be skipped
 * (a blank value in a `skipBlank` column).
 */
export function duplicateKeyForRow(spec: DuplicateSpec, row: DbRow): string | null {
  const parts: string[] = [];
  for (const column of spec.keyColumns) {
    const part = normalisedKeyPart(spec, column, row);
    if (part === null) return null;
    parts.push(`${column}=${part}`);
  }
  // NUL (\u0000) cannot appear in Postgres text values, so the join is
  // collision-free even when a key value contains the display separator.
  return parts.join("\u0000");
}

/** Group a table's rows by natural key and keep the groups with 2+ rows. */
export function findDuplicateGroups(spec: DuplicateSpec, rows: DbRow[]): TableDuplicates {
  const byKey = new Map<string, DbRow[]>();
  for (const row of rows) {
    const key = duplicateKeyForRow(spec, row);
    if (key === null) continue;
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }
  const groups: DuplicateGroup[] = [];
  for (const [key, list] of byKey) {
    if (list.length < 2) continue;
    groups.push({ key: key.split("\u0000").join(" | "), rows: list });
  }
  groups.sort((a, b) => b.rows.length - a.rows.length || (a.key < b.key ? -1 : 1));
  return { spec, scannedRows: rows.length, groups };
}

/** Columns the CLI must select for a spec (key + report, de-duplicated). */
export function selectColumns(spec: DuplicateSpec): string[] {
  return [...new Set([...spec.keyColumns, ...spec.reportColumns])];
}

/**
 * PostgREST URL for one page of a spec's table. Offset paging ordered by a
 * report column ("id" is always present) so pages are stable between calls.
 */
export function buildTablePageUrl(
  baseUrl: string,
  spec: DuplicateSpec,
  offset: number,
  pageSize: number,
): string {
  const params = [
    `select=${selectColumns(spec).join(",")}`,
    ...spec.filters,
    `order=${spec.reportColumns[0]}.asc`,
    `limit=${pageSize}`,
    `offset=${offset}`,
  ];
  return `${baseUrl.replace(/\/$/, "")}/rest/v1/${spec.table}?${params.join("&")}`;
}

/** Human-readable report across all scanned tables. Empty string when clean. */
export function renderDuplicateReport(results: TableDuplicates[]): string {
  const dirty = results.filter((r) => r.groups.length > 0);
  if (dirty.length === 0) return "";
  const lines: string[] = [];
  const total = dirty.reduce((n, r) => n + r.groups.length, 0);
  lines.push(`Found ${total} duplicate group(s) across ${dirty.length} table(s).`);
  for (const { spec, scannedRows, groups } of dirty) {
    lines.push("");
    lines.push(`${spec.table} — ${groups.length} group(s) in ${scannedRows} scanned row(s)`);
    lines.push(`  key: (${spec.keyColumns.join(", ")}) — ${spec.reason}`);
    for (const group of groups) {
      lines.push(`  ${group.key}  ×${group.rows.length}`);
      for (const row of group.rows) {
        const details = spec.reportColumns
          .map((c) => `${c}=${row[c] ?? "∅"}`)
          .join("  ");
        lines.push(`    ${details}`);
      }
    }
  }
  return lines.join("\n");
}

/**
 * SQL equivalent of one spec for the Supabase SQL editor (Dashboard → SQL),
 * for operators who prefer running the check server-side — it needs no
 * service-role key on the local machine and no paging.
 */
export function renderDuplicateSql(spec: DuplicateSpec): string {
  const keyExprs = spec.keyColumns.map((c) =>
    spec.foldCase?.includes(c) ? `lower(btrim(${c}))` : c,
  );
  const keyList = keyExprs.join(", ");
  return [
    `-- ${spec.table}: ${spec.reason}`,
    `SELECT ${keyList}, count(*) AS copies, array_agg(${spec.reportColumns[0]}) AS ids`,
    `FROM public.${spec.table}`,
    `WHERE ${spec.sqlWhere}`,
    `GROUP BY ${keyList}`,
    `HAVING count(*) > 1`,
    `ORDER BY copies DESC;`,
  ].join("\n");
}

/** All specs rendered as one paste-ready SQL editor script. */
export function renderAllDuplicateSql(): string {
  return DUPLICATE_SPECS.map(renderDuplicateSql).join("\n\n");
}
