import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Wiring tests for the client-generated-uuid message identity in
 * `lib/chat-context.tsx`. Importing the context under `node --test` would
 * pull in React Native peers, so we assert structurally that:
 *   - the legacy `msg-<ts>-<rand>` id scheme is gone (the uuid column
 *     rejected it, so offline messages could never sync)
 *   - the id is generated once via generateUuidV4 and reused for the cloud
 *     send + local fallback (stable idempotency key)
 *   - flushPending remaps any legacy non-uuid id before retrying so a
 *     previously-stuck offline message can finally reach the server
 */

const SRC = readFileSync(
  path.join(process.cwd(), "lib", "chat-context.tsx"),
  "utf8",
);

describe("chat-context uuid message identity", () => {
  it("imports the uuid mint + the shared sync-engine (BE-13b)", () => {
    // The id mint still lives here; the uuid-remap/idempotency logic moved into
    // the sync-engine, so `isUuidV4` is no longer imported by the context.
    assert.match(
      SRC,
      /import\s*\{\s*generateUuidV4\s*\}\s*from\s*"@\/lib\/uuid"/,
    );
    assert.match(
      SRC,
      /import\s*\{[\s\S]*?\bflushPendingQueue\b[\s\S]*?\}\s*from\s*"@\/lib\/sync-engine"/,
    );
  });

  it("no longer ships the legacy msg- id generator", () => {
    assert.doesNotMatch(SRC, /function generateMessageId/);
    assert.doesNotMatch(SRC, /`msg-\$\{Date\.now\(\)\}/);
  });

  it("generates the id once and reuses it for cloud send + local fallback", () => {
    assert.match(SRC, /const id = generateUuidV4\(\);/);
    // cloudSendMessage receives the client id …
    assert.match(SRC, /cloudSendMessage\(\{[\s\S]*?\bid,[\s\S]*?\}\)/);
    // … and the offline fallback message reuses the same id.
    assert.match(SRC, /const message: ChatMessage = cloudMessage \?\? \{[\s\S]*?\bid,[\s\S]*?\}/);
  });

  it("does not send a client created_at on the happy path (server-authoritative ordering)", () => {
    const send = SRC.slice(SRC.indexOf("const cloudMessage = await cloudSendMessage"));
    const call = send.slice(0, send.indexOf("});") + 3);
    assert.doesNotMatch(call, /createdAt/);
  });

  it("flushPending delegates the uuid-keyed flush to the sync-engine (BE-13b)", () => {
    // The legacy-id remap + per-group stop-on-failure now live in
    // `flushPendingQueue` (covered by sync-engine.test.ts). The context wires
    // it with the message id as the queue key and the cloud send as `deliver`,
    // passing the engine-minted `outId` through as the message id.
    assert.match(
      SRC,
      /flushPendingQueue<ChatMessage>\(pending,\s*\{[\s\S]*?getId:\s*\(msg\)\s*=>\s*msg\.id/,
    );
    // BE-29: the cloud send is wrapped in createRateLimitedDeliver so a runaway
    // client is throttled against the Supabase write quota.
    assert.match(
      SRC,
      /deliver:\s*createRateLimitedDeliver\(async\s*\(msg,\s*outId\)\s*=>/,
    );
    assert.match(SRC, /id:\s*outId/);
  });

  it("flushPending drops delivered messages via applyFlushToQueue (no whole-chat re-send)", () => {
    assert.match(
      SRC,
      /applyFlushToQueue\(\s*prev\.pendingByChatId,\s*sent,\s*\(m\) => m\.id/,
    );
  });

  it("flushPending rewrites the cached message id when it remapped", () => {
    assert.match(SRC, /m\.id === oldId \? \{ \.\.\.m, id: newId \} : m/);
  });
});
