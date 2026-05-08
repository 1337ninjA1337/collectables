import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("app/chat/[id].tsx — chat_opened wiring", () => {
  const src = read("app/chat/[id].tsx");

  it("imports trackEvent from @/lib/analytics", () => {
    assert.match(
      src,
      /import\s*\{\s*trackEvent\s*\}\s*from\s*["']@\/lib\/analytics["']/,
      "chat/[id].tsx must import trackEvent",
    );
  });

  it("destructures getRelationship from useSocial()", () => {
    assert.match(
      src,
      /const\s*\{[^}]*getRelationship[^}]*\}\s*=\s*useSocial\(\)/,
      "chat detail must pull getRelationship from useSocial() to compute withFriend",
    );
  });

  it("fires chat_opened with { conversationId, withFriend } props", () => {
    assert.match(
      src,
      /trackEvent\(\s*["']chat_opened["']\s*,\s*\{[^}]*conversationId[^}]*withFriend[^}]*\}\s*\)/,
      "chat/[id].tsx must fire trackEvent('chat_opened', { conversationId, withFriend })",
    );
  });

  it("debounces via setTimeout + cleanup so quick in/out doesn't double-count", () => {
    // Find the useEffect block that wraps trackEvent.
    const trackIdx = src.indexOf("trackEvent(\"chat_opened\"");
    const window = src.slice(Math.max(0, trackIdx - 400), trackIdx + 200);
    assert.match(window, /setTimeout\(/, "chat_opened must be wrapped in setTimeout for debounce");
    assert.match(
      window,
      /clearTimeout\(/,
      "the debounce useEffect must clean up its timer in the cleanup function",
    );
  });

  it("conversationId resolves to the stable chatId (not the raw URL param)", () => {
    const trackIdx = src.indexOf("trackEvent(\"chat_opened\"");
    const block = src.slice(trackIdx, trackIdx + 250);
    assert.match(
      block,
      /conversationId:\s*chatId/,
      "conversationId must be the stable chatId, not the raw otherUserId param",
    );
  });

  it("withFriend uses the mutual 'friend' relationship enum", () => {
    const trackIdx = src.indexOf("trackEvent(\"chat_opened\"");
    const block = src.slice(trackIdx, trackIdx + 300);
    assert.match(
      block,
      /withFriend:\s*getRelationship\([^)]+\)\s*===\s*["']friend["']/,
      "withFriend must check 'friend' (mutual), not 'following'/'request_sent' etc.",
    );
  });
});

describe("lib/social-context.tsx — friend_requested wiring", () => {
  const src = read("lib/social-context.tsx");

  it("imports trackEvent from @/lib/analytics", () => {
    assert.match(
      src,
      /import\s*\{\s*trackEvent\s*\}\s*from\s*["']@\/lib\/analytics["']/,
      "social-context must import trackEvent",
    );
  });

  it("fires friend_requested only when the request is new (not on duplicate sends)", () => {
    const addFriendIdx = src.indexOf("addFriend: async");
    assert.ok(addFriendIdx >= 0);
    const sliceEnd = src.indexOf("removeFriend: async", addFriendIdx);
    const body = src.slice(addFriendIdx, sliceEnd);
    assert.match(
      body,
      /alreadyRequested\s*=\s*hasRequest\(/,
      "addFriend must capture alreadyRequested via hasRequest before mutating state",
    );
    assert.match(
      body,
      /if\s*\(\s*!alreadyRequested\s*\)\s*\{[\s\S]*?trackEvent/,
      "trackEvent must be gated on !alreadyRequested so a re-tap doesn't double-fire",
    );
  });

  it("fires friend_requested with { targetUserId } prop", () => {
    const addFriendIdx = src.indexOf("addFriend: async");
    const sliceEnd = src.indexOf("removeFriend: async", addFriendIdx);
    const body = src.slice(addFriendIdx, sliceEnd);
    assert.match(
      body,
      /trackEvent\(\s*["']friend_requested["']\s*,\s*\{[^}]*targetUserId[^}]*\}\s*\)/,
      "friend_requested must include targetUserId",
    );
  });
});

describe("components/bottom-nav.tsx — premium_activated wiring", () => {
  const src = read("components/bottom-nav.tsx");

  it("imports trackEvent from @/lib/analytics", () => {
    assert.match(
      src,
      /import\s*\{\s*trackEvent\s*\}\s*from\s*["']@\/lib\/analytics["']/,
      "bottom-nav must import trackEvent",
    );
  });

  it("fires premium_activated inside the false→true transition useEffect", () => {
    // Locate the existing transition guard `if (!prevIsPremium.current && isPremium)`
    // and confirm trackEvent lives inside it (in the same block).
    const guardIdx = src.indexOf("!prevIsPremium.current && isPremium");
    assert.ok(guardIdx >= 0, "premium transition guard not found");
    const block = src.slice(guardIdx, guardIdx + 500);
    assert.match(
      block,
      /trackEvent\(\s*["']premium_activated["']/,
      "premium_activated must fire inside the false→true transition guard",
    );
  });

  it("includes a `source` prop on premium_activated", () => {
    const trackIdx = src.indexOf("trackEvent(\"premium_activated\"");
    const block = src.slice(trackIdx, trackIdx + 200);
    assert.match(
      block,
      /source:\s*["'][a-zA-Z_]+["']/,
      "premium_activated must include source per the taxonomy",
    );
  });
});

describe("Analytics #10 — taxonomy parity", () => {
  const taxonomy = read("lib/analytics-events.ts");

  it("chat_opened props match the taxonomy", () => {
    const block = taxonomy.slice(
      taxonomy.indexOf("chat_opened:"),
      taxonomy.indexOf("friend_requested:"),
    );
    assert.match(block, /["']conversationId["']/);
    assert.match(block, /["']withFriend["']/);
  });

  it("friend_requested props match the taxonomy", () => {
    const block = taxonomy.slice(
      taxonomy.indexOf("friend_requested:"),
      taxonomy.indexOf("premium_activated:"),
    );
    assert.match(block, /["']targetUserId["']/);
  });

  it("premium_activated props match the taxonomy", () => {
    const block = taxonomy.slice(
      taxonomy.indexOf("premium_activated:"),
      taxonomy.indexOf("language_switched:"),
    );
    assert.match(block, /["']source["']/);
  });
});
