import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * BE-15a — `20260623_soft_delete_deleted_at.sql` adds the soft-delete
 * `deleted_at` column + a partial "alive" index to the four user-deletable
 * tables, the foundation of the LWW/tombstone conflict policy.
 *
 * Structural guards (the column/index actually exist on the Docker-backed
 * supabase-test CI, not here):
 *   (1) every deletable table is covered (add column + partial index);
 *   (2) `deleted_at` is a nullable timestamptz (NULL = alive);
 *   (3) the column add + index create are idempotent;
 *   (4) the index is partial on `WHERE deleted_at IS NULL`;
 *   (5) the append-only audit tables are NOT touched;
 *   (6) it is documented in MANUAL-TASKS.md + the README apply order;
 *   (7) the conflict-policy doc explains LWW + soft-delete/tombstones.
 */

const ROOT = process.cwd();
const MIGRATION = readFileSync(
  path.join(ROOT, "supabase", "migrations", "20260623_soft_delete_deleted_at.sql"),
  "utf8",
);
const MANUAL = readFileSync(path.join(ROOT, "MANUAL-TASKS.md"), "utf8");
const README = readFileSync(path.join(ROOT, "README-DEPLOY.md"), "utf8");
const POLICY = readFileSync(path.join(ROOT, "docs", "CONFLICT-POLICY.md"), "utf8");

// strip `-- ...` line comments so prose doesn't trip the SQL assertions.
const SQL = MIGRATION.replace(/--.*$/gm, "");

const DELETABLE = ["collections", "items", "profiles", "friend_requests"];
const APPEND_ONLY = [
  "analytics_events",
  "marketplace_transfers",
  "chat_reads",
];

describe("soft-delete deleted_at migration (BE-15a)", () => {
  it("covers exactly the four user-deletable tables in the loop array", () => {
    const arrayBlock = SQL.match(/ARRAY\[([\s\S]*?)\]/i);
    assert.ok(arrayBlock, "no ARRAY[...] table list found");
    const names = (arrayBlock![1].match(/'[a-z_]+'/g) ?? []).map((s) =>
      s.replace(/'/g, ""),
    );
    assert.deepEqual(new Set(names), new Set(DELETABLE));
    assert.equal(names.length, DELETABLE.length);
  });

  it("adds a nullable timestamptz deleted_at (NULL = alive, no default)", () => {
    assert.match(
      SQL,
      /ADD COLUMN IF NOT EXISTS deleted_at timestamptz'/i,
    );
    // no DEFAULT on the column — alive rows carry NULL.
    assert.doesNotMatch(SQL, /deleted_at timestamptz[^']*DEFAULT/i);
  });

  it("creates a partial alive index WHERE deleted_at IS NULL, idempotently", () => {
    assert.match(SQL, /CREATE INDEX IF NOT EXISTS/i);
    assert.match(SQL, /WHERE deleted_at IS NULL/i);
    assert.match(SQL, /_alive_idx/);
  });

  it("does not touch the append-only audit/log tables", () => {
    for (const t of APPEND_ONLY) {
      assert.doesNotMatch(SQL, new RegExp(`'${t}'`), `${t} must not be soft-deletable`);
    }
  });

  it("is documented in MANUAL-TASKS.md and the README apply order", () => {
    assert.ok(
      MANUAL.includes("## 20260623_soft_delete_deleted_at.sql"),
      "MANUAL-TASKS.md must have a section for the migration",
    );
    assert.match(README, /20260623_soft_delete_deleted_at\.sql/);
  });

  it("ships a conflict-policy doc covering LWW + soft-delete/tombstones", () => {
    assert.match(POLICY, /Last-Write-Wins/i);
    assert.match(POLICY, /updated_at/);
    assert.match(POLICY, /deleted_at/);
    assert.match(POLICY, /tombstone/i);
    assert.match(POLICY, /deletedProfileIds/);
  });
});
