import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Wiring tests for the "best practice chat message storage" hardening.
 *
 * The bug this guards against: message ids were minted as
 * `msg-<ts>-<rand>`, which is NOT a valid uuid, so every offline-composed
 * message failed to insert into the `chat_messages.id uuid` column and was
 * stranded in the pending queue forever. The fix mints a real uuid
 * client-side and sends it as an idempotency key, and the cloud insert is
 * now `ON CONFLICT DO NOTHING` so a retried/duplicate send is a no-op
 * instead of a duplicate message.
 *
 * chat-context.tsx pulls in React Native peers so it can't be imported
 * under `node --test`; we assert structurally on the source instead.
 */

const CONTEXT_SRC = readFileSync(
  path.join(process.cwd(), "lib", "chat-context.tsx"),
  "utf8",
);
const CHAT_SRC = readFileSync(
  path.join(process.cwd(), "lib", "supabase-chat.ts"),
  "utf8",
);
const SHAPES_SRC = readFileSync(
  path.join(process.cwd(), "lib", "supabase-chat-shapes.ts"),
  "utf8",
);

describe("chat-context client-minted uuid id", () => {
  it("imports newMessageId from chat-helpers", () => {
    assert.match(CONTEXT_SRC, /newMessageId/);
    assert.match(
      CONTEXT_SRC,
      /import\s*\{[\s\S]*newMessageId[\s\S]*\}\s*from\s*"@\/lib\/chat-helpers"/,
    );
  });

  it("no longer mints the non-uuid `msg-<ts>-<rand>` id", () => {
    assert.ok(
      !/generateMessageId/.test(CONTEXT_SRC),
      "stale generateMessageId helper should be gone",
    );
    assert.ok(
      !/`msg-\$\{Date\.now\(\)\}/.test(CONTEXT_SRC),
      "non-uuid id template must not survive",
    );
  });

  it("sends the client id + createdAt to the cloud as an idempotency key", () => {
    const block = CONTEXT_SRC.slice(CONTEXT_SRC.indexOf("const sendMessage"));
    assert.match(block, /const id = newMessageId\(\)/);
    assert.match(block, /const createdAt = new Date\(\)\.toISOString\(\)/);
    assert.match(block, /cloudSendMessage\(\{[\s\S]*?\bid,[\s\S]*?createdAt,[\s\S]*?\}\)/);
  });

  it("wraps the primary cloud send so a network throw falls back to local + pending", () => {
    const block = CONTEXT_SRC.slice(CONTEXT_SRC.indexOf("const sendMessage"));
    assert.match(block, /try\s*\{[\s\S]*cloudSendMessage\([\s\S]*\}\s*catch/);
    assert.match(block, /context:\s*"chat-context\.sendMessage"/);
  });

  it("wraps the pending flush cloud send so offline retries don't reject", () => {
    const block = CONTEXT_SRC.slice(
      CONTEXT_SRC.indexOf("const flushPending"),
      CONTEXT_SRC.indexOf("const refreshFromCloud"),
    );
    assert.match(block, /try\s*\{[\s\S]*cloudSendMessage\([\s\S]*\}\s*catch/);
    assert.match(block, /context:\s*"chat-context\.flushPending"/);
  });
});

describe("supabase-chat idempotent insert", () => {
  it("resolves an empty-but-OK insert via fallbackSentMessage (success, not failure)", () => {
    assert.match(CHAT_SRC, /fallbackSentMessage/);
    const block = CHAT_SRC.slice(
      CHAT_SRC.indexOf("export async function sendMessage"),
    );
    assert.match(
      block,
      /if\s*\(!rows\.length\)\s*\{[\s\S]*fallbackSentMessage\(input\)/,
    );
  });

  it("requests ON CONFLICT DO NOTHING via resolution=ignore-duplicates", () => {
    const sendHeaders = SHAPES_SRC.slice(
      SHAPES_SRC.indexOf("export function buildSendMessageHeaders"),
      SHAPES_SRC.indexOf("export function fallbackSentMessage"),
    );
    assert.match(
      sendHeaders,
      /Prefer:\s*"return=representation,resolution=ignore-duplicates"/,
    );
    // chat_messages has no UPDATE policy, so the send insert must DO NOTHING
    // on conflict, never DO UPDATE (`merge-duplicates`). `chat_reads`
    // elsewhere in this file legitimately uses merge-duplicates, hence the
    // scope to just the send-message header builder.
    assert.ok(
      !/merge-duplicates/.test(sendHeaders),
      "send insert must not DO UPDATE — chat_messages is immutable",
    );
  });
});
