import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Wiring tests for the `refreshFromCloud` helper added to `lib/chat-context.tsx`
 * plus its callers. The helper exists to close the gap where the receiver
 * never sees a sender's message if the realtime channel is silently down
 * (e.g. publication not wired). Importing chat-context directly under
 * `node --test` would pull in React Native peers, so we read the sources and
 * assert structurally that:
 *   - chat-context exposes `refreshFromCloud` on its context value
 *   - both /chats and /chat/[id] screens call it on mount
 *   - the helper composes `cloudFetchMessagesForChat` + `buildChatId`
 */

const CONTEXT_SRC = readFileSync(
  path.join(process.cwd(), "lib", "chat-context.tsx"),
  "utf8",
);
const CHATS_SCREEN_SRC = readFileSync(
  path.join(process.cwd(), "app", "chats.tsx"),
  "utf8",
);
const CHAT_DETAIL_SRC = readFileSync(
  path.join(process.cwd(), "app", "chat", "[id].tsx"),
  "utf8",
);

describe("chat-context refreshFromCloud wiring", () => {
  it("declares refreshFromCloud on the ChatContextValue type", () => {
    assert.match(
      CONTEXT_SRC,
      /refreshFromCloud:\s*\(otherUserIds\?:[^)]*\)\s*=>\s*Promise<void>/,
    );
  });

  it("implements refreshFromCloud as a useCallback that builds a chat id and fetches each", () => {
    assert.match(
      CONTEXT_SRC,
      /const\s+refreshFromCloud\s*=\s*useCallback\(/,
      "refreshFromCloud should be memoised via useCallback",
    );
    // The body should call buildChatId + cloudFetchMessagesForChat per target.
    const block = extractCallbackBlock(CONTEXT_SRC, "refreshFromCloud");
    assert.match(block, /buildChatId\(\s*user\.id\s*,/);
    assert.match(block, /cloudFetchMessagesForChat\(/);
    // It should fall back to the friends list when no ids are provided.
    assert.match(block, /friends/);
  });

  it("merges fetched cloud rows into local state via the same dedup helper used on initial hydration", () => {
    // mergeCloudMessages is the shared helper - both the initial-effect path
    // and refreshFromCloud must funnel through it, so a regression in dedup
    // only needs to be fixed in one place.
    assert.match(CONTEXT_SRC, /const\s+mergeCloudMessages\s*=\s*useCallback\(/);
    assert.match(CONTEXT_SRC, /mergeCloudMessages\(results\)/);
  });

  it("exposes refreshFromCloud on the context value object", () => {
    // Must appear inside the useMemo({...}) returned to the provider.
    const valueBlock = extractCallbackBlock(CONTEXT_SRC, "value");
    assert.match(valueBlock, /refreshFromCloud,/);
  });
});

describe("chats list screen refetches on mount", () => {
  it("destructures refreshFromCloud from useChat()", () => {
    assert.match(
      CHATS_SCREEN_SRC,
      /const\s*\{[^}]*refreshFromCloud[^}]*\}\s*=\s*useChat\(\)/,
    );
  });

  it("calls refreshFromCloud() inside a useEffect hook", () => {
    assert.match(CHATS_SCREEN_SRC, /useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?refreshFromCloud\(\)/);
  });
});

describe("chat detail screen refetches the open conversation on mount", () => {
  it("destructures refreshFromCloud from useChat()", () => {
    assert.match(
      CHAT_DETAIL_SRC,
      /const\s*\{[^}]*refreshFromCloud[^}]*\}\s*=\s*useChat\(\)/,
    );
  });

  it("scopes the refetch to the open otherUserId", () => {
    assert.match(
      CHAT_DETAIL_SRC,
      /refreshFromCloud\(\s*\[\s*otherUserId\s*\]\s*\)/,
    );
  });
});

/**
 * Crude block extractor: finds `name = ...` or `name(...)` and returns the
 * first `{ ... }` body via brace counting. Sufficient for these wiring asserts.
 */
function extractCallbackBlock(source: string, name: string): string {
  const startRegex = new RegExp(`(?:const\\s+${name}\\s*=|${name}\\s*=\\s*useMemo\\()`);
  const startMatch = source.match(startRegex) ?? source.match(new RegExp(`\\b${name}\\b`));
  if (!startMatch || startMatch.index === undefined) {
    throw new Error(`identifier ${name} not found in source`);
  }
  const openIdx = source.indexOf("{", startMatch.index);
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
