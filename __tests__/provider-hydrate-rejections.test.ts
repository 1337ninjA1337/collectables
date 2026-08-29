import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { EMPTY_CHAT_STORE, parseChatStore } from "@/lib/chat-helpers";

import { readI18nSource } from "./helpers/i18n-source-file";
import { readRepoFile } from "./helpers/repo-file";

/**
 * The three provider hydrates that used to reject into nothing.
 *
 * `.finally` handles nothing and `try`/`finally` handles nothing, and all three
 * providers ended their hydration chain at one — under a `void hydrate(...)`
 * caller in two cases and a bare promise chain in the third. So on a device
 * whose store is broken, mounting the app produced an UNHANDLED REJECTION:
 * a redbox in dev, a logged error nobody reads in production, and no report.
 *
 * Four rules about swallowed storage failures were green throughout, because
 * an unhandled rejection is not a swallowed one — every one of them was looking
 * for a `catch` that did too little rather than for the absence of one.
 * `report-storage-failure.test.ts` now sweeps for it; this suite is the
 * behaviour, where a behaviour can be reached without mounting.
 *
 * ## The likeliest rejection was not even the store
 *
 * `SocialProvider` awaited `fetchFriendRequests` in the same `Promise.all` as
 * its three reads, so an OFFLINE sign-in — not a broken store, just a train
 * tunnel — rejected the batch on every mount. It answers null now and the
 * friend requests keep whatever they had, because `[]` on a failed fetch would
 * clear the inbox badge and hide requests that are still pending upstream.
 */

describe("parseChatStore", () => {
  // Imported and CALLED, which is why it lives in `chat-helpers.ts`: the
  // provider pulls React Native peers, so anything left inline there can only
  // ever be asserted about its source text — which is what left this parse
  // unexamined for as long as it was a `JSON.parse` in a hydrate.

  it("answers the empty store for nothing stored", () => {
    assert.deepEqual(parseChatStore(null), EMPTY_CHAT_STORE);
    assert.deepEqual(parseChatStore(""), EMPTY_CHAT_STORE);
  });

  it("answers the empty store for a corrupt cache instead of throwing", () => {
    // The throw used to leave `void hydrate(...)` as an unhandled rejection,
    // so a truncated write turned into a redbox rather than a fresh start.
    for (const corrupt of ["{not json", "[1,2", "null", "42", '"a string"']) {
      assert.deepEqual(parseChatStore(corrupt), EMPTY_CHAT_STORE, `must recover from: ${corrupt}`);
    }
  });

  it("fills each missing half of a partial store", () => {
    assert.deepEqual(parseChatStore(JSON.stringify({ lastReadByChat: { c1: "2026-01-01" } })), {
      messagesByChat: {},
      lastReadByChat: { c1: "2026-01-01" },
      pendingByChatId: {},
    });
  });

  it("keeps a complete store verbatim", () => {
    const stored = {
      messagesByChat: { c1: [{ id: "m1", chatId: "c1" }] },
      lastReadByChat: { c1: "2026-01-01" },
      pendingByChatId: { c1: [{ id: "m2", chatId: "c1" }] },
    };
    assert.deepEqual(parseChatStore(JSON.stringify(stored)), stored);
  });

  it("does not hand two callers the same mutable empty store to write into", () => {
    // `EMPTY_CHAT_STORE` is one frozen-by-convention object returned from four
    // paths. Nothing mutates a store in place today — every update rebuilds —
    // and this is the case that says so out loud, because the day one does, the
    // signed-out default and the corrupt-cache default become the same bug.
    const a = parseChatStore(null);
    const b = parseChatStore("{not json");
    assert.deepEqual(a, b);
    assert.deepEqual(a.messagesByChat, {}, "the shared default must still be empty");
  });
});

describe("the hydrate chains that used to end at a finally", () => {
  // Structural, because mounting these three providers needs auth, social and
  // toast scaffolding that this harness does not stand up. The SWEEP in
  // `report-storage-failure.test.ts` is what makes these regressions loud; what
  // these cases pin is the specific decision each fix made, which a sweep
  // asking "is there a catch" cannot tell apart from any other catch.

  it("SocialProvider keeps its friend requests when the fetch cannot answer", () => {
    const source = readRepoFile("lib/social-context.tsx");
    assert.match(
      source,
      /fetchFriendRequests\(activeUser\.id\)\.catch\(\(\) => null\)/,
      "a failed fetch must not read as an empty list",
    );
    assert.match(
      source,
      /if \(remoteRequests !== null\) \{[\s\S]*?setFriendRequests\(mapped\);/,
      "setFriendRequests must be gated on the fetch having answered",
    );
  });

  it("SocialProvider reads each cached blob through a reporting, CLASSIFYING helper", () => {
    // `readSocialCache` answered `string | null` at first, collapsing "nothing
    // stored" into "could not read" — and `setFollowing([])` on a failed read
    // is persisted one effect down, over the real follow list. It classifies
    // now, and the persist effects are gated on the classification.
    const source = readRepoFile("lib/social-context.tsx");
    assert.match(source, /async function readSocialBlob<T extends object>\(key: string\)/);
    assert.match(source, /reportStorageFailure\("social-context\.getItem", key, error\)/);
    assert.match(source, /setHydrationSafeToPersist\(\s*mayPersistHydration\(/);
    assert.doesNotMatch(
      source,
      /Promise\.all\(\[\s*AsyncStorage\.getItem/,
      "a bare getItem in the batch rejects the whole Promise.all, fetch included",
    );
  });

  it("I18nProvider catches before the finally rather than after the then", () => {
    // Order matters and is invisible at a glance: a `.catch` AFTER the
    // `.finally` still handles the rejection, but the `ready` flip would then
    // run before the report, and a reader has to know which of the two is the
    // handler. Catch first, then flip.
    // Through `readI18nSource` rather than by path: the translations module is
    // read by a dozen suites and exactly one of them is allowed to spell where
    // it lives, which a guard enforces.
    const source = readI18nSource();
    const catchAt = source.indexOf('reportStorageFailure("i18n-context.getItem"');
    const finallyAt = source.indexOf(".finally(", catchAt);
    assert.ok(catchAt > 0, "the hydrate read must report");
    assert.ok(finallyAt > catchAt, "the catch must come before the finally that flips ready");
  });

  it("ChatProvider reads and parses in two arms, so one cannot hide the other", () => {
    const source = readRepoFile("lib/chat-context.tsx");
    assert.match(source, /reportStorageFailure\("chat-context\.getItem", key, error\)/);
    assert.match(source, /setStore\(parseChatStore\(raw\)\)/);
  });
});
