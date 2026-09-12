import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isLiveItem } from "@/lib/collections-helpers";
import { openListingsForItems } from "@/lib/marketplace-helpers";
import { stripComments } from "@/lib/strip-comments";
import type { CollectableItem, MarketplaceListing } from "@/lib/types";

import { readI18nSource } from "./helpers/i18n-source-file";
import { assertDeclaredInEveryLocale, localeValuesOf } from "./helpers/i18n-locales";
import { readRepoFile } from "./helpers/repo-file";

/**
 * Deleting a collection: the outcome nobody was told, and the listings nobody
 * counted.
 *
 * TWO THINGS, and they are the same function. `confirmAndDeleteCollection`
 * removed every open listing, deleted the collection and its items, and
 * navigated away in silence — the last resolution in the family with no
 * outcome toast, at the largest scale any of them runs at.
 *
 * And the list it removed was short. `collectionOpenListings` was built from
 * `allItems`, which is `getItemsForCollection` — live-item filtered. The
 * delete does not ask whether a row is live: it removes every item carrying
 * the collection's id, archived and wishlist rows included. Nothing stops a
 * wishlist item being listed (the item screen's marketplace block gates on
 * archived and never on `isWishlist`), so a collection holding a listed want
 * warned about one listing too few and left that standing offer up after the
 * item behind it was gone — the same class of bug the departure-path record
 * was built to catch, one filter further down.
 */

const item = (over: Partial<CollectableItem>): CollectableItem =>
  ({
    id: "i-1",
    collectionId: "c-1",
    title: "",
    description: "",
    acquiredFrom: "",
    photos: [],
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  }) as CollectableItem;

const listing = (over: Partial<MarketplaceListing>): MarketplaceListing =>
  ({
    id: "l-1",
    itemId: "i-1",
    ownerUserId: "u-1",
    mode: "sell",
    askingPrice: 1,
    currency: "USD",
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  }) as MarketplaceListing;

describe("the filter that was losing a listing", () => {
  it("a wishlist row is not a live item, and the delete takes it anyway", () => {
    // The premise in one line: two different questions were being asked by one
    // array. `isLiveItem` decides what the screen RENDERS; the delete removes
    // by `collectionId`.
    assert.equal(isLiveItem(item({ id: "want", isWishlist: true })), false);
    assert.equal(isLiveItem(item({ id: "gone", archivedAt: "2026-02-01T00:00:00.000Z" })), false);
  });

  it("the live-filtered ids miss a listed want, and the unfiltered ids do not", () => {
    const all = [
      item({ id: "have" }),
      item({ id: "want", isWishlist: true }),
    ];
    const listings = [listing({ id: "l-have", itemId: "have" }), listing({ id: "l-want", itemId: "want" })];

    const live = openListingsForItems(listings, all.filter(isLiveItem).map((i) => i.id));
    const every = openListingsForItems(listings, all.map((i) => i.id));

    assert.deepEqual(live.map((l) => l.id), ["l-have"]);
    assert.deepEqual(every.map((l) => l.id), ["l-have", "l-want"]);
  });
});

describe("the collection screen's delete", () => {
  const SRC = stripComments(readRepoFile("app/collection/[id].tsx"));
  const commit = SRC.slice(
    SRC.indexOf("const confirmAndDeleteCollection"),
    SRC.indexOf("const handleDeleteCollection"),
  );

  it("parsed the committing callback (guards the assertions below)", () => {
    assert.ok(commit.length > 0);
  });

  it("counts listings over every item in the collection, not the live ones", () => {
    assert.match(
      SRC,
      /unfilteredItems\.filter\(\(item\) => item\.collectionId === params\.id\)\.map\(\(item\) => item\.id\)/,
    );
    assert.doesNotMatch(
      SRC,
      /openListingsForItems\(myListings, allItems\.map/,
      "the live-filtered list is back, and it cannot see a listed want",
    );
  });

  it("takes the provider's unfiltered list under a name that says so", () => {
    // The screen's own `items` is the sorted, filtered render list, so the
    // provider's has to be aliased — and an alias that did not say which is
    // which is how the two get swapped back.
    assert.match(SRC, /items: unfilteredItems,/);
  });

  it("says the collection went", () => {
    assert.match(commit, /composeOutcome\(\s*t\("collectionDeleted"\),/);
  });

  it("adds the listing clause only when there were listings to lose", () => {
    assert.match(commit, /collectionOpenListings\.length > 0/);
    assert.match(commit, /t\("bulkListingsRemoved", \{ count: collectionOpenListings\.length \}\)/);
    assert.match(commit, /:\s*null,/);
  });

  it("composes rather than joining by hand", () => {
    assert.match(SRC, /import \{ composeOutcome \} from "@\/lib\/outcome-message";/);
    assert.ok(!commit.includes(" · "), "the delete path punctuates by hand");
  });

  it("reads the outcome before the removals", () => {
    const composed = commit.indexOf("const outcome = composeOutcome");
    const removed = commit.indexOf("for (const listing of collectionOpenListings)");
    const deleted = commit.indexOf("await deleteCollection(collection.id)");
    assert.ok(composed > 0 && removed > 0 && deleted > 0, "could not find all three");
    assert.ok(composed < removed && composed < deleted);
  });

  it("shows it after the delete resolves and before the navigation", () => {
    const deleted = commit.indexOf("await deleteCollection(collection.id)");
    const shown = commit.indexOf("toast.success(outcome)");
    const gone = commit.indexOf('router.replace("/")');
    assert.ok(shown > deleted, "the toast must not announce a delete that has not happened");
    assert.ok(shown < gone, "the toast is queued before the screen is replaced");
  });

  it("still removes every listing before the delete", () => {
    const removed = commit.indexOf("for (const listing of collectionOpenListings)");
    const deleted = commit.indexOf("await deleteCollection(collection.id)");
    assert.ok(removed < deleted, "items deleted first are items whose listings cannot be found");
  });

  it("still navigates away afterwards", () => {
    assert.match(commit, /router\.replace\("\/"\)/);
  });
});

describe("collectionDeleted", () => {
  const I18N = readI18nSource();

  it("is declared by every locale", () => {
    assertDeclaredInEveryLocale(I18N, "collectionDeleted");
  });

  it("each locale writes its own words", () => {
    const values = [...localeValuesOf(I18N, "collectionDeleted").values()];
    assert.equal(new Set(values).size, values.length, "two locales share a value");
  });

  it("is not the confirm's title reused", () => {
    // "Delete collection?" asks and "Collection deleted" reports; a locale that
    // reused the question would put a question mark on an outcome toast.
    const titles = localeValuesOf(I18N, "deleteCollectionTitle");
    for (const [code, done] of localeValuesOf(I18N, "collectionDeleted")) {
      assert.notEqual(done, titles.get(code), `${code} reports the outcome with the question`);
      assert.ok(!done.includes("?"), `${code} reports the outcome as a question`);
    }
  });
});
