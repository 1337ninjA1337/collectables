import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  isArchived,
  isLiveItem,
  isLiveWishlistItem,
} from "@/lib/collections-helpers";
import { stripComments } from "@/lib/strip-comments";
import { CollectableItem } from "@/lib/types";

import { readRepoFile } from "./helpers/repo-file";

/**
 * "Does the collector have this?", asked once.
 *
 * Four places decided it and no two wrote it the same way: a three-clause
 * filter in `selectOwnedActiveItems`, its De Morgan negation as a `continue`
 * guard in `groupItemsByCollection` forty lines below, and two early returns
 * in the search overlay. They agreed — checking that they agreed meant
 * negating one of them in your head, which is the state a fifth copy gets
 * added in.
 *
 * The fifth already existed and was wrong. The provider's `wishlistItems` memo
 * asked `item.isWishlist` and nothing else, so an ARCHIVED wishlist entry was
 * in the trash on every screen in the app except the one it was added on. The
 * pair below is what makes that hard to write again: `isLiveItem` and
 * `isLiveWishlistItem` split on the wishlist flag and share the "not archived"
 * half, so neither side can drop it alone.
 */

const item = (over: Partial<CollectableItem> = {}): CollectableItem => ({
  id: "i-1",
  collectionId: "c-1",
  title: "An item",
  acquiredAt: "",
  acquiredFrom: "",
  description: "",
  variants: "",
  photos: [],
  createdBy: "u-1",
  createdByUserId: "u-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("isArchived", () => {
  it("is true for a stamped timestamp", () => {
    assert.equal(isArchived(item({ archivedAt: "2026-02-02T00:00:00.000Z" })), true);
  });

  it("is false for a null or absent one", () => {
    // The column is nullable and legacy rows carry `null` rather than being
    // absent, so this asks the timestamp's truthiness, not whether the key is
    // there.
    assert.equal(isArchived(item({ archivedAt: null })), false);
    assert.equal(isArchived(item()), false);
  });

  it("returns a boolean rather than the timestamp", () => {
    // A predicate that returns a string is a predicate somebody will one day
    // compare with `===` and get a surprise from.
    assert.equal(isArchived(item({ archivedAt: "2026-02-02T00:00:00.000Z" })), true);
    assert.equal(typeof isArchived(item()), "boolean");
  });
});

describe("isLiveItem", () => {
  it("is true for something the collector holds", () => {
    assert.equal(isLiveItem(item()), true);
  });

  it("is false for a wishlist entry", () => {
    // A want is not a holding: counting one inflates a total and reads as an
    // acquisition that never happened.
    assert.equal(isLiveItem(item({ isWishlist: true })), false);
  });

  it("is false for an archived item", () => {
    assert.equal(isLiveItem(item({ archivedAt: "2026-02-02T00:00:00.000Z" })), false);
  });

  it("is false for an archived wishlist entry", () => {
    assert.equal(
      isLiveItem(item({ isWishlist: true, archivedAt: "2026-02-02T00:00:00.000Z" })),
      false,
    );
  });
});

describe("isLiveWishlistItem", () => {
  it("is true for a want", () => {
    assert.equal(isLiveWishlistItem(item({ isWishlist: true })), true);
  });

  it("is false for something the collector already holds", () => {
    assert.equal(isLiveWishlistItem(item()), false);
  });

  it("is false for an ARCHIVED want", () => {
    // The bug this pair was written for. The wishlist memo asked only
    // `isWishlist`, so this row rendered on the wishlist screen while being in
    // the trash everywhere else.
    assert.equal(
      isLiveWishlistItem(item({ isWishlist: true, archivedAt: "2026-02-02T00:00:00.000Z" })),
      false,
    );
  });

  it("is the exact complement of isLiveItem among un-archived items", () => {
    // The two are one split, not two overlapping rules: every live row is
    // either a holding or a want, and no row is both.
    const held = item();
    const wanted = item({ isWishlist: true });

    assert.equal(isLiveItem(held) !== isLiveWishlistItem(held), true);
    assert.equal(isLiveItem(wanted) !== isLiveWishlistItem(wanted), true);
  });

  it("leaves an archived row outside both halves", () => {
    const trashed = item({ archivedAt: "2026-02-02T00:00:00.000Z" });

    assert.equal(isLiveItem(trashed), false);
    assert.equal(isLiveWishlistItem(trashed), false);
  });
});

describe("every list that drops archived rows reads the predicate", () => {
  const HELPERS = stripComments(readRepoFile("lib/collections-helpers.ts"));
  const CONTEXT = stripComments(readRepoFile("lib/collections-context.tsx"));
  const SEARCH = stripComments(readRepoFile("components/search-overlay.tsx"));

  it("the owned-items selector states only its own clause", () => {
    assert.match(
      HELPERS,
      /\(item\) => isLiveItem\(item\) && ownedIds\.has\(item\.collectionId\)/,
    );
  });

  it("the per-collection index guards on the same function", () => {
    assert.match(HELPERS, /if \(!isLiveItem\(item\)\) continue;/);
  });

  it("the wishlist memo asks for a live want, not just a flag", () => {
    assert.match(CONTEXT, /localItems\.filter\(isLiveWishlistItem\)/);
    assert.doesNotMatch(CONTEXT, /\.filter\(\(item\) => item\.isWishlist\)/);
  });

  it("search drops both halves through the one predicate", () => {
    assert.match(SEARCH, /if \(!isLiveItem\(item\)\) return false;/);
    assert.doesNotMatch(SEARCH, /if \(item\.archivedAt\) return false;/);
  });

  it("no caller spells the rule out any more", () => {
    // Both directions of the same claim, because the four copies were written
    // in both: the positive filter and its De Morgan negation.
    for (const [name, src] of [
      ["lib/collections-helpers.ts", HELPERS],
      ["lib/collections-context.tsx", CONTEXT],
      ["components/search-overlay.tsx", SEARCH],
    ] as const) {
      assert.doesNotMatch(
        src,
        /!item\.isWishlist && !item\.archivedAt/,
        `${name} still writes the live-item rule out`,
      );
      assert.doesNotMatch(
        src,
        /item\.isWishlist \|\| item\.archivedAt/,
        `${name} still writes the live-item rule out, negated`,
      );
    }
  });
});
