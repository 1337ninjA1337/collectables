import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { selectFriendCollections } from "@/lib/home-helpers";
import { stripComments } from "@/lib/strip-comments";
import { Collection } from "@/lib/types";

import { readRepoFile } from "./helpers/repo-file";

/**
 * One rule for "Friends' collections", on the one screen that carries the label.
 *
 * `app/index.tsx` filtered the merged `collections`; `app/collections-feed.tsx`
 * rendered the context's `friendCollections`, which holds only what
 * `fetchPublicCollectionsByUserId` returned for each friend. So the feed's tab
 * was a strict SUBSET of the home screen's: no seeded friend collections, no
 * collection shared directly with the viewer, and nothing at all until the
 * fetch landed. Two screens a user moves between, one label, two answers, and
 * nothing anywhere saying which was meant.
 *
 * The feed screen was retired on 2026-09-11 — nothing in the app could open it
 * — so the label has one screen again, and the rule it was extracted for is
 * the rule that screen reads. The extraction still earns its place: the answer
 * is a unit-testable function rather than a filter chain inlined in JSX, which
 * is what the cases below are about. See `collections-feed-retired.test.ts`
 * for what stops a second copy of the screen coming back.
 */

const collection = (over: Partial<Collection>): Collection => ({
  id: "c1",
  name: "A collection",
  coverPhoto: "",
  description: "",
  ownerName: "Somebody",
  ownerUserId: "u-owner",
  sharedWith: [],
  sharedWithUserIds: [],
  role: "viewer",
  visibility: "public",
  ...over,
});

const EMPTY = new Set<string>();

describe("selectFriendCollections", () => {
  it("takes a viewer copy owned by a friend", () => {
    const mine = collection({ id: "c-friend", ownerUserId: "u-friend" });
    assert.deepEqual(
      selectFriendCollections([mine], new Set(["u-friend"]), []),
      [mine],
    );
  });

  it("leaves a stranger's collection out", () => {
    const theirs = collection({ id: "c-stranger", ownerUserId: "u-stranger" });
    assert.deepEqual(selectFriendCollections([theirs], new Set(["u-friend"]), []), []);
  });

  it("leaves the viewer's OWN collections out", () => {
    // `role` is what separates a copy of somebody else's collection from one
    // the viewer owns — a friendship with themselves is not the only way this
    // could go wrong, but it is the one the role check catches unconditionally.
    const own = collection({ id: "c-own", ownerUserId: "u-friend", role: "owner" });
    assert.deepEqual(selectFriendCollections([own], new Set(["u-friend"]), []), []);
  });

  it("takes a collection shared directly with the viewer, whoever shared it", () => {
    // The arm the header calls deliberate and not obviously right: a stranger's
    // share appears under a label that says "friends". It is here because no
    // screen renders `sharedWithMeCollections` on its own, so dropping the arm
    // would hide those collections rather than move them.
    const shared = collection({ id: "c-shared", ownerUserId: "u-stranger" });
    assert.deepEqual(selectFriendCollections([shared], EMPTY, [shared]), [shared]);
  });

  it("matches a share by collection id, not by owner", () => {
    // `sharedWithMeCollections` is a list of collections, and the share is a
    // fact about the COLLECTION: the same owner's other collections are not
    // shared just because one of them is.
    const shared = collection({ id: "c-shared", ownerUserId: "u-stranger" });
    const other = collection({ id: "c-other", ownerUserId: "u-stranger" });
    assert.deepEqual(selectFriendCollections([shared, other], EMPTY, [shared]), [shared]);
  });

  it("lists a collection that is both a friend's and a share exactly once", () => {
    const both = collection({ id: "c-both", ownerUserId: "u-friend" });
    assert.deepEqual(
      selectFriendCollections([both], new Set(["u-friend"]), [both]),
      [both],
    );
  });

  it("keeps the merged list's order", () => {
    // The merged `collections` is sorted by the owner's drag order and then by
    // source; re-ordering here would make the two tabs disagree about
    // sequence even once they agree about contents.
    const a = collection({ id: "c-a", ownerUserId: "u-friend" });
    const b = collection({ id: "c-b", ownerUserId: "u-friend" });
    assert.deepEqual(
      selectFriendCollections([b, a], new Set(["u-friend"]), []).map((c) => c.id),
      ["c-b", "c-a"],
    );
  });

  it("answers with nothing when the viewer has no friends and no shares", () => {
    const theirs = collection({ ownerUserId: "u-stranger" });
    assert.deepEqual(selectFriendCollections([theirs], EMPTY, []), []);
  });

  it("does not mutate the list it is given", () => {
    const input = [collection({ id: "c-1", ownerUserId: "u-friend" })];
    const before = [...input];
    selectFriendCollections(input, new Set(["u-friend"]), []);
    assert.deepEqual(input, before);
  });
});

describe("the screen that says \"friends' collections\" reads the rule", () => {
  const HOME = stripComments(readRepoFile("app/index.tsx"));

  it("the home screen calls the selector rather than filtering inline", () => {
    assert.match(HOME, /selectFriendCollections\(collections, friendIds, sharedWithMeCollections\)/);
    assert.doesNotMatch(HOME, /collection\.role === "viewer" &&/);
  });

  it("the home screen does not render the context's fetch result instead", () => {
    // `friendCollections` on the context is what the cloud returned for each
    // friend. It is still the right thing for the MERGE to consume; it was the
    // wrong thing for a tab to render, because it can only ever be one of the
    // three sources the merged list holds. The retired feed screen is where
    // that went wrong, and this is the assertion that kept the home screen
    // from being rewritten into it.
    assert.doesNotMatch(HOME, /\{[^}]*\bfriendCollections\b[^}]*\} = useCollections\(\)/);
  });
});
