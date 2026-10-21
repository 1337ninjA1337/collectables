import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { autoUnmount, mockModule } from "./helpers/render";
import {
  drain,
  installSpyAsyncStorage,
  installSpyCapture,
  installSpyToast,
  installStubI18n,
  providerHarness,
  resetStorageNotice,
} from "./helpers/mount-provider";

/**
 * `SocialProvider`, mounted — the fifth provider to be run rather than read,
 * and the one with THREE persist effects behind one gate.
 *
 * Two of them are account-keyed (`collectables-social-v1-{id}`, the follow list
 * and the profile override; `collectables-pending-social-v1-{id}`, the offline
 * mutation queue) and were covered only by a sweep looking for the name
 * `hydrationMatchesKey` in the source — which is the shape that missed the
 * cross-account leak in the first place. The third writes ONE DEVICE-GLOBAL
 * key, so the leak fix does not apply to it and nothing had ever asked what it
 * puts there. It put one account's pending friend-request pairs under a key the
 * next account reads; that field is gone now and a case below says so.
 *
 * Eight modules stand between this provider and a mount — the session, the
 * toast host, i18n, the Supabase profile surface, the realtime subscription,
 * analytics, Sentry and the store. All eight are `mockModule` calls, and none
 * of them is a dev-dep.
 */

// Ends every tree a case rendered, including the cases that fail early.
autoUnmount();

const spy = installSpyAsyncStorage();
const { reads, writes, store } = spy;
let user: { id: string; email?: string } | null = { id: "user-a" };
/** What `fetchFriendRequests` answers; `null` stands for an offline mount. */
let remoteRequests: { from_user_id: string; to_user_id: string }[] | null = [];

const toasts = installSpyToast();
installStubI18n();

installSpyCapture();

mockModule("@/lib/analytics", { trackEvent: () => undefined });

mockModule("@/lib/auth-context", { useAuth: () => ({ user }) });

/** Every id `fetchProfileById` was actually asked for, in order. */
const fetchedProfileIds: string[] = [];

/** A row the table would answer with, for the ids a case says it holds. */
const remoteProfileRow = (id: string) => ({
  id,
  email: `${id}@example.com`,
  displayName: id.toUpperCase(),
  username: id,
  publicId: `${id}-public`,
  bio: "",
  avatar: "",
});

/** Which ids the table answers for; everything else reads as absent. */
let remoteProfileIds: string[] = [];

mockModule("@/lib/supabase-profiles", {
  fetchFriendRequests: async () => {
    if (remoteRequests === null) throw new Error("offline");
    return remoteRequests;
  },
  fetchProfileById: async (id: string) => {
    fetchedProfileIds.push(id);
    return remoteProfileIds.includes(id) ? remoteProfileRow(id) : null;
  },
  sendFriendRequest: async () => true,
  cloudAcceptFriendRequest: async () => true,
  removeFriendRequest: async () => true,
  upsertMyProfile: async () => true,
});

mockModule("@/lib/supabase-realtime-sync", {
  subscribeToFriendRequests: () => ({ unsubscribe: () => undefined }),
});

type SocialModule = typeof import("../lib/social-context");
type ContextValue = ReturnType<SocialModule["useSocial"]>;

const harness = providerHarness<ContextValue>(async () => {
  const social: SocialModule = await import("../lib/social-context");
  return { Provider: social.SocialProvider, useValue: social.useSocial };
});

const mount = () => harness.mount();
const seen = () => harness.seen;

const PERSONAL_A = "collectables-social-v1-user-a";
const PERSONAL_B = "collectables-social-v1-user-b";
const PENDING_A = "collectables-pending-social-v1-user-a";
const PENDING_B = "collectables-pending-social-v1-user-b";
const GRAPH = "collectables-social-graph-v1";

/** User A follows one seeded profile. Local-only: nothing upstream holds it. */
const A_PERSONAL = JSON.stringify({ following: ["u2"], myProfile: null });

/** One friend request A sent while offline, parked for the next reconnect. */
const A_PENDING = JSON.stringify({
  "friend-request:user-a:u2": {
    id: "friend-request:user-a:u2",
    mutation: { kind: "friend-request", fromUserId: "user-a", toUserId: "u2" },
    attempts: 1,
  },
});

function writesTo(key: string) {
  return writes.filter((write) => write.key === key);
}

beforeEach(async () => {
  spy.reset();
  harness.reset();
  toasts.length = 0;
  await resetStorageNotice();
  user = { id: "user-a" };
  remoteRequests = [];
  remoteProfileIds = [];
  fetchedProfileIds.length = 0;
});

describe("SocialProvider — one account", () => {
  it("reads exactly the three blobs its keys name", async () => {
    const { SOCIAL_GRAPH_KEY, pendingSocialKey, socialCacheKey } = await import(
      "../lib/storage-keys"
    );
    store.set(PERSONAL_A, A_PERSONAL);
    await mount();

    assert.equal(socialCacheKey("user-a"), PERSONAL_A);
    assert.equal(pendingSocialKey("user-a"), PENDING_A);
    assert.equal(SOCIAL_GRAPH_KEY, GRAPH);
    assert.deepEqual([...reads].sort(), [GRAPH, PENDING_A, PERSONAL_A].sort());
    assert.equal(seen()?.ready, true);
  });

  it("adopts the stored follow list", async () => {
    store.set(PERSONAL_A, A_PERSONAL);
    await mount();

    assert.deepEqual(seen()?.following, ["u2"]);
  });

  it("a failed read writes nothing, because the offline queue is not re-fetchable", async () => {
    store.set(PERSONAL_A, A_PERSONAL);
    store.set(PENDING_A, A_PENDING);
    spy.readError = new Error("SecurityError: localStorage is not available");
    const tree = await mount();
    await drain(tree);

    assert.deepEqual(writes, []);
    assert.equal(store.get(PENDING_A), A_PENDING, "the parked mutation stays on disk");
    assert.equal(store.get(PERSONAL_A), A_PERSONAL, "and so does the follow list");
  });

  it("a failed read still readies the UI", async () => {
    spy.readError = new Error("QuotaExceededError");
    await mount();

    assert.equal(seen()?.ready, true, "a broken store is not a reason to block the tree");
  });

  it("an offline friend-request fetch leaves the inbox empty rather than wrong", async () => {
    remoteRequests = null;
    await mount();

    assert.deepEqual(seen()?.incomingRequestUserIds, []);
    assert.deepEqual(seen()?.friends, []);
  });
});

describe("SocialProvider — the device-global graph key", () => {
  it("persists the admin tombstone list and nothing else", async () => {
    const tree = await mount();
    await drain(tree);

    const graph = writesTo(GRAPH);
    assert.ok(graph.length > 0, "the graph blob is written once the hydrate says it may");
    assert.deepEqual(JSON.parse(graph[graph.length - 1].value), { deletedProfileIds: [] });
  });

  it("never writes a friend-request pair under a key every account on the device reads", async () => {
    remoteRequests = [
      { from_user_id: "u2", to_user_id: "user-a" },
      { from_user_id: "user-a", to_user_id: "u2" },
    ];
    const tree = await mount();
    await drain(tree);

    assert.deepEqual(seen()?.friends, ["u2"], "the handshake IS mutual, so this is not a vacuous pass");
    for (const write of writesTo(GRAPH)) {
      assert.ok(
        !write.value.includes("u2"),
        `the global graph blob leaked a friend-request pair: ${write.value}`,
      );
    }
  });

  it("reads its tombstones back out of the blob it wrote", async () => {
    store.set(GRAPH, JSON.stringify({ deletedProfileIds: ["u3"] }));
    await mount();

    assert.ok(
      !seen()?.profiles.some((profile) => profile.id === "u3"),
      "a tombstoned profile stays hidden across a relaunch",
    );
  });

  it("still parses a legacy blob that carries the dropped field", async () => {
    store.set(
      GRAPH,
      JSON.stringify({
        deletedProfileIds: ["u3"],
        friendRequests: [{ fromUserId: "u2", toUserId: "user-a" }],
      }),
    );
    await mount();

    assert.ok(!seen()?.profiles.some((profile) => profile.id === "u3"));
    assert.deepEqual(seen()?.incomingRequestUserIds, [], "the stale local copy is not an inbox");
  });
});

describe("SocialProvider — the tombstone every reader has to pass", () => {
  /**
   * The set is private and three readers used it inline, which read as
   * complete because nothing outside could ask. It was not: `app/people.tsx`
   * and `components/search-overlay.tsx` list rows straight out of
   * `fetchProfiles`/`searchProfiles`, so a deleted profile was gone from
   * `profiles` and still in the people browser, still findable by search, and
   * one tap from a full profile screen — because `getProfileById` fell through
   * to the viewer cache, which `fetchProfileById` fills and which knows
   * nothing about an admin deletion.
   */
  it("answers the question the direct readers of the table actually have", async () => {
    store.set(GRAPH, JSON.stringify({ deletedProfileIds: ["u3"] }));
    await mount();

    assert.equal(seen()?.isProfileDeleted("u3"), true);
    assert.equal(seen()?.isProfileDeleted("u2"), false, "the gate is a tombstone, not a blanket");
  });

  it("does not answer by id with a row the viewer cache happens to hold", async () => {
    // The resurrection: `deleteProfile` evicts the cache entry, and the next
    // `ensureProfilesLoaded` for that id put it straight back.
    store.set(GRAPH, JSON.stringify({ deletedProfileIds: ["u3"] }));
    const tree = await mount();
    remoteProfileIds = ["u3"];

    await seen()?.ensureProfilesLoaded(["u3"]);
    await drain(tree);

    assert.deepEqual(fetchedProfileIds, [], "a tombstoned id is not missing, it is gone");
    assert.equal(seen()?.getProfileById("u3"), undefined);
  });

  it("still loads and answers for a profile nobody deleted", async () => {
    // The control. A gate that answered `undefined` for everything would pass
    // every case above and blank the profile screen.
    store.set(GRAPH, JSON.stringify({ deletedProfileIds: ["u3"] }));
    const tree = await mount();
    remoteProfileIds = ["u9"];

    await seen()?.ensureProfilesLoaded(["u9"]);
    await drain(tree);

    assert.deepEqual(fetchedProfileIds, ["u9"]);
    assert.equal(seen()?.getProfileById("u9")?.username, "u9");
  });

  it("counts a tombstoned profile in no relationship, however the cloud answers", async () => {
    // `deleteProfile` drops the pairs it can see from `friendRequests`, and the
    // next `fetchFriendRequests` brings them back: the cloud knows nothing
    // about a device-local deletion. So the deleted profile was a friend
    // again — counted on the home screen, counted in the friends tab's "(2)",
    // offered as a share target — with no card in the list under it, because
    // `getProfileById` stopped answering for it and nothing else had.
    store.set(GRAPH, JSON.stringify({ deletedProfileIds: ["u3"] }));
    remoteRequests = [
      { from_user_id: "u3", to_user_id: "user-a" },
      { from_user_id: "user-a", to_user_id: "u3" },
      { from_user_id: "u2", to_user_id: "user-a" },
    ];
    const tree = await mount();
    await drain(tree);

    assert.deepEqual(seen()?.friends, [], "a mutual pair with a deleted profile is not a friendship");
    assert.equal(seen()?.friendIds.has("u3"), false);
    assert.deepEqual(
      seen()?.incomingRequestUserIds,
      ["u2"],
      "the deleted profile's request is not an inbox entry, and the live one still is",
    );
    assert.equal(seen()?.getRelationship("u3"), "none");
  });

  it("leaves a tombstoned id out of the follow list the UI counts", async () => {
    // The stored list keeps it — the tombstone is device-global and the follow
    // list is per account, so un-deleting should restore the follow rather
    // than require it again. What must not survive is the id reaching
    // `app/index.tsx`' `following.length`, which renders beside the list it is
    // supposed to count.
    store.set(GRAPH, JSON.stringify({ deletedProfileIds: ["u2"] }));
    store.set(PERSONAL_A, JSON.stringify({ following: ["u2", "u3"], myProfile: null }));
    const tree = await mount();
    await drain(tree);

    assert.deepEqual(seen()?.following, ["u3"]);
    const personal = writesTo(PERSONAL_A);
    assert.deepEqual(
      JSON.parse(personal[personal.length - 1].value).following,
      ["u2", "u3"],
      "the stored follow list must keep the id, so un-deleting restores the follow",
    );
  });

  it("keeps a tombstoned owner's social collections invisible", async () => {
    // The third inline reader, unchanged in behaviour and now going through
    // the same question as the other two.
    store.set(GRAPH, JSON.stringify({ deletedProfileIds: ["u2"] }));
    store.set(PERSONAL_A, A_PERSONAL);
    await mount();

    assert.deepEqual(
      seen()?.getVisibleCollections().filter((collection) => collection.ownerUserId === "u2"),
      [],
      "following a profile an admin deleted still opened their collections",
    );
  });
});

describe("SocialProvider — the account changes under it", () => {
  it("does not write user A's follow list under user B's key", async () => {
    store.set(PERSONAL_A, A_PERSONAL);
    const tree = await mount();
    writes.length = 0;

    user = { id: "user-b" };
    tree.rerender();
    await drain(tree);

    const leaked = writesTo(PERSONAL_B).filter((write) => write.value.includes("u2"));
    assert.deepEqual(leaked, [], "user B must not receive user A's follow list");
  });

  it("does not write user A's parked mutations under user B's key", async () => {
    store.set(PENDING_A, A_PENDING);
    const tree = await mount();
    writes.length = 0;

    user = { id: "user-b" };
    tree.rerender();
    await drain(tree);

    const leaked = writesTo(PENDING_B).filter((write) => write.value.includes("user-a"));
    assert.deepEqual(leaked, [], "user B must not inherit user A's outgoing friend request");
  });

  it("hydrates the new account from its own keys", async () => {
    store.set(PERSONAL_A, A_PERSONAL);
    const tree = await mount();
    reads.length = 0;

    user = { id: "user-b" };
    tree.rerender();
    await drain(tree);

    assert.deepEqual([...new Set(reads)].sort(), [GRAPH, PENDING_B, PERSONAL_B].sort());
  });

  it("signing out empties the state without writing it anywhere", async () => {
    store.set(PERSONAL_A, A_PERSONAL);
    const tree = await mount();
    writes.length = 0;

    user = null;
    tree.rerender();
    await drain(tree);

    assert.deepEqual(writes, []);
    assert.equal(store.get(PERSONAL_A), A_PERSONAL, "what A had is still A's");
    assert.deepEqual(seen()?.following, []);
  });
});
