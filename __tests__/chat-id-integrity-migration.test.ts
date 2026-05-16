import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural assertions over the chat_id-integrity migration. The SQL runs
 * against Supabase out-of-band; this guards the constraint shape so a future
 * edit can't silently weaken the conversation-key guarantee or turn the
 * migration into one that fails on a live DB with legacy rows.
 */

const SOURCE = readFileSync(
  path.join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260516_chat_id_integrity.sql",
  ),
  "utf8",
);

describe("chat_id integrity migration", () => {
  it("adds a CHECK constraint to chat_messages", () => {
    assert.match(
      SOURCE,
      /ALTER TABLE public\.chat_messages\s+ADD CONSTRAINT chat_messages_chat_id_matches_participants\s+CHECK/,
    );
  });

  it("derives chat_id from the sorted participant pair", () => {
    assert.match(SOURCE, /chat_id\s*=\s*'chat-'/);
    assert.match(SOURCE, /least\(from_user_id::text COLLATE "C", to_user_id::text COLLATE "C"\)/);
    assert.match(
      SOURCE,
      /greatest\(from_user_id::text COLLATE "C", to_user_id::text COLLATE "C"\)/,
    );
  });

  it("is NOT VALID so it never fails on a pre-existing DB", () => {
    assert.match(SOURCE, /NOT VALID;/);
  });

  it("is documented in MANUAL-TASKS.md with the validate-later step", () => {
    const manual = readFileSync(
      path.join(process.cwd(), "MANUAL-TASKS.md"),
      "utf8",
    );
    assert.match(manual, /20260516_chat_id_integrity\.sql/);
    assert.match(
      manual,
      /VALIDATE CONSTRAINT chat_messages_chat_id_matches_participants/,
    );
  });
});
