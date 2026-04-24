import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural assertions over the chat_messages migration. The actual SQL is
 * executed against Supabase out-of-band; this test guards against accidental
 * regressions in the schema/RLS shape (eg. losing the friend-only gate or
 * removing the realtime publication).
 */

const SOURCE = readFileSync(
  path.join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260424_chat_messages.sql",
  ),
  "utf8",
);

describe("chat_messages migration", () => {
  it("creates the chat_messages table with the documented columns", () => {
    assert.match(SOURCE, /CREATE TABLE IF NOT EXISTS public\.chat_messages/);
    for (const column of [
      "id",
      "chat_id",
      "from_user_id",
      "to_user_id",
      "text",
      "created_at",
    ]) {
      assert.match(
        SOURCE,
        new RegExp(`\\b${column}\\b`),
        `missing column declaration for '${column}'`,
      );
    }
  });

  it("enforces a non-empty bounded message body", () => {
    assert.match(SOURCE, /CHECK\s*\(length\(text\)\s*>\s*0\s*AND\s*length\(text\)\s*<=\s*4000\)/);
  });

  it("indexes by chat_id+created_at and by recipient+created_at", () => {
    assert.match(SOURCE, /CREATE INDEX IF NOT EXISTS chat_messages_chat_created_idx[\s\S]*chat_id, created_at/);
    assert.match(SOURCE, /CREATE INDEX IF NOT EXISTS chat_messages_recipient_created_idx[\s\S]*to_user_id, created_at/);
  });

  it("enables row level security", () => {
    assert.match(SOURCE, /ALTER TABLE public\.chat_messages ENABLE ROW LEVEL SECURITY/);
  });

  it("grants SELECT to either participant", () => {
    assert.match(SOURCE, /CREATE POLICY "chat_messages_select_participants"[\s\S]*FOR SELECT[\s\S]*USING/);
    assert.match(
      SOURCE,
      /auth\.uid\(\)\s*=\s*from_user_id[\s\S]*OR[\s\S]*auth\.uid\(\)\s*=\s*to_user_id/,
    );
  });

  it("requires the sender to be the authenticated user on INSERT", () => {
    assert.match(SOURCE, /CREATE POLICY "chat_messages_insert_friends_only"[\s\S]*FOR INSERT[\s\S]*WITH CHECK/);
    assert.match(SOURCE, /auth\.uid\(\)\s*=\s*from_user_id/);
  });

  it("requires both directions of the mutual friendship for INSERT", () => {
    const insertBlock = SOURCE.match(/chat_messages_insert_friends_only[\s\S]*?\);/);
    assert.ok(insertBlock, "insert policy block not found");
    const text = insertBlock![0];

    const fromMeToThem = /from_user_id\s*=\s*auth\.uid\(\)[\s\S]*?to_user_id\s*=\s*chat_messages\.to_user_id/;
    const fromThemToMe = /from_user_id\s*=\s*chat_messages\.to_user_id[\s\S]*?to_user_id\s*=\s*auth\.uid\(\)/;

    assert.match(text, fromMeToThem, "missing me→them friend_requests check");
    assert.match(text, fromThemToMe, "missing them→me friend_requests check");
  });

  it("rejects self-chats at the policy layer", () => {
    assert.match(SOURCE, /from_user_id\s*<>\s*to_user_id/);
  });

  it("does not expose UPDATE or DELETE policies", () => {
    assert.doesNotMatch(SOURCE, /CREATE POLICY[^"]*chat_messages[^"]*[\s\S]*FOR UPDATE/);
    assert.doesNotMatch(SOURCE, /CREATE POLICY[^"]*chat_messages[^"]*[\s\S]*FOR DELETE/);
  });

  it("adds the table to the supabase_realtime publication", () => {
    assert.match(
      SOURCE,
      /ALTER PUBLICATION supabase_realtime ADD TABLE public\.chat_messages/,
    );
  });
});
