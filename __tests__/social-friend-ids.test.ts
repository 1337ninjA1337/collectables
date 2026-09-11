import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { stripComments } from "@/lib/strip-comments";

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
import { readRepoFile } from "./helpers/repo-file";

/**
 * `friendIds`, and the three other membership tests that were array scans.
 *
 * `friends` is derived from the request list and handed out as an array, and
 * every consumer that wanted to ask "is this person a friend" wrote
 * `friends.includes(id)` — the home screen inside a filter over every visible
 * collection, the provider itself inside two more, the profile screen once per
 * render. The home screen built its own `Set` to get out of that, which fixes
 * one caller and leaves the shape for the next one to rediscover.
 *
 * The Set now comes from the pass that builds the array, and `following` and
 * the admin tombstone list — the other two persisted-as-JSON arrays asked
 * membership questions per row — get the same treatment inside the provider.
 * They stay internal: nothing outside the provider scans either one.
 *
 * Mounted rather than read, because the claim is about what the context HANDS
 * OUT: that the Set and the array name the same people, and that the filters
 * that changed shape still decide the same way. The structural half at the
 * bottom is the part a mount cannot see — that no scan came back.
 */

autoUnmount();

const spy = installSpyAsyncStorage();
const { store } = spy;
let user: { id: string; email?: string } | null = { id: "user-a" };
/** What `fetchFriendRequests` answers; `null` stands for an offline mount. */
let remoteRequests: { from_user_id: string; to_user_id: string }[] | null = [];

const toasts = installSpyToast();
installStubI18n();
installSpyCapture();

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
const value = () => harness.value();

const PERSONAL_A = "collectables-social-v1-user-a";
const GRAPH = "collectables-social-graph-v1";

/** The three seeded owners, whose collections are the visibility fixture. */
const MILA = "seed-user-mila";
const LEV = "seed-user-lev";
const SOFIA = "seed-user-sofia";

/** A mutual handshake with `id` — which is what makes somebody a friend. */
const mutualWith = (id: string) => [
  { from_user_id: "user-a", to_user_id: id },
  { from_user_id: id, to_user_id: "user-a" },
];

beforeEach(async () => {
  spy.reset();
  harness.reset();
  toasts.length = 0;
  await resetStorageNotice();
  user = { id: "user-a" };
  remoteRequests = [];
});

describe("the friend list is handed out as both shapes", () => {
  it("names the same people either way", async () => {
    remoteRequests = [...mutualWith(LEV), ...mutualWith(SOFIA)];
    await mount();

    assert.deepEqual([...value().friends].sort(), [LEV, SOFIA].sort());
    assert.deepEqual([...value().friendIds].sort(), [LEV, SOFIA].sort());
  });

  it("answers membership without a scan", async () => {
    remoteRequests = mutualWith(LEV);
    await mount();

    assert.equal(typeof value().friendIds.has, "function");
    assert.equal(value().friendIds.has(LEV), true);
    assert.equal(value().friendIds.has(MILA), false);
  });

  it("is empty on a mount whose request fetch never landed", async () => {
    // Not a vacuous pass for the Set either: an offline mount must not report
    // a friendship it could not confirm.
    remoteRequests = null;
    await mount();

    assert.deepEqual(value().friends, []);
    assert.equal(value().friendIds.size, 0);
  });

  it("counts a one-sided request as nobody", async () => {
    // The whole rule the derivation exists for: a request sent is not a
    // friendship, in either shape.
    remoteRequests = [{ from_user_id: "user-a", to_user_id: LEV }];
    await mount();

    assert.deepEqual(value().friends, []);
    assert.equal(value().friendIds.has(LEV), false);
    assert.equal(value().getRelationship(LEV), "request_sent");
  });

  it("holds an id once when the handshake is listed twice", async () => {
    // `friends` is the spread of the Set now rather than a separate
    // de-duplication, so a duplicated row cannot produce a duplicated id.
    remoteRequests = [...mutualWith(LEV), ...mutualWith(LEV)];
    await mount();

    assert.deepEqual(value().friends, [LEV]);
  });
});

describe("the visibility filters read the sets", () => {
  it("shows a friend's collection", async () => {
    remoteRequests = mutualWith(LEV);
    await mount();

    const owners = value().getVisibleCollections().map((c) => c.ownerUserId);
    assert.deepEqual(owners, [LEV]);
  });

  it("shows a followed profile's collection", async () => {
    // `following` became a Set in the same filter; a followed owner who is not
    // a friend is the arm that proves it is still read.
    store.set(PERSONAL_A, JSON.stringify({ following: [MILA], myProfile: null }));
    await mount();

    const owners = value().getVisibleCollections().map((c) => c.ownerUserId);
    assert.deepEqual(owners, [MILA]);
    assert.equal(value().getRelationship(MILA), "following");
  });

  it("hides a tombstoned owner even when they are a friend", async () => {
    // The tombstone list is the third array that became a Set, and it is the
    // one that must still win over both other arms.
    store.set(GRAPH, JSON.stringify({ deletedProfileIds: [LEV] }));
    remoteRequests = mutualWith(LEV);
    await mount();

    assert.deepEqual(value().getVisibleCollections(), []);
    assert.deepEqual(value().getVisibleItems(), []);
  });

  it("shows exactly the items of the collections it shows", async () => {
    remoteRequests = mutualWith(SOFIA);
    await mount();

    const visibleIds = new Set(value().getVisibleCollections().map((c) => c.id));
    const items = value().getVisibleItems();
    assert.ok(items.length > 0, "the fixture owner has items, or this proves nothing");
    for (const item of items) {
      assert.ok(visibleIds.has(item.collectionId), `${item.id} belongs to a hidden collection`);
    }
  });

  it("shows nobody to a viewer who follows nobody and has no friends", async () => {
    await mount();

    assert.deepEqual(value().getVisibleCollections(), []);
    assert.deepEqual(value().getVisibleItems(), []);
  });

  it("hands back the same array on every call", async () => {
    // The getters used to filter on each call — and `getVisibleItems` re-ran
    // the collection filter to get the ids, so one evaluation of the
    // collections provider's memos walked the seed list twice. They read a
    // memo now, which makes the reference stable; both consumers only read it.
    remoteRequests = mutualWith(LEV);
    await mount();

    assert.equal(value().getVisibleCollections(), value().getVisibleCollections());
    assert.equal(value().getVisibleItems(), value().getVisibleItems());
  });
});

describe("the inbox excludes people who are already friends", () => {
  it("drops the incoming half of a mutual handshake", async () => {
    // `incomingRequestUserIds` filtered with `friends.includes` — friends ×
    // requests — and asks the Set now. Same answer, and this is the case that
    // says so.
    remoteRequests = [...mutualWith(LEV), { from_user_id: MILA, to_user_id: "user-a" }];
    await mount();

    assert.deepEqual(value().incomingRequestUserIds, [MILA]);
    assert.equal(value().getRelationship(MILA), "request_received");
  });
});

describe("no consumer scans an array for membership any more", () => {
  const SOCIAL = stripComments(readRepoFile("lib/social-context.tsx"));
  const PROFILE = stripComments(readRepoFile("app/profile/[id].tsx"));

  it("the provider asks sets, not arrays", () => {
    assert.doesNotMatch(SOCIAL, /friends\.includes\(/);
    assert.doesNotMatch(SOCIAL, /following\.includes\(/);
    assert.doesNotMatch(SOCIAL, /deletedProfileIds\.includes\(/);
  });

  it("the Set is built in the derivation rather than beside each caller", () => {
    // One `new Set` in the friend derivation; the array is its spread. A
    // `new Set(friends)` anywhere would be the shape this retires coming back.
    assert.match(SOCIAL, /const friends = useMemo\(\(\) => \[\.\.\.friendIds\], \[friendIds\]\);/);
    assert.doesNotMatch(SOCIAL, /new Set\(friends\)/);
  });

  it("the profile screen asks the context's Set", () => {
    assert.match(PROFILE, /const isFriend = friendIds\.has\(params\.id\);/);
    assert.doesNotMatch(PROFILE, /friends\.includes\(/);
  });
});
