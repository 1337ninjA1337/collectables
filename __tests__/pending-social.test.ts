import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PENDING_UPSERT_GROUP } from "@/lib/pending-upserts";
import {
  applyDeliveredSocial,
  dequeueSocialMutation,
  enqueueSocialMutation,
  flushPendingSocial,
  hasPendingSocial,
  makeSocialDeliver,
  socialMutationKey,
  type PendingSocialQueue,
  type SocialMutation,
} from "@/lib/pending-social";
import type { UserProfile } from "@/lib/types";

const ALICE = "aaaaaaaa-1111-4111-8111-111111111111";
const BOB = "bbbbbbbb-2222-4222-8222-222222222222";
const CAROL = "cccccccc-3333-4333-8333-333333333333";

const profile = (id: string, displayName: string): UserProfile => ({
  id,
  email: `${displayName}@x.test`,
  displayName,
  username: displayName.toLowerCase(),
  publicId: displayName.toLowerCase(),
  bio: "",
  avatar: "",
});

const send = (from: string, to: string): SocialMutation => ({
  kind: "send-request",
  fromUserId: from,
  toUserId: to,
});
const remove = (a: string, b: string): SocialMutation => ({
  kind: "remove-request",
  userId: a,
  otherUserId: b,
});
const upsert = (p: UserProfile): SocialMutation => ({ kind: "upsert-profile", profile: p });

const group = (q: PendingSocialQueue) => q[PENDING_UPSERT_GROUP] ?? [];

describe("socialMutationKey (BE-13d)", () => {
  it("keeps direction for send-request", () => {
    assert.equal(socialMutationKey(send(ALICE, BOB)), `send:${ALICE}:${BOB}`);
    assert.notEqual(socialMutationKey(send(ALICE, BOB)), socialMutationKey(send(BOB, ALICE)));
  });

  it("is pair-symmetric for remove-request (delete clears both directions)", () => {
    assert.equal(socialMutationKey(remove(ALICE, BOB)), socialMutationKey(remove(BOB, ALICE)));
  });

  it("keys a profile upsert by profile id", () => {
    assert.equal(socialMutationKey(upsert(profile(ALICE, "alice"))), `profile:${ALICE}`);
  });
});

describe("enqueueSocialMutation (BE-13d)", () => {
  it("adds a mutation under the single fixed group", () => {
    const q = enqueueSocialMutation({}, send(ALICE, BOB));
    assert.deepEqual(q, { [PENDING_UPSERT_GROUP]: [send(ALICE, BOB)] });
  });

  it("collapses repeated profile upserts to the latest (latest write wins)", () => {
    let q: PendingSocialQueue = {};
    q = enqueueSocialMutation(q, upsert(profile(ALICE, "alice")));
    q = enqueueSocialMutation(q, upsert(profile(ALICE, "alice2")));
    assert.equal(group(q).length, 1);
    assert.equal((group(q)[0] as { profile: UserProfile }).profile.displayName, "alice2");
  });

  it("annuls a still-pending send when a remove for the same pair is queued", () => {
    let q: PendingSocialQueue = {};
    q = enqueueSocialMutation(q, send(ALICE, BOB));
    q = enqueueSocialMutation(q, remove(ALICE, BOB));
    assert.deepEqual(group(q), [remove(ALICE, BOB)]);
  });

  it("annuls a pending remove when a send for the same pair is re-queued", () => {
    let q: PendingSocialQueue = {};
    q = enqueueSocialMutation(q, remove(BOB, ALICE));
    q = enqueueSocialMutation(q, send(ALICE, BOB));
    assert.deepEqual(group(q), [send(ALICE, BOB)]);
  });

  it("a remove cancels pending sends in BOTH directions for the pair", () => {
    let q: PendingSocialQueue = {};
    q = enqueueSocialMutation(q, send(ALICE, BOB));
    q = enqueueSocialMutation(q, send(BOB, ALICE));
    q = enqueueSocialMutation(q, remove(ALICE, BOB));
    assert.deepEqual(group(q), [remove(ALICE, BOB)]);
  });

  it("leaves friend ops on a different pair untouched", () => {
    let q: PendingSocialQueue = {};
    q = enqueueSocialMutation(q, send(ALICE, BOB));
    q = enqueueSocialMutation(q, remove(ALICE, CAROL));
    assert.equal(group(q).length, 2);
  });

  it("never mutates the input queue", () => {
    const original: PendingSocialQueue = {};
    const next = enqueueSocialMutation(original, send(ALICE, BOB));
    assert.deepEqual(original, {});
    assert.notEqual(next, original);
  });
});

describe("dequeueSocialMutation / hasPendingSocial (BE-13d)", () => {
  it("drops a delivered mutation and prunes the emptied group", () => {
    let q: PendingSocialQueue = enqueueSocialMutation({}, send(ALICE, BOB));
    assert.equal(hasPendingSocial(q), true);
    q = dequeueSocialMutation(q, send(ALICE, BOB));
    assert.equal(hasPendingSocial(q), false);
    assert.deepEqual(q, {});
  });

  it("matches a remove by unordered pair", () => {
    let q: PendingSocialQueue = enqueueSocialMutation({}, remove(ALICE, BOB));
    q = dequeueSocialMutation(q, remove(BOB, ALICE));
    assert.equal(hasPendingSocial(q), false);
  });

  it("is a no-op for an absent mutation", () => {
    const q: PendingSocialQueue = enqueueSocialMutation({}, send(ALICE, BOB));
    assert.equal(dequeueSocialMutation(q, send(ALICE, CAROL)), q);
  });
});

describe("makeSocialDeliver (BE-13d)", () => {
  it("dispatches each kind to its cloud call and returns true on success", async () => {
    const calls: string[] = [];
    const deliver = makeSocialDeliver({
      sendFriendRequest: async (f, t) => {
        calls.push(`send:${f}:${t}`);
      },
      removeFriendRequest: async (a, b) => {
        calls.push(`remove:${a}:${b}`);
      },
      upsertMyProfile: async (p) => {
        calls.push(`profile:${p.id}`);
      },
    });

    assert.equal(await deliver(send(ALICE, BOB), "k1"), true);
    assert.equal(await deliver(remove(ALICE, BOB), "k2"), true);
    assert.equal(await deliver(upsert(profile(ALICE, "alice")), "k3"), true);
    assert.deepEqual(calls, [`send:${ALICE}:${BOB}`, `remove:${ALICE}:${BOB}`, `profile:${ALICE}`]);
  });

  it("returns false (never throws) when the cloud call rejects", async () => {
    const deliver = makeSocialDeliver({
      sendFriendRequest: async () => {
        throw new Error("offline");
      },
      removeFriendRequest: async () => undefined,
      upsertMyProfile: async () => undefined,
    });
    assert.equal(await deliver(send(ALICE, BOB), "k1"), false);
  });
});

describe("flushPendingSocial / applyDeliveredSocial (BE-13d)", () => {
  it("delivers every mutation in order and empties the queue on full success", async () => {
    let q: PendingSocialQueue = {};
    q = enqueueSocialMutation(q, send(ALICE, BOB));
    q = enqueueSocialMutation(q, upsert(profile(ALICE, "alice")));

    const seen: string[] = [];
    const { sent, next } = await flushPendingSocial(q, async (m) => {
      seen.push(m.kind);
      return true;
    });

    assert.deepEqual(seen, ["send-request", "upsert-profile"]);
    assert.equal(sent.length, 2);
    assert.deepEqual(next, {});
  });

  it("stops at the first failure, leaving the rest queued in order", async () => {
    let q: PendingSocialQueue = {};
    q = enqueueSocialMutation(q, send(ALICE, BOB));
    q = enqueueSocialMutation(q, send(ALICE, CAROL));

    const { sent, next } = await flushPendingSocial(q, async (m) =>
      (m as { toUserId?: string }).toUserId !== CAROL,
    );

    assert.equal(sent.length, 1);
    assert.deepEqual(group(next), [send(ALICE, CAROL)]);
  });

  it("applyDeliveredSocial drops only the delivered subset from the current queue", async () => {
    let q: PendingSocialQueue = {};
    q = enqueueSocialMutation(q, send(ALICE, BOB));
    const { sent } = await flushPendingSocial(q, async () => true);

    // A fresh mutation parked while the flush was in flight must survive.
    const live = enqueueSocialMutation(q, send(ALICE, CAROL));
    const applied = applyDeliveredSocial(live, sent);
    assert.deepEqual(group(applied), [send(ALICE, CAROL)]);
  });
});
