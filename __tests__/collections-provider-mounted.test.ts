import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";

import { installNativeModuleStubs, mockModule, render } from "./helpers/render";

/**
 * `CollectionsProvider`, mounted — the last unmounted provider in the tree, and
 * the one where a wrong gate costs the user's own collections rather than a
 * cache the cloud can refill.
 *
 * Five blobs persist behind ONE `persistEnabled`: the collections, the items,
 * the followed-collection ids and the two offline upsert queues. Two facts
 * about that flag were bought with a data-loss bug each and covered only by a
 * source scan afterwards:
 *
 * 1. **The seed overwrite.** `ready` flips in a `finally` that runs whether or
 *    not the hydrate learned anything, and the persist effects follow `ready`.
 *    An unreadable store used to install `seedCollections`/`seedItems` and then
 *    write them over the real blobs. `hydrationSafeToPersist` is what stops it,
 *    and the case that says so has to observe a REFUSED WRITE, which only a
 *    mount can do.
 * 2. **The account switch.** On the render where `user` changes, `ready` and
 *    the gate still describe the previous account while the keys already name
 *    the new one. `hydrationMatchesKey` is what stops it, and until now this
 *    provider — the one with five keys to leak into — was covered by a sweep
 *    looking for that identifier in its source.
 *
 * Everything this provider reaches for beyond those five keys is mocked: the
 * cloud surface, the realtime subscriptions, the tombstone/cursor/import stores
 * and the currency stack. That is deliberate rather than incidental — it makes
 * the read set below exactly the five blobs the gate is about, so a case
 * asserting what was read is asserting something.
 */

installNativeModuleStubs();

const writes: { key: string; value: string }[] = [];
const reads: string[] = [];
const store = new Map<string, string>();
let readError: Error | null = null;
let user: { id: string } | null = { id: "user-a" };

mockModule("@react-native-async-storage/async-storage", {
  default: {
    getItem: async (key: string) => {
      reads.push(key);
      if (readError) throw readError;
      return store.get(key) ?? null;
    },
    setItem: async (key: string, value: string) => {
      writes.push({ key, value });
      store.set(key, value);
    },
  },
});

mockModule("@/lib/sentry", { captureException: () => undefined });

mockModule("@/lib/auth-context", { useAuth: () => ({ user }) });

mockModule("@/lib/i18n-context", {
  useI18n: () => ({ t: (key: string) => key, language: "en" }),
});

mockModule("@/lib/social-context", {
  useSocial: () => ({
    getVisibleCollections: () => [],
    getVisibleItems: () => [],
    friends: [] as string[],
  }),
});

// No cloud configured: the one-time local→cloud import effect returns early,
// which is the state a signed-in user on a device without Supabase is in.
mockModule("@/lib/supabase", { isSupabaseConfigured: false });

mockModule("@/lib/supabase-profiles", {
  upsertCollection: async () => undefined,
  updateRemoteCollection: async () => undefined,
  softDeleteRemoteCollection: async () => undefined,
  upsertItem: async () => undefined,
  updateRemoteItem: async () => undefined,
  softDeleteRemoteItem: async () => undefined,
  fetchCollectionsByUserId: async () => [],
  fetchOwnCollectionsSince: async () => [],
  fetchOwnItemsSince: async () => [],
  fetchPublicCollectionsByUserId: async () => [],
  fetchItemsByCollectionId: async () => [],
  fetchCollectionById: async () => null,
  fetchFollowedCollectionIds: async () => null,
  followCollectionRemote: async () => undefined,
  unfollowCollectionRemote: async () => undefined,
  fetchCollectionsSharedWithUser: async () => [],
  fetchWishlistItemsByUserId: async () => null,
  registerSharedCollectionViewer: async () => undefined,
  fetchProfileById: async () => null,
  updateMyProfileDisplayCurrency: async () => undefined,
});

mockModule("@/lib/supabase-realtime-sync", {
  subscribeToOwnCollections: () => ({ unsubscribe: () => undefined }),
  subscribeToOwnItems: () => ({ unsubscribe: () => undefined }),
});

// Three side stores with their own keys. Real, they would put six more reads in
// front of the five this suite is about; mocked, the read set IS the gate's.
mockModule("@/lib/tombstones", {
  applyTombstones: <T,>(rows: T[]) => rows,
  getTombstones: async () => [] as string[],
  mergeTombstoneIds: (previous: string[], next: string[]) => [...previous, ...next],
  setTombstones: async () => undefined,
});

mockModule("@/lib/sync-cursors", {
  getSyncCursor: async () => null,
  overlapCursor: (cursor: string | null) => cursor,
  setSyncCursor: async () => undefined,
});

mockModule("@/lib/cloud-import", {
  hasCloudImported: async () => true,
  markCloudImported: async () => undefined,
  selectOwnedForImport: () => ({ collections: [], items: [] }),
});

mockModule("@/lib/marketplace-transfer-log", { appendTransferLogEntry: async () => undefined });

mockModule("@/lib/currency-rates", {
  loadCurrencyRates: async () => null,
  sumConverted: () => 0,
});

mockModule("@/lib/locale-helpers", {
  getDefaultCurrencyForLanguage: () => "USD",
  getUserPreferredCurrency: async () => null,
  parseStoredCurrency: (value: string | null) => value,
  setUserPreferredCurrency: async () => undefined,
});

type CollectionsModule = typeof import("../lib/collections-context");
type ContextValue = ReturnType<CollectionsModule["useCollections"]>;

let collections: CollectionsModule | null = null;
let seen: ContextValue | null = null;

function Probe() {
  seen = collections!.useCollections();
  return createElement("View", null);
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function mount() {
  collections ??= await import("../lib/collections-context");
  (await import("../lib/report-storage-failure")).__resetStorageFailureReportsForTests();
  const tree = render(
    createElement(collections.CollectionsProvider, null, createElement(Probe)),
  );
  await drain(tree);
  return tree;
}

/** The hydrate holds several awaits; one settle is not the whole chain. */
async function drain(tree: { rerender: () => unknown }, passes = 4) {
  for (let index = 0; index < passes; index += 1) {
    await settle();
    tree.rerender();
  }
}

const COLLECTIONS_A = "collectables-collections-v1-user-a";
const ITEMS_A = "collectables-items-v1-user-a";
const FOLLOWED_A = "collectables-followed-collections-v1-user-a";
const PENDING_COLLECTIONS_A = "collectables-pending-collections-v1-user-a";
const PENDING_ITEMS_A = "collectables-pending-items-v1-user-a";
const KEYS_A = [COLLECTIONS_A, ITEMS_A, FOLLOWED_A, PENDING_COLLECTIONS_A, PENDING_ITEMS_A];
const KEYS_B = KEYS_A.map((key) => key.replace("user-a", "user-b"));

/** One collection user A owns, and the item in it. Local-first: this IS the data. */
const A_COLLECTIONS = JSON.stringify([
  {
    id: "col-a",
    ownerUserId: "user-a",
    role: "owner",
    name: "Vinyl",
    createdAt: "2026-08-01T00:00:00.000Z",
  },
]);

const A_ITEMS = JSON.stringify([
  {
    id: "11111111-1111-4111-8111-111111111111",
    collectionId: "col-a",
    title: "Kind of Blue",
    createdAt: "2026-08-01T00:00:00.000Z",
  },
]);

function writesTo(key: string) {
  return writes.filter((write) => write.key === key);
}

beforeEach(() => {
  writes.length = 0;
  reads.length = 0;
  store.clear();
  readError = null;
  user = { id: "user-a" };
  seen = null;
});

describe("CollectionsProvider — one account", () => {
  it("reads exactly the five blobs its keys name", async () => {
    const keys = await import("../lib/storage-keys");
    store.set(COLLECTIONS_A, A_COLLECTIONS);
    await mount();

    assert.deepEqual(
      [
        keys.collectionsKey("user-a"),
        keys.itemsKey("user-a"),
        keys.followedCollectionsKey("user-a"),
        keys.pendingCollectionsKey("user-a"),
        keys.pendingItemsKey("user-a"),
      ],
      KEYS_A,
      "the literals below are the real builders' output",
    );
    assert.deepEqual([...new Set(reads)].sort(), [...KEYS_A].sort());
    assert.equal(seen?.ready, true);
  });

  it("persists all five blobs once the hydrate says it may", async () => {
    store.set(COLLECTIONS_A, A_COLLECTIONS);
    store.set(ITEMS_A, A_ITEMS);
    const tree = await mount();
    await drain(tree);

    assert.deepEqual(
      [...new Set(writes.map((write) => write.key))].sort(),
      [...KEYS_A].sort(),
      "the refusal cases below are only worth something because this one writes",
    );
  });

  it("adopts the stored collection and its item", async () => {
    store.set(COLLECTIONS_A, A_COLLECTIONS);
    store.set(ITEMS_A, A_ITEMS);
    await mount();

    assert.deepEqual(
      seen?.collections.map((collection) => collection.id),
      ["col-a"],
    );
    assert.deepEqual(
      seen?.items.map((item) => item.title),
      ["Kind of Blue"],
    );
  });
});

describe("CollectionsProvider — a store that could not be read", () => {
  it("writes NOTHING, so a bad read never costs the collections on disk", async () => {
    store.set(COLLECTIONS_A, A_COLLECTIONS);
    store.set(ITEMS_A, A_ITEMS);
    readError = new Error("SecurityError: localStorage is not available");
    const tree = await mount();
    await drain(tree);

    assert.deepEqual(writes, []);
    assert.equal(store.get(COLLECTIONS_A), A_COLLECTIONS, "the real collections stay on disk");
    assert.equal(store.get(ITEMS_A), A_ITEMS, "and so do the real items");
  });

  it("never persists the demo seed data over a real account", async () => {
    readError = new Error("QuotaExceededError");
    const tree = await mount();
    await drain(tree);

    const seeded = writes.filter((write) => write.value.includes('"seed'));
    assert.deepEqual(seeded, [], "the seed rows are a first-run affordance, not a recovery plan");
    assert.deepEqual(writes, []);
  });

  it("still readies the UI, because a broken store is not a reason to block the tree", async () => {
    readError = new Error("SecurityError");
    await mount();

    assert.equal(seen?.ready, true);
  });

  it("an unparseable blob refuses the whole session's writes, not just that key", async () => {
    store.set(COLLECTIONS_A, "{ not json");
    store.set(ITEMS_A, A_ITEMS);
    const tree = await mount();
    await drain(tree);

    assert.deepEqual(
      writesTo(ITEMS_A),
      [],
      "one unreadable blob makes the whole hydrate untrustworthy",
    );
  });
});

describe("CollectionsProvider — the account changes under it", () => {
  it("writes none of user A's five blobs under user B's keys", async () => {
    store.set(COLLECTIONS_A, A_COLLECTIONS);
    store.set(ITEMS_A, A_ITEMS);
    const tree = await mount();
    writes.length = 0;

    user = { id: "user-b" };
    tree.rerender();
    await drain(tree);

    const leaked = writes.filter(
      (write) => KEYS_B.includes(write.key) && (write.value.includes("col-a") || write.value.includes("Kind of Blue")),
    );
    assert.deepEqual(leaked, [], "user B must not receive user A's collections or items");
  });

  it("hydrates the new account from its own five keys", async () => {
    store.set(COLLECTIONS_A, A_COLLECTIONS);
    const tree = await mount();
    reads.length = 0;

    user = { id: "user-b" };
    tree.rerender();
    await drain(tree);

    assert.deepEqual([...new Set(reads)].sort(), [...KEYS_B].sort());
  });

  it("signing out clears the state without writing the cleared state anywhere", async () => {
    store.set(COLLECTIONS_A, A_COLLECTIONS);
    store.set(ITEMS_A, A_ITEMS);
    const tree = await mount();
    writes.length = 0;

    user = null;
    tree.rerender();
    await drain(tree);

    assert.deepEqual(writes, []);
    assert.equal(store.get(COLLECTIONS_A), A_COLLECTIONS, "what A had is still A's");
    assert.deepEqual(seen?.collections, []);
  });
});
