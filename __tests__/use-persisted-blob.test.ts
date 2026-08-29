import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";

import { installNativeModuleStubs, mockModule, render } from "./helpers/render";
import { readRepoFile } from "./helpers/repo-file";

/**
 * `usePersistedBlob` — one AsyncStorage key per effect.
 *
 * `CollectionsProvider` persisted its five blobs from a SINGLE effect whose
 * dependency array listed all five states, so any one of them changing rewrote
 * all five: adding an item re-serialised the followed-id list and both offline
 * queues, and a cloud delta that touched only collections still rewrote the
 * items blob — the largest `JSON.stringify` in the app.
 *
 * That is also what quietly cancelled the no-op contract the two cloud merges
 * keep. They return the local array BY REFERENCE when a re-read row changed
 * nothing, precisely so the overlap-cursor re-read costs one query rather than
 * a re-render and a storage write. Under one shared effect the unchanged
 * reference bought nothing, because a sibling blob's change wrote it anyway.
 *
 * The behavioural half below mounts the real hook against a spy AsyncStorage
 * and asserts what a source scan cannot: that changing ONE value produces
 * exactly ONE write, and that an unchanged reference produces none.
 */

installNativeModuleStubs();

const writes: { key: string; value: string }[] = [];
let failNextWrite = false;

mockModule("@react-native-async-storage/async-storage", {
  default: {
    setItem: async (key: string, value: string) => {
      if (failNextWrite) {
        failNextWrite = false;
        throw new Error("quota exceeded");
      }
      writes.push({ key, value });
    },
  },
});

/** Mutable render inputs — reassigned between renders, like the provider's state. */
let collections: unknown = ["c1"];
let items: unknown = ["i1"];
let enabled = true;
let collectionsKey: string | null = "collections-user-1";

/**
 * `mockModule` only takes effect for a module that has not been evaluated yet,
 * and the runner has no top-level await, so the hook is imported lazily and
 * cached here rather than at module scope.
 */
let hook: typeof import("@/lib/use-persisted-blob").usePersistedBlob | null = null;

/** Two independent blobs under one component, as the provider has five. */
function TwoBlobs() {
  hook!(collectionsKey, collections, enabled);
  hook!("items-user-1", items, enabled);
  return createElement("View", null);
}

async function mount() {
  hook ??= (await import("@/lib/use-persisted-blob")).usePersistedBlob;
  return render(createElement(TwoBlobs, null));
}

function keysWritten(): string[] {
  return writes.map((write) => write.key);
}

beforeEach(() => {
  writes.length = 0;
  failNextWrite = false;
  collections = ["c1"];
  items = ["i1"];
  enabled = true;
  collectionsKey = "collections-user-1";
});

describe("usePersistedBlob", () => {
  it("writes every blob once on mount", async () => {
    await mount();
    assert.deepEqual(keysWritten(), ["collections-user-1", "items-user-1"]);
    assert.equal(writes[0].value, JSON.stringify(["c1"]));
  });

  it("writes ONLY the blob whose value reference changed", async () => {
    const tree = await mount();
    writes.length = 0;

    items = ["i1", "i2"];
    tree.rerender();

    assert.deepEqual(
      keysWritten(),
      ["items-user-1"],
      "a change to items must not re-serialise the collections blob",
    );
    assert.equal(writes[0].value, JSON.stringify(["i1", "i2"]));
  });

  it("writes nothing when both references are unchanged — the merges' no-op contract", async () => {
    const tree = await mount();
    writes.length = 0;

    // What `mergeItemsFromCloud` returns when the overlap re-read changed
    // nothing: the SAME array, not an equal copy.
    tree.rerender();

    assert.deepEqual(keysWritten(), []);
  });

  it("still writes for an equal-but-newly-allocated value (reference identity, not deep equality)", async () => {
    const tree = await mount();
    writes.length = 0;

    items = ["i1"];
    tree.rerender();

    assert.deepEqual(
      keysWritten(),
      ["items-user-1"],
      "the contract is reference identity — this is why callers must not pass an inline literal",
    );
  });

  it("writes nothing at all while disabled, then writes both when it flips on", async () => {
    enabled = false;
    const tree = await mount();
    assert.deepEqual(keysWritten(), [], "no write before the provider is hydrated");

    enabled = true;
    tree.rerender();
    assert.deepEqual(keysWritten(), ["collections-user-1", "items-user-1"]);
  });

  it("writes nothing for a null key, and writes on the key change when one arrives", async () => {
    collectionsKey = null;
    const tree = await mount();
    assert.deepEqual(keysWritten(), ["items-user-1"], "no user id yet — no collections key");

    writes.length = 0;
    collectionsKey = "collections-user-2";
    tree.rerender();
    assert.deepEqual(
      keysWritten(),
      ["collections-user-2"],
      "a key change alone must re-persist that blob for the new user",
    );
  });

  it("swallows a rejected write instead of surfacing an unhandled rejection", async () => {
    failNextWrite = true;
    await assert.doesNotReject(() => mount());
    assert.deepEqual(keysWritten(), ["items-user-1"], "the sibling blob still persists");
  });
});

// --- Adoption: the provider must not go back to one effect for five keys ---

const CONTEXT_SOURCE = readRepoFile("lib", "collections-context.tsx");

describe("collections-context.tsx persists one blob per effect", () => {
  it("routes all five blobs through usePersistedBlob", async () => {
    assert.match(CONTEXT_SOURCE, /import \{ usePersistedBlob \} from "@\/lib\/use-persisted-blob"/);
    for (const key of [
      "collectionsKey",
      "itemsKey",
      "followedCollectionsKey",
      "pendingCollectionsKey",
      "pendingItemsKey",
    ]) {
      assert.match(
        CONTEXT_SOURCE,
        new RegExp(`usePersistedBlob\\(\\s*\\n?\\s*user \\? ${key}\\(user\\.id\\) : null`),
        `${key} must be persisted through its own usePersistedBlob call`,
      );
    }
    assert.equal(
      CONTEXT_SOURCE.match(/usePersistedBlob\(/g)?.length,
      5,
      "exactly five blobs, exactly five effects",
    );
  });

  it("no longer batches AsyncStorage.setItem calls behind one Promise.all", async () => {
    assert.doesNotMatch(
      CONTEXT_SOURCE,
      /Promise\.all\(\[\s*\n\s*AsyncStorage\.setItem/,
      "a batched persist effect rewrites every blob when any one of them changes",
    );
  });

  it("gates the five hooks on the same ready && user the batched effect used", async () => {
    assert.match(CONTEXT_SOURCE, /const persistEnabled = ready && !!user;/);
  });
});
