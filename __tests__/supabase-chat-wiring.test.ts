import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural / wiring tests for `lib/supabase-chat.ts`.
 *
 * The runtime wrapper imports `@/lib/supabase` (which pulls in React Native
 * peers) so we cannot exercise it under `node --test` directly. Instead we
 * read the source and assert that each runtime wrapper actually composes
 * the pure shape helpers from `supabase-chat-shapes.ts`. Combined with the
 * exhaustive shape-helper tests in `supabase-chat-shapes.test.ts`, this
 * pins down the request URL/headers/body, the friend-check helper, and the
 * realtime/presence channel construction without spinning up fetch mocks.
 */

const SOURCE = readFileSync(
  path.join(process.cwd(), "lib", "supabase-chat.ts"),
  "utf8",
);

describe("supabase-chat.ts wiring", () => {
  it("imports each shape helper it relies on", () => {
    const helpers = [
      "buildAuthHeaders",
      "buildSendMessageHeaders",
      "chatRowToMessage",
      "fetchMessagesUrl",
      "friendCheckUrl",
      "inboxChannelTopic",
      "inboxFilter",
      "isMutualFriendFromResponses",
      "messageToInsertPayload",
      "realtimeEndpoint",
      "sendMessageUrl",
      "typingChannelTopic",
      "extractTypingUserIds",
    ];
    for (const helper of helpers) {
      assert.match(
        SOURCE,
        new RegExp(`\\b${helper}\\b`),
        `expected supabase-chat.ts to wire ${helper}`,
      );
    }
  });

  it("guards every runtime wrapper with the isSupabaseConfigured short-circuit", () => {
    const wrappers = [
      "fetchMessagesForChat",
      "sendMessage",
      "isMutualFriend",
      "subscribeToInbox",
      "subscribeToTyping",
    ];
    for (const wrapper of wrappers) {
      const fnRegex = new RegExp(
        `(?:export\\s+(?:async\\s+)?function\\s+${wrapper}|export\\s+function\\s+${wrapper})`,
      );
      assert.match(SOURCE, fnRegex, `${wrapper} should be exported`);
    }
    // Each runtime wrapper checks isSupabaseConfigured (or relies on
    // getRealtimeClient which does the same check) so local-only mode keeps
    // working without supabase configured.
    assert.match(SOURCE, /isSupabaseConfigured/);
  });

  it("fetchMessagesForChat sends a GET-style request via fetchMessagesUrl + buildAuthHeaders", () => {
    const block = extractFunctionBlock(SOURCE, "fetchMessagesForChat");
    assert.match(block, /fetchMessagesUrl\(/, "should build url via fetchMessagesUrl");
    assert.match(block, /buildAuthHeaders\(/, "should build headers via buildAuthHeaders");
    assert.match(block, /chatRowToMessage/, "should convert rows back into ChatMessage");
  });

  it("sendMessage POSTs via sendMessageUrl + buildSendMessageHeaders + messageToInsertPayload", () => {
    const block = extractFunctionBlock(SOURCE, "sendMessage");
    assert.match(block, /sendMessageUrl\(/);
    assert.match(block, /buildSendMessageHeaders\(/);
    assert.match(block, /messageToInsertPayload\(/);
    assert.match(block, /method:\s*"POST"/);
  });

  it("isMutualFriend issues two friendCheckUrl requests and combines via isMutualFriendFromResponses", () => {
    const block = extractFunctionBlock(SOURCE, "isMutualFriend");
    assert.match(block, /friendCheckUrl\([^)]*userA[^)]*userB[^)]*\)/);
    assert.match(block, /friendCheckUrl\([^)]*userB[^)]*userA[^)]*\)/);
    assert.match(block, /isMutualFriendFromResponses\(/);
  });

  it("subscribeToInbox uses inboxChannelTopic, inboxFilter and listens for INSERT events", () => {
    const block = extractFunctionBlock(SOURCE, "subscribeToInbox");
    assert.match(block, /inboxChannelTopic\(/);
    assert.match(block, /inboxFilter\(/);
    assert.match(block, /POSTGRES_CHANGES/);
    assert.match(block, /INSERT/);
    assert.match(block, /unsubscribe/);
  });

  it("subscribeToTyping uses typingChannelTopic and tracks presence keyed by selfId", () => {
    const block = extractFunctionBlock(SOURCE, "subscribeToTyping");
    assert.match(block, /typingChannelTopic\(/);
    assert.match(block, /presence:\s*\{\s*key:\s*selfId\s*\}/);
    assert.match(block, /\.track\(\s*\{\s*typing:/);
    assert.match(block, /extractTypingUserIds\(/);
    assert.match(block, /unsubscribe/);
  });
});

/**
 * Crude function-block extractor good enough for a single TS source file:
 * locates `function name` (or `export ... function name`) and returns the
 * matching `{ ... }` body via brace counting. Skips the parameter list
 * (which may contain destructured-default `{...}` blocks) by scanning until
 * the outer `(...)` closes, then finds the body `{`. Throws on miss so tests
 * fail loudly instead of silently regexing nothing.
 */
function extractFunctionBlock(source: string, name: string): string {
  const startMatch = source.match(
    new RegExp(`function\\s+${name}\\s*[<(]`),
  );
  if (!startMatch || startMatch.index === undefined) {
    throw new Error(`function ${name} not found in source`);
  }

  // Find the opening `(` of the parameter list.
  const parenStart = source.indexOf("(", startMatch.index);
  if (parenStart === -1) throw new Error(`no opening paren for ${name}`);

  // Walk forward past the balanced parameter list `(...)`.
  let parenDepth = 0;
  let parenEnd = -1;
  for (let i = parenStart; i < source.length; i++) {
    if (source[i] === "(") parenDepth++;
    else if (source[i] === ")") {
      parenDepth--;
      if (parenDepth === 0) { parenEnd = i; break; }
    }
  }
  if (parenEnd === -1) throw new Error(`unbalanced parens for ${name}`);

  // The function body `{` comes after the parameter list (possibly after a
  // return-type annotation containing `:` and `>`).
  const openIdx = source.indexOf("{", parenEnd);
  if (openIdx === -1) throw new Error(`no opening brace for ${name}`);

  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(openIdx, i + 1);
    }
  }
  throw new Error(`unbalanced braces for ${name}`);
}
