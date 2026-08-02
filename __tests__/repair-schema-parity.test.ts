import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  PROFILE_COLUMNS,
  COLLECTION_COLUMNS,
  ITEM_COLUMNS,
} from "../lib/supabase-profiles-shapes";
import { MARKETPLACE_COLUMNS } from "../lib/supabase-marketplace-shapes";

/**
 * `supabase/repair-schema.sql` exists because PostgREST fails a whole request
 * with `400 … 42703 column … does not exist` when ONE projected column is
 * missing — so a single un-applied migration took down profiles, collections,
 * items and marketplace listings simultaneously on the deployed app.
 *
 * That script is only useful if it covers every column the client actually
 * projects. This test is the anti-drift guard: add a column to any
 * `*_COLUMNS` projection and the repair script (and its own verification
 * query) must learn about it too, or this fails.
 */

const repoRoot = path.join(__dirname, "..");
const sql = fs.readFileSync(
  path.join(repoRoot, "supabase/repair-schema.sql"),
  "utf8",
);

/** Columns PostgREST is asked for, minus the ones it never selects by name. */
function columnsOf(projection: string): string[] {
  return projection.split(",").map((c) => c.trim()).filter(Boolean);
}

/**
 * `id` is the primary key — it is created with the table and can never be
 * added by an `ADD COLUMN`, so the repair script legitimately omits it.
 */
const PK = "id";

const TABLES: Array<{ table: string; columns: string[] }> = [
  { table: "profiles", columns: columnsOf(PROFILE_COLUMNS) },
  { table: "collections", columns: columnsOf(COLLECTION_COLUMNS) },
  { table: "items", columns: columnsOf(ITEM_COLUMNS) },
  { table: "marketplace_listings", columns: columnsOf(MARKETPLACE_COLUMNS) },
];

describe("supabase/repair-schema.sql covers every projected column", () => {
  for (const { table, columns } of TABLES) {
    it(`adds or verifies every ${table} column the client selects`, () => {
      const missing = columns
        .filter((col) => col !== PK)
        .filter((col) => {
          const added = new RegExp(
            `alter table public\\.${table} add column if not exists ${col}\\b`,
            "i",
          ).test(sql);
          const verified = new RegExp(
            `\\('${table}','${col}'\\)`,
            "i",
          ).test(sql);
          return !(added || verified);
        });
      assert.deepEqual(
        missing,
        [],
        `repair-schema.sql does not handle ${table}: ${missing.join(", ")}. ` +
          "A column the client projects but the script never adds will keep " +
          "PostgREST answering 400 for the whole table.",
      );
    });
  }

  it("stays re-runnable — every ALTER is IF NOT EXISTS guarded", () => {
    const alters = sql.match(/alter table[^;]*add column[^;]*/gi) ?? [];
    assert.ok(alters.length > 0, "expected the script to add columns");
    for (const stmt of alters) {
      assert.match(
        stmt,
        /add column if not exists/i,
        `un-guarded ALTER would break a second run: ${stmt.slice(0, 90)}`,
      );
    }
  });

  // `validate-premium` answers 500 (not a degraded read) when `subscriptions`
  // is absent, so the repair script CREATEs it rather than only adding columns —
  // and must enable RLS, or a fresh table would expose every row.
  it("creates the subscriptions table with RLS and a self-read policy", () => {
    assert.match(sql, /create table if not exists public\.subscriptions/i);
    assert.match(
      sql,
      /alter table public\.subscriptions enable row level security/i,
      "a newly created subscriptions table without RLS would be world-readable",
    );
    assert.match(sql, /create policy "subscriptions_select_own"/i);
    assert.match(
      sql,
      /using \(auth\.uid\(\) = user_id\)/i,
      "the self-read policy must scope rows to the calling user",
    );
    assert.match(
      sql,
      /drop policy if exists "subscriptions_select_own"/i,
      "policy creation must stay re-runnable",
    );
  });

  it("reloads the PostgREST schema cache so the fix takes effect immediately", () => {
    assert.match(sql, /notify pgrst, 'reload schema'/i);
  });

  it("skips absent tables instead of failing the whole script", () => {
    for (const { table } of TABLES) {
      assert.match(
        sql,
        new RegExp(`to_regclass\\('public\\.${table}'\\) is null`, "i"),
        `${table} should be guarded by a to_regclass check`,
      );
    }
  });
});
