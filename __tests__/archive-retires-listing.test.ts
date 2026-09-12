import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { shouldRetireListingOnArchive } from "@/lib/marketplace-helpers";
import { stripComments } from "@/lib/strip-comments";
import type { MarketplaceListing } from "@/lib/types";

import { readI18nSource } from "./helpers/i18n-source-file";
import { assertDeclaredInEveryLocale, localeValuesOf } from "./helpers/i18n-locales";
import { readRepoFile } from "./helpers/repo-file";

/**
 * Archiving an item takes its open listing down with it.
 *
 * The previous round stopped a listing being CREATED for an archived item and
 * said nothing about the reverse order — which is the likelier one: a seller
 * agrees a sale off-platform and archives the item afterwards. Nothing in
 * `archiveItem` touched the marketplace, so the listing outlived the archive
 * and stayed in `activeListings` for every buyer, while the item's own screen
 * showed it as listed underneath a banner reading "this item is archived".
 *
 * **A SOLD listing stays.** The sold-listing prompt archives the item as the
 * final step of a sale that already happened, and the listing is that sale's
 * record — the buyer's purchase list, the transfer log and "recently sold" all
 * read it. Removing it there would delete the history the archive exists to
 * keep, which is the argument `archivedAt` itself is built on. So the question
 * is exactly "is there a listing, and is it still open?".
 */

const listing = (over: Partial<MarketplaceListing> = {}): MarketplaceListing =>
  ({
    id: "l-1",
    itemId: "i-1",
    ownerUserId: "u-1",
    mode: "sell",
    askingPrice: 10,
    currency: "USD",
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  }) as MarketplaceListing;

describe("shouldRetireListingOnArchive", () => {
  it("takes down an open listing", () => {
    assert.equal(shouldRetireListingOnArchive(listing()), true);
  });

  it("leaves a sold listing standing, because it is the record of the sale", () => {
    assert.equal(
      shouldRetireListingOnArchive(listing({ soldAt: "2026-02-01T00:00:00.000Z" })),
      false,
    );
  });

  it("is false for an item that was never listed", () => {
    // Both spellings of absence: `findListingByItemId` answers `undefined`,
    // and a caller threading a nullable through gets `null`.
    assert.equal(shouldRetireListingOnArchive(undefined), false);
    assert.equal(shouldRetireListingOnArchive(null), false);
  });

  it("asks about soldAt and not about a buyer", () => {
    // A listing can be claimed before the transfer completes, and the moment
    // the record becomes history is `soldAt` — the same field `activeListings`
    // filters the browse feed on. Asking a different question here would let
    // the two disagree about what "still open" means.
    assert.equal(shouldRetireListingOnArchive(listing({ buyerUserId: "u-2" })), true);
    assert.equal(
      shouldRetireListingOnArchive(listing({ soldAt: "2026-02-01T00:00:00.000Z", buyerUserId: "u-2" })),
      false,
    );
  });

  it("is the same question activeListings asks, in the same words", () => {
    // The two must agree: a listing this leaves standing is one the browse
    // feed will keep showing.
    const SRC = stripComments(readRepoFile("lib/marketplace-helpers.ts"));
    assert.match(SRC, /return !listing\.soldAt;/);
    assert.match(SRC, /\.filter\(\(l\) => !l\.soldAt\)/);
  });

  it("is a function rather than an if on a screen", () => {
    // The previous round put its rule in a component, and the next caller — a
    // bulk archive — would not inherit one that lives there.
    const SRC = stripComments(readRepoFile("lib/marketplace-helpers.ts"));
    assert.match(SRC, /export function shouldRetireListingOnArchive\(/);
  });
});

describe("the item screen's archive action", () => {
  const SRC = stripComments(readRepoFile("app/item/[id].tsx"));
  const handler = SRC.slice(
    SRC.indexOf("function handleArchive"),
    SRC.indexOf("function handleRestore"),
  );

  it("parsed the handler (guards the assertions below from passing vacuously)", () => {
    assert.ok(handler.length > 0);
  });

  it("asks the shared rule rather than reading soldAt itself", () => {
    assert.match(handler, /const retiring = shouldRetireListingOnArchive\(existingListing\);/);
    assert.ok(!handler.includes("soldAt"));
  });

  it("confirms before it takes a listing down", () => {
    // Archiving an unlisted item is a private act; archiving a listed one
    // withdraws something other people can see, so this branch asks.
    assert.match(handler, /const ok = await confirmDialog\(\{/);
    assert.match(handler, /title: t\("archiveListedTitle"\),/);
    assert.match(handler, /if \(!ok\) return;/);
  });

  it("removes the listing before it archives the item", () => {
    const remove = handler.indexOf("removeListing(listingId)");
    const archive = handler.indexOf("await archiveItem(archivedId)");
    assert.ok(remove > 0 && archive > 0);
    assert.ok(remove < archive, "an item archived first is one whose listing removal can be lost");
  });

  it("offers no undo on the branch that is not undoable", () => {
    // `addListing` mints a new id and a new `createdAt`, so nothing can put
    // the listing back. An undo that silently restored half of what it took
    // would be worse than none, which is why the confirm carries the warning
    // instead.
    const retiring = handler.slice(handler.indexOf("if (retiring"), handler.indexOf("void archiveItem(archivedId).then"));
    assert.ok(retiring.length > 0, "could not parse the retiring branch");
    assert.ok(!retiring.includes('t("undo")'), "the non-undoable branch offers an undo");
    assert.match(retiring, /toast\.success\(t\("archiveActionDoneListingRemoved"\)\)/);
  });

  it("keeps the undo on the ordinary branch", () => {
    const plain = handler.slice(handler.indexOf("void archiveItem(archivedId).then"));
    assert.match(plain, /label: t\("undo"\)/);
    assert.match(plain, /message: t\("archiveActionDone"\)/);
  });

  it("captures the listing id before the await, like the item id", () => {
    // `existingListing` is recomputed from `findListingByItemId` on every
    // render, and the confirm dialog is an await in the middle.
    assert.match(handler, /const listingId = existingListing\.id;/);
    assert.match(handler, /const archivedId = activeItem\.id;/);
  });
});

describe("the three new strings are translated everywhere", () => {
  const I18N = readI18nSource();
  const KEYS = [
    "archiveActionDoneListingRemoved",
    "archiveListedTitle",
    "archiveListedBody",
  ] as const;

  for (const key of KEYS) {
    it(`${key} is declared by every locale`, () => {
      assertDeclaredInEveryLocale(I18N, key);
    });
  }

  it("the confirm body warns that the listing does not come back", () => {
    // The whole reason this branch asks: the item is restorable and the
    // listing is not, and a confirm that only said "are you sure" would leave
    // the reader assuming the undo they have seen everywhere else applies.
    for (const [code, body] of localeValuesOf(I18N, "archiveListedBody")) {
      const title = localeValuesOf(I18N, "archiveListedTitle").get(code) ?? "";
      assert.ok(body.length > title.length, `${code}'s body says less than its title`);
    }
  });

  it("each locale writes its own words", () => {
    for (const key of KEYS) {
      const values = [...localeValuesOf(I18N, key).values()];
      assert.equal(new Set(values).size, values.length, `two locales share a value for '${key}'`);
    }
  });

  it("the two archive toasts are different sentences", () => {
    // One says an item was archived; the other says an item was archived AND
    // something was withdrawn from a public feed. Collapsing them would hide
    // the half a seller most needs to have read.
    for (const [code, withListing] of localeValuesOf(I18N, "archiveActionDoneListingRemoved")) {
      const plain = localeValuesOf(I18N, "archiveActionDone").get(code) ?? "";
      assert.notEqual(withListing, plain, `${code} uses one toast for both outcomes`);
    }
  });
});
