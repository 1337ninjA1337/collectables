import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Wiring tests for the Chat DB #1 client_message_id idempotency plumbing in
 * `lib/chat-context.tsx`. Direct import would pull in React Native peers
 * under `node --test`, so we assert structurally that:
 *   - the module imports `generateClientMessageId` from the shapes module
 *   - `sendMessage` mints a clientMessageId per call and forwards it
 *   - the local fallback message records the same clientMessageId so the
 *     pending-queue retry surfaces it back to the server
 *   - `flushPending` forwards `msg.clientMessageId` to the cloud helper
 */

const SOURCE = readFileSync(
  path.join(process.cwd(), "lib", "chat-context.tsx"),
  "utf8",
);

describe("chat-context client_message_id wiring", () => {
  it("imports generateClientMessageId from the shapes module", () => {
    assert.match(
      SOURCE,
      /from\s+"@\/lib\/supabase-chat-shapes"/,
      "expected an import from @/lib/supabase-chat-shapes",
    );
    assert.match(SOURCE, /\bgenerateClientMessageId\b/);
  });

  it("sendMessage mints a clientMessageId per send and forwards it to cloudSendMessage", () => {
    const block = extractCallbackBlock(SOURCE, "sendMessage");
    // Generate once...
    assert.match(
      block,
      /const\s+clientMessageId\s*=\s*generateClientMessageId\(\)/,
    );
    // ...and pass it to the cloud send so the unique index can catch retries.
    assert.match(
      block,
      /cloudSendMessage\(\s*\{[\s\S]*clientMessageId[\s\S]*\}\s*\)/,
    );
  });

  it("local-fallback message carries the same clientMessageId so retries stay idempotent", () => {
    const block = extractCallbackBlock(SOURCE, "sendMessage");
    // The `??` (cloudMessage ?? { ... }) object literal must include clientMessageId.
    assert.match(
      block,
      /cloudMessage\s*\?\?\s*\{[\s\S]*clientMessageId[\s\S]*\}/,
    );
  });

  it("flushPending forwards msg.clientMessageId to cloudSendMessage so the unique index catches replayed pending entries", () => {
    const block = extractCallbackBlock(SOURCE, "flushPending");
    assert.match(
      block,
      /cloudSendMessage\(\s*\{[\s\S]*clientMessageId:\s*msg\.clientMessageId[\s\S]*\}\s*\)/,
    );
  });

  it("flushPending stops sending msg.id (server uuid is server-issued; only client_message_id deduplicates)", () => {
    const block = extractCallbackBlock(SOURCE, "flushPending");
    assert.doesNotMatch(
      block,
      /\bid:\s*msg\.id\b/,
      "flushPending should not forward the optimistic local id as the server id",
    );
  });
});

/**
 * Locate `const <name> = useCallback(` and return the matching balanced
 * `( ... )` body. Used so a regex on the whole module file doesn't accidentally
 * match a similar identifier outside the callback we care about.
 */
function extractCallbackBlock(source: string, name: string): string {
  const startMatch = source.match(
    new RegExp(`const\\s+${name}\\s*=\\s*useCallback\\s*\\(`),
  );
  if (!startMatch || startMatch.index === undefined) {
    throw new Error(`useCallback ${name} not found in source`);
  }
  const openIdx = source.indexOf("(", startMatch.index + startMatch[0].length - 1);
  if (openIdx === -1) throw new Error(`no opening paren for ${name}`);
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return source.slice(openIdx, i + 1);
    }
  }
  throw new Error(`unbalanced parens for ${name}`);
}
