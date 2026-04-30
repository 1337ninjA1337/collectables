import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural tests for the cloud-refresh fallback added to chat-context.
 *
 * The full provider can't be exercised under `node --test` (it pulls in
 * React Native peers). Instead we read the source and assert that the new
 * `refreshChat` / `refreshAll` helpers exist, are exposed through the
 * context value, and call into the cloud fetch helper. Combined with the
 * existing `chat-helpers.test.ts` and `supabase-chat-shapes.test.ts` this
 * pins down the wiring without spinning up a fake fetch.
 *
 * It also asserts that `app/chat/[id].tsx` and `app/chats.tsx` actually
 * call into those helpers on mount + on an interval, so a missed realtime
 * push reconciles within a single refresh cycle.
 */

const CONTEXT_SOURCE = readFileSync(
  path.join(process.cwd(), "lib", "chat-context.tsx"),
  "utf8",
);
const CHAT_DETAIL_SOURCE = readFileSync(
  path.join(process.cwd(), "app", "chat", "[id].tsx"),
  "utf8",
);
const CHATS_LIST_SOURCE = readFileSync(
  path.join(process.cwd(), "app", "chats.tsx"),
  "utf8",
);
const ROOT_LAYOUT_SOURCE = readFileSync(
  path.join(process.cwd(), "app", "_layout.tsx"),
  "utf8",
);

describe("chat-context refresh wiring", () => {
  it("exposes refreshChat and refreshAll on the context value", () => {
    assert.match(CONTEXT_SOURCE, /refreshChat:\s*\(otherUserId:\s*string\)\s*=>\s*Promise<void>/);
    assert.match(CONTEXT_SOURCE, /refreshAll:\s*\(\)\s*=>\s*Promise<void>/);
  });

  it("includes both helpers in the memoised value object", () => {
    const valueBlockMatch = CONTEXT_SOURCE.match(
      /useMemo<ChatContextValue>\(\s*\(\)\s*=>\s*\(\{[\s\S]*?\}\),/,
    );
    assert.ok(valueBlockMatch, "expected useMemo<ChatContextValue> block");
    const block = valueBlockMatch[0];
    assert.match(block, /\brefreshChat\b/);
    assert.match(block, /\brefreshAll\b/);
  });

  it("refreshChat short-circuits on missing user / canMessage and uses cloudFetchMessagesForChat", () => {
    const block = extractCallback(CONTEXT_SOURCE, "refreshChat");
    assert.match(block, /if\s*\(!user\b/);
    assert.match(block, /canMessage\(otherUserId\)/);
    assert.match(block, /buildChatId\(\s*user\.id\s*,\s*otherUserId\s*\)/);
    assert.match(block, /cloudFetchMessagesForChat\(/);
  });

  it("refreshAll fans out across friends and merges every result", () => {
    const block = extractCallback(CONTEXT_SOURCE, "refreshAll");
    assert.match(block, /friends\.length\s*===\s*0/);
    assert.match(block, /Promise\.all\(\s*friends\.map\(/);
    assert.match(block, /cloudFetchMessagesForChat\(/);
  });
});

describe("chat detail screen polling", () => {
  it("destructures refreshChat from useChat", () => {
    assert.match(CHAT_DETAIL_SOURCE, /\brefreshChat\b/);
  });

  it("kicks off a refresh on mount and on an interval", () => {
    assert.match(CHAT_DETAIL_SOURCE, /refreshChat\(otherUserId\)/);
    assert.match(CHAT_DETAIL_SOURCE, /setInterval\(/);
    assert.match(CHAT_DETAIL_SOURCE, /clearInterval\(/);
  });
});

describe("chats list screen polling", () => {
  it("destructures refreshAll from useChat", () => {
    assert.match(CHATS_LIST_SOURCE, /\brefreshAll\b/);
  });

  it("kicks off a refresh on mount and on an interval", () => {
    assert.match(CHATS_LIST_SOURCE, /refreshAll\(\)/);
    assert.match(CHATS_LIST_SOURCE, /setInterval\(/);
    assert.match(CHATS_LIST_SOURCE, /clearInterval\(/);
  });
});

describe("desktop header chats button", () => {
  it("renders a chats nav icon when not already on a chat route", () => {
    assert.match(ROOT_LAYOUT_SOURCE, /chatbubbles-outline/);
    assert.match(ROOT_LAYOUT_SOURCE, /router\.push\("\/chats"\)/);
  });

  it("hides the button on the chat routes themselves to avoid no-op nav", () => {
    assert.match(ROOT_LAYOUT_SOURCE, /pathname\.startsWith\("\/chats"\)/);
    assert.match(ROOT_LAYOUT_SOURCE, /pathname\.startsWith\("\/chat\/"\)/);
  });

  it("shows an unread count badge using formatBadgeCount", () => {
    assert.match(ROOT_LAYOUT_SOURCE, /unreadTotal\s*>\s*0/);
    assert.match(ROOT_LAYOUT_SOURCE, /formatBadgeCount\(unreadTotal\)/);
  });
});

function extractCallback(source: string, name: string): string {
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
