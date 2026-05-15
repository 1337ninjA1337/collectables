import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { inputToSentMessage } from "@/lib/supabase-chat-shapes";

/**
 * Regression coverage for the offline-message persistence bug.
 *
 * `chat_messages.id` is a Postgres `uuid` primary key. The chat context used
 * to mint local ids as `msg-<ts>-<rand>`, which is NOT a valid uuid. When an
 * offline message was later flushed to the cloud the INSERT failed with
 * "invalid input syntax for type uuid", so the message was stranded in the
 * pending queue forever and never reached the recipient.
 *
 * The fix is two-fold and best-practice for chat persistence:
 *   1. client ids are RFC-4122 uuids (round-trip the uuid column + idempotent
 *      dedup across devices via the stable id)
 *   2. a retried flush that hits a duplicate primary key (HTTP 409) is
 *      treated as already-delivered instead of a permanent failure
 */

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("inputToSentMessage (idempotent-send reconstruction)", () => {
  const base = {
    chatId: "chat-a-b",
    fromUserId: "11111111-1111-4111-8111-111111111111",
    toUserId: "22222222-2222-4222-8222-222222222222",
    text: "hi",
  };

  it("returns null when the input carries no client id (online send path)", () => {
    assert.equal(inputToSentMessage({ ...base }), null);
  });

  it("reconstructs the stored message from a flushed offline input", () => {
    const id = "33333333-3333-4333-8333-333333333333";
    const createdAt = "2026-05-15T10:00:00.000Z";
    const msg = inputToSentMessage({ ...base, id, createdAt });
    assert.deepEqual(msg, {
      id,
      chatId: base.chatId,
      fromUserId: base.fromUserId,
      toUserId: base.toUserId,
      text: base.text,
      createdAt,
    });
  });

  it("defaults createdAt to a valid ISO timestamp when the input has none", () => {
    const msg = inputToSentMessage({
      ...base,
      id: "44444444-4444-4444-8444-444444444444",
    });
    assert.ok(msg);
    assert.ok(!Number.isNaN(Date.parse(msg!.createdAt)));
  });
});

describe("chat-context generateMessageId", () => {
  const SRC = readFileSync(
    path.join(process.cwd(), "lib", "chat-context.tsx"),
    "utf8",
  );

  it("imports randomUUID from expo-crypto", () => {
    assert.match(SRC, /import\s*\{\s*randomUUID\s*\}\s*from\s*"expo-crypto"/);
  });

  it("returns randomUUID() and not the legacy non-uuid format", () => {
    const fn = SRC.slice(SRC.indexOf("function generateMessageId"));
    const body = fn.slice(0, fn.indexOf("}") + 1);
    assert.match(body, /return\s+randomUUID\(\)/);
    assert.doesNotMatch(
      SRC,
      /`msg-\$\{Date\.now\(\)\}/,
      "the legacy msg-<ts>-<rand> id format must not return",
    );
  });
});

describe("supabase-chat sendMessage idempotency", () => {
  const SRC = readFileSync(
    path.join(process.cwd(), "lib", "supabase-chat.ts"),
    "utf8",
  );

  it("imports inputToSentMessage", () => {
    assert.match(SRC, /\binputToSentMessage\b/);
  });

  it("treats an HTTP 409 conflict as a successful (already-delivered) send", () => {
    assert.match(
      SRC,
      /res\.status\s*===\s*409[\s\S]*?inputToSentMessage\(input\)/,
    );
  });
});
