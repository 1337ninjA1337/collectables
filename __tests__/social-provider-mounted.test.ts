import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";

import { mockModule } from "./helpers/render";
import {
  drain,
  installSpyAsyncStorage,
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

const spy = installSpyAsyncStorage();
const { reads, writes, store } = spy;
let user: { id: string; email?: string } | null = { id: "user-a" };
/** What `fetchFriendRequests` answers; `null` stands for an offline mount. */
let remoteRequests: { from_user_id: string; to_user_id: string }[] | null = [];

const toasts = installSpyToast();
installStubI18n();

mockModule("@/lib/sentry", { captureException: () => undefined });

mockModule("@/lib/analytics", { trackEvent: () => undefined });

mockModule("@/lib/auth-context", { useAuth: () => ({ user }) });

mockModule("@/lib/supabase-profiles", {
  fetchFriendRequests: async () => {
    if (remoteRequests === null) throw new Error("offline");
    return remoteRequests;
  },
  fetchProfileById: async () => null,
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
