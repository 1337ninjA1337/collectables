import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { stripComments } from "@/lib/strip-comments";

import { readRepoFile } from "./helpers/repo-file";

/**
 * The read receipt that cleared itself while nobody was looking.
 *
 * `app/chat/[id].tsx` calls `markRead(chatId)` from an effect keyed on
 * `messages.length`, and messages arrive on their own: over the realtime
 * presence channel, and over the 8s `useVisibilityRefresh` poll. So a message
 * that landed in a hidden tab or a backgrounded app was marked read with
 * nobody in front of it.
 *
 * What makes it more than a local flag is `markRead` itself: it writes
 * `lastReadByChat` AND `upsertChatRead(user.id, chatId, latest)`, so the
 * SENDER was shown a read receipt the recipient never earned, and the
 * recipient lost the unread badge that was going to tell them about the
 * message at all.
 *
 * Source reads rather than a render, for the reason `chat-screen-send.test.ts`
 * gives: this screen reaches expo-router, three contexts, a realtime channel
 * and a `KeyboardAvoidingView`, and nothing in this tree mounts it. The
 * behaviour of the gate itself is `use-app-visible.test.ts`' subject — thirteen
 * cases over both platforms and both directions; these say the screen is wired
 * to it.
 */
const CODE = stripComments(readRepoFile("app/chat/[id].tsx"));
const CHAT_CONTEXT = stripComments(readRepoFile("lib/chat-context.tsx"));

describe("the read receipt waits for somebody to be looking", () => {
  it("gates markRead on the visibility hook", () => {
    assert.match(CODE, /const appVisible = useAppVisible\(\);/);
    assert.match(
      CODE,
      /if \(chatId && appVisible\) markRead\(chatId\);/,
      "the gate has to be in front of the call, not inside the context",
    );
  });

  it("reads appVisible as a dependency, so coming back marks read what arrived", () => {
    // The half that makes the gate honest. An early `return` out of an effect
    // whose deps are `[chatId, messages.length]` would hold the receipt until
    // the NEXT message, so a conversation read after a departure would keep an
    // unread badge over messages the user has plainly seen.
    assert.match(CODE, /\}, \[chatId, messages\.length, appVisible, markRead\]\);/);
  });

  it("imports the hook rather than re-deriving visibility in the screen", () => {
    // Third copy of the platform split is how this file got its last defect:
    // a hand-rolled `document.hidden` listener that could not see an alt-tab.
    assert.match(CODE, /import \{ useAppVisible \} from "@\/lib\/use-app-visible";/);
    assert.ok(!/visibilitychange/.test(CODE), "the web half of the split is back in the screen");
    assert.ok(!/AppState/.test(CODE), "the native half of the split is back in the screen");
  });

  it("still marks read on a message that arrives while the screen is open", () => {
    // The gate must not have replaced the feature. `messages.length` stays in
    // the deps, so an arrival in a visible tab is still read immediately.
    assert.match(CODE, /useEffect\(\(\) => \{\s*if \(chatId && appVisible\) markRead\(chatId\);/);
  });
});

describe("what markRead costs, which is why the gate is worth its line", () => {
  it("writes the receipt to the server, not just to local state", () => {
    assert.match(
      CHAT_CONTEXT,
      /if \(user\) void upsertChatRead\(user\.id, chatId, latest\);/,
      "if this ever became local-only the gate would be a nicety rather than a fix",
    );
  });

  it("is what the unread badge is computed from", () => {
    // `lastReadByChat` is the stored high-water mark; clearing it with nobody
    // looking is what loses the badge.
    assert.match(CHAT_CONTEXT, /lastReadByChat: \{ \.\.\.prev\.lastReadByChat, \[chatId\]: latest \}/);
  });
});
