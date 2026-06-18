import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * BE-9 — `20260621_updated_at_moddatetime.sql` gives every table a uniform
 * `updated_at` cursor + a `BEFORE UPDATE` moddatetime trigger that bumps it on
 * every mutation, the per-row cursor delta pulls (BE-14) filter on.
 *
 * Structural guards (the executable trigger behaviour runs on the Docker-backed
 * supabase-test CI, not here):
 *   (1) the contrib moddatetime extension is installed into `extensions`;
 *   (2) every one of the nine tables is covered (add column + trigger);
 *   (3) the column add is idempotent and the trigger drop-then-creates;
 *   (4) the trigger fires BEFORE UPDATE via extensions.moddatetime(updated_at);
 *   (5) it is documented in MANUAL-TASKS.md + the README apply order.
 */

const ROOT = process.cwd();
const MIGRATION = readFileSync(
  path.join(ROOT, "supabase", "migrations", "20260621_updated_at_moddatetime.sql"),
  "utf8",
);
const MANUAL = readFileSync(path.join(ROOT, "MANUAL-TASKS.md"), "utf8");
const README = readFileSync(path.join(ROOT, "README-DEPLOY.md"), "utf8");

// strip `-- ...` line comments so prose doesn't trip the SQL assertions.
const SQL = MIGRATION.replace(/--.*$/gm, "");

const TABLES = [
  "profiles",
  "collections",
  "items",
  "friend_requests",
  "chat_messages",
  "chat_reads",
  "marketplace_listings",
  "marketplace_transfers",
  "analytics_events",
];

describe("updated_at + moddatetime migration (BE-9)", () => {
  it("installs the moddatetime extension into the extensions schema", () => {
    assert.match(
      SQL,
      /CREATE EXTENSION IF NOT EXISTS moddatetime WITH SCHEMA extensions/i,
    );
  });

  it("covers every one of the nine tables in the loop array", () => {
    for (const t of TABLES) {
      assert.match(SQL, new RegExp(`'${t}'`), `table ${t} missing from the loop array`);
    }
    // exactly nine quoted table names in the ARRAY[...] list.
    const arrayBlock = SQL.match(/ARRAY\[([\s\S]*?)\]/i);
    assert.ok(arrayBlock, "no ARRAY[...] table list found");
    const names = arrayBlock![1].match(/'[a-z_]+'/g) ?? [];
    assert.equal(names.length, TABLES.length);
  });

  it("adds updated_at idempotently with NOT NULL DEFAULT now()", () => {
    assert.match(
      SQL,
      /ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now\(\)/i,
    );
  });

  it("drop-then-creates a BEFORE UPDATE trigger calling extensions.moddatetime(updated_at)", () => {
    assert.match(SQL, /DROP TRIGGER IF EXISTS handle_updated_at ON public\.%I/i);
    assert.match(
      SQL,
      /CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public\.%I/i,
    );
    assert.match(SQL, /EXECUTE FUNCTION extensions\.moddatetime\(updated_at\)/i);
  });

  it("is documented in MANUAL-TASKS.md and the README apply order", () => {
    assert.match(MANUAL, /## 20260621_updated_at_moddatetime\.sql/);
    assert.match(README, /20260621_updated_at_moddatetime\.sql/);
  });
});
