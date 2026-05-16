import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural assertions over the chat_messages integrity-hardening migration.
 * The SQL runs against Supabase out-of-band; this guards the constraint /
 * index shape against accidental regressions (eg. dropping the canonical
 * chat_id pin or the COLLATE "C" that makes it match the client's
 * buildChatId byte ordering).
 */

const SOURCE = readFileSync(
  path.join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260516_chat_messages_integrity.sql",
  ),
  "utf8",
);

describe("chat_messages integrity migration", () => {
  it("adds the canonical chat_id CHECK constraint", () => {
    assert.match(
      SOURCE,
      /ADD CONSTRAINT chat_messages_chat_id_canonical_chk[\s\S]*CHECK/,
    );
  });

  it("pins chat_id to 'chat-' || least(...) || '-' || greatest(...) of the participant ids", () => {
    assert.match(SOURCE, /'chat-'/);
    assert.match(
      SOURCE,
      /least\(from_user_id::text COLLATE "C", to_user_id::text COLLATE "C"\)/,
    );
    assert.match(
      SOURCE,
      /greatest\(from_user_id::text COLLATE "C", to_user_id::text COLLATE "C"\)/,
    );
  });

  it("compares chat_id under COLLATE \"C\" so it matches the client's buildChatId sort", () => {
    assert.match(SOURCE, /chat_id COLLATE "C"\s*=/);
  });

  it("bounds the chat_id length 1..200", () => {
    assert.match(SOURCE, /length\(chat_id\)\s*>\s*0/);
    assert.match(SOURCE, /length\(chat_id\)\s*<=\s*200/);
  });

  it("adds the constraint NOT VALID so existing rows don't block the migration", () => {
    assert.match(SOURCE, /NOT VALID/);
  });

  it("is idempotent — guarded by a pg_constraint existence check", () => {
    assert.match(SOURCE, /pg_constraint/);
    assert.match(SOURCE, /IF NOT EXISTS[\s\S]*chat_messages_chat_id_canonical_chk/);
  });

  it("adds the (chat_id, created_at, id) covering index for stable ordering", () => {
    assert.match(
      SOURCE,
      /CREATE INDEX IF NOT EXISTS chat_messages_chat_created_id_idx[\s\S]*chat_id, created_at, id/,
    );
  });

  it("does not weaken the original migration (no DROP / no new policy here)", () => {
    assert.doesNotMatch(SOURCE, /DROP\s+(TABLE|POLICY|CONSTRAINT)/i);
    assert.doesNotMatch(SOURCE, /CREATE POLICY/i);
  });
});
