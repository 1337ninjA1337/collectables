import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * BE-8 — `20260620_fk_index_coverage.sql` closes the one gap in foreign-key
 * index coverage: `chat_messages.from_user_id`, whose FK to `auth.users` had no
 * leading-column index (the table only indexed `(chat_id, …)` and
 * `(to_user_id, …)`). An unindexed FK seq-scans the child table on every
 * cascading parent delete.
 *
 * This test guards the parts CI can assert statically:
 *   (1) the migration creates the missing index, idempotently;
 *   (2) every other FK across the schema already has a leading-column index,
 *       so this migration only needs the one (regression guard against a new
 *       unindexed FK landing without an index); and
 *   (3) the migration is documented in MANUAL-TASKS.md + the README apply order.
 */

const ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const MIGRATION = readFileSync(
  path.join(MIGRATIONS_DIR, "20260620_fk_index_coverage.sql"),
  "utf8",
);
const MANUAL = readFileSync(path.join(ROOT, "MANUAL-TASKS.md"), "utf8");
const README = readFileSync(path.join(ROOT, "README-DEPLOY.md"), "utf8");

// All migration SQL concatenated (comment-stripped) — used to verify that every
// FK column is covered by some leading-column index somewhere in the schema.
const ALL_SQL = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"))
  .join("\n")
  .replace(/--.*$/gm, "");

describe("FK index coverage migration (BE-8)", () => {
  it("creates the missing chat_messages.from_user_id index, idempotently", () => {
    const sql = MIGRATION.replace(/--.*$/gm, "");
    assert.match(
      sql,
      /CREATE INDEX IF NOT EXISTS chat_messages_from_idx\s+ON public\.chat_messages \(from_user_id\)/,
    );
  });

  it("does not add a friend_requests (to_user_id, status) composite — no status column exists", () => {
    // Only the executable SQL (comments stripped) — the rationale comment names "status".
    const sql = MIGRATION.replace(/--.*$/gm, "");
    assert.doesNotMatch(sql, /status/i);
  });

  it("every foreign key in the schema has a leading-column index", () => {
    // Each FK column → a regex matching an index whose FIRST column is that FK.
    // (Composite indexes count when the FK column leads, e.g.
    //  items_wishlist_idx (created_by_user_id, is_wishlist).)
    const fkColumns = [
      "owner_user_id", // collections, marketplace_listings, marketplace_transfers
      "collection_id", // items
      "created_by_user_id", // items
      "from_user_id", // friend_requests, chat_messages
      "to_user_id", // friend_requests, chat_messages
      "buyer_user_id", // marketplace_listings, marketplace_transfers
    ];
    for (const col of fkColumns) {
      // a CREATE [UNIQUE] INDEX whose parenthesised column list starts with `col`
      const re = new RegExp(
        `CREATE (?:UNIQUE )?INDEX[^;]*\\(\\s*${col}\\b`,
        "i",
      );
      assert.match(ALL_SQL, re, `no leading-column index for FK column ${col}`);
    }
    // chat_reads.user_id + profiles.id are covered by PRIMARY KEYs.
    assert.match(ALL_SQL, /primary key \(user_id, chat_id\)/i);
  });

  it("is documented in MANUAL-TASKS.md and the README apply order", () => {
    assert.match(MANUAL, /## 20260620_fk_index_coverage\.sql/);
    assert.match(README, /20260620_fk_index_coverage\.sql/);
  });
});
