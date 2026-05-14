import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural assertions over the chat_messages client_message_id migration
 * (Chat DB #1). The SQL runs against Supabase out-of-band — this test guards
 * against accidental regressions in the column shape, the partial UNIQUE
 * index used for idempotent retries, and the back-compat nullability.
 */

const SOURCE = readFileSync(
  path.join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260514_chat_messages_client_id.sql",
  ),
  "utf8",
);

describe("chat_messages client_message_id migration", () => {
  it("adds a nullable client_message_id uuid column to public.chat_messages", () => {
    assert.match(
      SOURCE,
      /ALTER TABLE public\.chat_messages[\s\S]*ADD COLUMN IF NOT EXISTS client_message_id uuid/,
    );
  });

  it("does not set NOT NULL on the new column (back-compat for legacy rows)", () => {
    assert.doesNotMatch(SOURCE, /client_message_id\s+uuid\s+NOT NULL/i);
  });

  it("creates a UNIQUE index over (from_user_id, client_message_id)", () => {
    assert.match(
      SOURCE,
      /CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_client_id_uniq[\s\S]*\(\s*from_user_id\s*,\s*client_message_id\s*\)/,
    );
  });

  it("scopes the UNIQUE index to non-null client_message_id values (partial index)", () => {
    assert.match(
      SOURCE,
      /chat_messages_client_id_uniq[\s\S]*WHERE\s+client_message_id\s+IS\s+NOT\s+NULL/i,
    );
  });

  it("is idempotent so re-running the migration does not fail", () => {
    assert.match(SOURCE, /ADD COLUMN IF NOT EXISTS/);
    assert.match(SOURCE, /CREATE UNIQUE INDEX IF NOT EXISTS/);
  });

  it("is documented in MANUAL-TASKS.md", () => {
    const manual = readFileSync(
      path.join(process.cwd(), "MANUAL-TASKS.md"),
      "utf8",
    );
    assert.match(manual, /20260514_chat_messages_client_id\.sql/);
    assert.match(manual, /client_message_id/);
  });
});
