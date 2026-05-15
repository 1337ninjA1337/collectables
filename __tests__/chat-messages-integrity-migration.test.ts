import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural assertions over the chat_messages integrity-hardening migration
 * (20260515_chat_messages_integrity.sql). The SQL runs against Supabase
 * out-of-band; this guards against regressions in the two data-integrity
 * invariants (no self-chat, canonical chat_id) and their idempotent wrapping.
 */

const SOURCE = readFileSync(
  path.join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260515_chat_messages_integrity.sql",
  ),
  "utf8",
);

describe("chat_messages integrity migration", () => {
  it("adds a table-level self-chat CHECK constraint", () => {
    assert.match(
      SOURCE,
      /ADD CONSTRAINT chat_messages_self_chat_chk\s*CHECK \(from_user_id <> to_user_id\)/,
    );
  });

  it("adds a canonical chat_id CHECK tying the key to the participant pair", () => {
    assert.match(SOURCE, /ADD CONSTRAINT chat_messages_chat_id_canonical_chk/);
    // chat_id must equal "chat-" + least(uuid) + "-" + greatest(uuid)
    assert.match(SOURCE, /chat_id = 'chat-'/);
    assert.match(SOURCE, /least\(from_user_id, to_user_id\)::text/);
    assert.match(SOURCE, /greatest\(from_user_id, to_user_id\)::text/);
  });

  it("compares the participant uuids on the uuid type (not collated text)", () => {
    // least/greatest must take the uuid columns directly so binary order
    // matches the client-side JS string sort of canonical lowercase UUIDs.
    assert.doesNotMatch(SOURCE, /least\(from_user_id::text/);
    assert.doesNotMatch(SOURCE, /greatest\(from_user_id::text/);
  });

  it("adds both constraints NOT VALID then VALIDATEs them (short lock window)", () => {
    assert.match(SOURCE, /CHECK \(from_user_id <> to_user_id\) NOT VALID/);
    assert.match(SOURCE, /VALIDATE CONSTRAINT chat_messages_self_chat_chk/);
    assert.match(SOURCE, /\) NOT VALID;[\s\S]*VALIDATE CONSTRAINT chat_messages_chat_id_canonical_chk/);
  });

  it("is idempotent — every ALTER is guarded by a pg_constraint existence check", () => {
    assert.match(
      SOURCE,
      /IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_self_chat_chk'/,
    );
    assert.match(
      SOURCE,
      /IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_chat_id_canonical_chk'/,
    );
    assert.match(SOURCE, /DO \$\$[\s\S]*END\s*\$\$;/);
  });

  it("does not introduce UPDATE or DELETE policies (messages stay immutable)", () => {
    assert.doesNotMatch(SOURCE, /CREATE POLICY/);
    assert.doesNotMatch(SOURCE, /FOR UPDATE/);
    assert.doesNotMatch(SOURCE, /FOR DELETE/);
  });

  it("does not re-create the table or touch the realtime publication", () => {
    assert.doesNotMatch(SOURCE, /CREATE TABLE/);
    assert.doesNotMatch(SOURCE, /ALTER PUBLICATION/);
  });
});
