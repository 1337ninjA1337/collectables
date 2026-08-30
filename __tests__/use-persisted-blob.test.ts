import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";

import { assertRequiredParameter, declaredSource, parameterList } from "./helpers/declared-shape";
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
const captured: { error: unknown; context: unknown }[] = [];
let failNextWrite = false;
let failEveryWrite = false;

mockModule("@react-native-async-storage/async-storage", {
  default: {
    setItem: async (key: string, value: string) => {
      if (failEveryWrite || failNextWrite) {
        failNextWrite = false;
        throw new Error("quota exceeded");
      }
      writes.push({ key, value });
    },
  },
});

mockModule("@/lib/sentry", {
  captureException: (error: unknown, context: unknown) => captured.push({ error, context }),
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
let resetReports: (() => void) | null = null;

/** Two independent blobs under one component, as the provider has five. */
function TwoBlobs() {
  hook!(collectionsKey, collections, enabled);
  hook!("items-user-1", items, enabled);
  return createElement("View", null);
}

async function mount() {
  const module = await import("@/lib/use-persisted-blob");
  hook ??= module.usePersistedBlob;
  // The budget lives in `report-storage-failure`, shared with the sync writes,
  // so a full device store is one fact rather than one per module that noticed.
  resetReports ??= (await import("@/lib/report-storage-failure"))
    .__resetStorageFailureReportsForTests;
  resetReports();
  return render(createElement(TwoBlobs, null));
}

function keysWritten(): string[] {
  return writes.map((write) => write.key);
}

beforeEach(() => {
  writes.length = 0;
  captured.length = 0;
  failNextWrite = false;
  failEveryWrite = false;
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

describe("a rejected write is swallowed, not silent", () => {
  it("reports the failure to Sentry with the keyspace, never the raw key", async () => {
    collectionsKey = "collectables-collections-v1-11111111-2222-4333-8444-555555555555";
    failEveryWrite = true;
    await mount();

    assert.equal(captured.length, 2, "one report per failing keyspace");
    assert.deepEqual(captured[0].context, {
      scope: "use-persisted-blob.setItem",
      extra: { keyspace: "collectables-collections-v1-{id}" },
    });
    assert.equal(
      JSON.stringify(captured).includes("11111111"),
      false,
      "the account's auth id must not reach the crash report — scrubPII does not read `extra`",
    );
  });

  it("reports each keyspace once per session, however many writes fail", async () => {
    failEveryWrite = true;
    const tree = await mount();
    assert.equal(captured.length, 2);

    // A full device store fails every write of every render. Sentry's limiter
    // would eventually cap the volume; this decides which events survive.
    items = ["i1", "i2"];
    tree.rerender();
    items = ["i1", "i2", "i3"];
    tree.rerender();

    assert.equal(captured.length, 2, "the same keyspace must not report twice");
  });

  it("reports nothing while writes succeed", async () => {
    const tree = await mount();
    items = ["i1", "i2"];
    tree.rerender();
    assert.deepEqual(captured, []);
  });
});

describe("usePersistedBlob's signature", () => {
  it("takes `enabled` as a required parameter with no default", () => {
    assertRequiredParameter({
      module: "lib/use-persisted-blob.ts",
      fn: "usePersistedBlob",
      name: "enabled",
      type: "boolean",
      at: 2,
      why: "writing before the provider has hydrated persists the empty initial state OVER the stored blob — the one catastrophic thing this hook can do, so the safe value must not be the one a caller has to remember to pass",
    });
    // `assertRequiredParameter` reads `?:`, which a DEFAULT does not use: an
    // `enabled: boolean = true` is required to the type checker and optional to
    // every caller, so the footgun would be back with the case still green.
    assert.doesNotMatch(
      parameterList(declaredSource("lib/use-persisted-blob.ts"), "usePersistedBlob") ?? "",
      /enabled\s*:\s*boolean\s*=/,
      "a default value makes the parameter optional at every call site while staying required in the type",
    );
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

  it("gates the five hooks on ready, on the hydrate, AND on which account it read", async () => {
    // Was `ready && !!user`, which is what the batched effect used and what
    // this case pinned. `ready` flips in a `finally` that runs whether the
    // hydrate learned anything or not, so those two alone enabled five writes
    // after a hydrate that had just installed the demo seed data — see
    // `stored-blob.test.ts`.
    //
    // `!!user` then went the same way: it is true on the render where the
    // account CHANGED, with the previous account's five blobs still in state,
    // so the five writes landed under the new user's keys. `hydrationMatchesKey`
    // compares the account the state was hydrated FOR with the one in hand.
    assert.match(
      CONTEXT_SOURCE.replace(/\s+/g, " "),
      /const persistEnabled = ready && hydrationSafeToPersist && hydrationMatchesKey\(hydratedUserId, user\?\.id \?\? null\);/,
    );
  });
});
