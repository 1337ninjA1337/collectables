import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural assertions over the chat_messages integrity migration. The SQL
 * is applied to Supabase out-of-band; this test guards against accidental
 * regressions in the canonical-chat_id / distinct-participants constraints.
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
  it("adds a distinct-participants CHECK constraint", () => {
    assert.match(
      SOURCE,
      /ADD CONSTRAINT chat_messages_distinct_participants[\s\S]*CHECK \(from_user_id <> to_user_id\)/,
    );
  });

  it("adds a canonical chat_id CHECK constraint", () => {
    assert.match(
      SOURCE,
      /ADD CONSTRAINT chat_messages_chat_id_canonical[\s\S]*CHECK \([\s\S]*chat_id = 'chat-'/,
    );
  });

  it("compares the participant ids in C collation to match the client's sort", () => {
    assert.match(SOURCE, /from_user_id::text COLLATE "C"/);
    assert.match(SOURCE, /to_user_id::text COLLATE "C"/);
  });

  it("adds the constraints NOT VALID then VALIDATEs them (safe on existing rows)", () => {
    assert.match(SOURCE, /CHECK \(from_user_id <> to_user_id\) NOT VALID/);
    assert.match(SOURCE, /\) NOT VALID;/);
    assert.match(
      SOURCE,
      /VALIDATE CONSTRAINT chat_messages_distinct_participants/,
    );
    assert.match(
      SOURCE,
      /VALIDATE CONSTRAINT chat_messages_chat_id_canonical/,
    );
  });

  it("guards each ADD CONSTRAINT with an existence check so it is re-runnable", () => {
    const guards = SOURCE.match(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint/g);
    assert.ok(guards && guards.length === 2, "expected two pg_constraint guards");
  });
});
