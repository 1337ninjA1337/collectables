#!/usr/bin/env tsx
/**
 * Finds duplicate rows in the live Supabase database.
 *
 *   npm run db:find-duplicates          # scan via PostgREST and report
 *   npm run db:find-duplicates -- --sql # print the SQL-editor equivalent, no network
 *
 * What counts as a duplicate per table is defined in DUPLICATE_SPECS
 * (lib/db-duplicates.ts) — natural keys like (owner_user_id, name) for
 * collections, not the surrogate id PK.
 *
 * Credentials come from the environment / repo `.env` (never committed):
 *   EXPO_PUBLIC_SUPABASE_URL              — project URL (required)
 *   SUPABASE_SERVICE_ROLE_KEY             — full-table scan (recommended);
 *                                           dashboard → Settings → API
 *   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY  — fallback; RLS limits the scan to
 *                                           rows visible to an anonymous
 *                                           session, so coverage is partial
 *
 * Read-only: the script only issues GET requests. Fixing what it finds is a
 * manual, per-case decision — for schema-guarded keys a hit means the unique
 * index is missing on the live project (re-apply the migration), for the
 * rest review the reported ids before deleting anything.
 *
 * Exits 1 when duplicates are found so a cron wrapper can alert on it.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  DUPLICATE_SPECS,
  buildTablePageUrl,
  findDuplicateGroups,
  renderAllDuplicateSql,
  renderDuplicateReport,
  type DbRow,
  type TableDuplicates,
} from "../lib/db-duplicates";
import { parseDotEnv } from "../lib/powerbi-conn";

const ENV_PATH = path.join(__dirname, "..", ".env");
/** PostgREST page size — mirrors the BE-28 bounded-list convention. */
const PAGE_SIZE = 1000;
/** Hard cap per table so a runaway table can't loop forever. */
const MAX_PAGES = 200;

function resolveEnv(): Record<string, string | undefined> {
  const fileEnv = fs.existsSync(ENV_PATH)
    ? parseDotEnv(fs.readFileSync(ENV_PATH, "utf8"))
    : {};
  // .env wins over the ambient shell, matching print-powerbi-conn.ts.
  return { ...process.env, ...fileEnv };
}

async function fetchAllRows(
  baseUrl: string,
  apiKey: string,
  spec: (typeof DUPLICATE_SPECS)[number],
): Promise<DbRow[]> {
  const rows: DbRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = buildTablePageUrl(baseUrl, spec, page * PAGE_SIZE, PAGE_SIZE);
    const response = await fetch(url, {
      headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      throw new Error(
        `${spec.table}: PostgREST ${response.status} ${response.statusText}`,
      );
    }
    const batch = (await response.json()) as DbRow[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
  console.warn(
    `find-db-duplicates: ${spec.table} hit the ${MAX_PAGES * PAGE_SIZE}-row scan cap — results for this table are partial.`,
  );
  return rows;
}

async function main(): Promise<void> {
  if (process.argv.includes("--sql")) {
    console.log("-- Paste into Supabase Dashboard → SQL editor. Read-only.");
    console.log(renderAllDuplicateSql());
    return;
  }

  const env = resolveEnv();
  const baseUrl = env.EXPO_PUBLIC_SUPABASE_URL;
  if (!baseUrl) {
    console.error(
      "find-db-duplicates: EXPO_PUBLIC_SUPABASE_URL is not set (env or .env). " +
        "Alternatively run with --sql and paste the output into the SQL editor.",
    );
    process.exit(2);
  }
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = serviceKey ?? env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!apiKey) {
    console.error(
      "find-db-duplicates: no API key — set SUPABASE_SERVICE_ROLE_KEY (full scan) " +
        "or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (RLS-limited scan).",
    );
    process.exit(2);
  }
  if (!serviceKey) {
    console.warn(
      "find-db-duplicates: using the publishable key — RLS limits the scan to rows an " +
        "anonymous session can read, so most tables will look empty. Set " +
        "SUPABASE_SERVICE_ROLE_KEY locally for a full scan (never commit it).",
    );
  }

  const results: TableDuplicates[] = [];
  for (const spec of DUPLICATE_SPECS) {
    const rows = await fetchAllRows(baseUrl, apiKey, spec);
    const result = findDuplicateGroups(spec, rows);
    results.push(result);
    console.log(
      `scanned ${spec.table}: ${result.scannedRows} row(s), ${result.groups.length} duplicate group(s)`,
    );
  }

  const report = renderDuplicateReport(results);
  if (report === "") {
    console.log("\nfind-db-duplicates: no duplicates found.");
    return;
  }
  console.error(`\n${report}`);
  process.exit(1);
}

main().catch((error) => {
  console.error(`find-db-duplicates: ${error instanceof Error ? error.message : error}`);
  process.exit(2);
});
