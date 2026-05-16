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
  it("imports the uuid helpers", () => {
    assert.match(
      SRC,
      /import\s*\{[^}]*\bgenerateUuidV4\b[^}]*\bisUuidV4\b[^}]*\}\s*from\s*"@\/lib\/uuid"/,
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

  it("flushPending remaps a legacy non-uuid id to a fresh uuid before retrying", () => {
    assert.match(
      SRC,
      /const outId = isUuidV4\(msg\.id\) \? msg\.id : generateUuidV4\(\);/,
    );
    assert.match(SRC, /id:\s*outId/);
    assert.match(SRC, /sent\.push\(\{ chatId, oldId: msg\.id, newId: outId \}\)/);
  });

  it("flushPending drops delivered messages individually (no whole-chat re-send)", () => {
    assert.match(SRC, /if \(!delivered\) break;/);
    assert.match(SRC, /msgs\.filter\(\(m\) => !sentIds\.has\(m\.id\)\)/);
  });

  it("flushPending rewrites the cached message id when it remapped", () => {
    assert.match(SRC, /m\.id === oldId \? \{ \.\.\.m, id: newId \} : m/);
  });
});
