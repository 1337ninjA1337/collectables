import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { stripComments } from "@/lib/strip-comments";
import type { MarketplaceMode } from "@/lib/types";

import { readI18nSource } from "./helpers/i18n-source-file";
import { assertDeclaredInEveryLocale, localeValuesOf } from "./helpers/i18n-locales";
import { readRepoFile } from "./helpers/repo-file";

/**
 * A wishlist item could be put up for sale.
 *
 * The archived round closed this door for things the collector USED to have;
 * the same door stood open for things they have never had. `app/item/[id].tsx`
 * rendered "List on marketplace" for a want exactly as for a holding, and
 * `addListing` took the id.
 *
 * BOTH MODES ARE AN OFFER TO HAND THE ITEM OVER. `MarketplaceMode` is
 * `"trade" | "sell"` — there is no "looking for" mode — so listing a want
 * promises a stranger a thing the seller is still trying to find. That is the
 * archived mistake told forwards in time, and it is the same harm: an
 * expectation in somebody else, who claims the listing and waits.
 *
 * The bug reached the previous round from the other end: the collection delete
 * counted its open listings from a live-item-filtered list, so a listed want
 * was a listing nothing would retire. Fixing the count made the listing
 * reachable; this asks whether it should have existed.
 */

describe("the premise", () => {
  it("every listing mode hands the item over", () => {
    // If a "looking for" mode is ever added, this case is where the argument
    // for the branch below stops holding.
    const modes: MarketplaceMode[] = ["trade", "sell"];
    assert.deepEqual(modes, ["trade", "sell"]);
    const TYPES = readRepoFile("lib/types.ts");
    assert.match(TYPES, /export type MarketplaceMode = "trade" \| "sell";/);
  });

  it("nothing turns an owned item back into a want", () => {
    // The reason there is ONE lock here and two on the archived door: the
    // archived state arrives from a realtime prompt that can fire while the
    // listing sheet is open, and `isWishlist` is written once, at creation.
    // `promoteWishlistItem` only clears it. A second guard inside
    // `handleSubmitListing` would be unreachable, and an unreachable guard is
    // a claim nobody can check.
    const PROVIDER = stripComments(readRepoFile("lib/collections-context.tsx"));
    const writes = [...PROVIDER.matchAll(/isWishlist: true/g)];
    assert.equal(writes.length, 1, "a second writer of `isWishlist: true` needs a second lock");
    const creator = PROVIDER.slice(
      PROVIDER.indexOf("addWishlistItem: async (input)"),
      PROVIDER.indexOf("promoteWishlistItem: async (itemId"),
    );
    assert.ok(creator.includes("isWishlist: true"), "the one writer is the creation path");
  });
});

describe("the item screen's marketplace block", () => {
  const SRC = readRepoFile("app/item/[id].tsx");
  const BODY = stripComments(SRC);

  it("offers no CTA for a want, and says why instead", () => {
    assert.match(BODY, /\) : activeItem\.isWishlist \? \(/);
    assert.match(BODY, /t\("marketplaceWishlistHint"\)/);
  });

  it("keeps the take-it-down path open for a want that is already listed", () => {
    // The direction that reduces the obligation rather than creating one, and
    // the case an item listed before this shipped lands in. The branch order
    // is the claim: `existingListing` is asked first.
    // Anchored on the chain's own `) : …` spellings: a bare
    // `isArchived(activeItem) ? (` also matches the Archive BUTTON's gate
    // (`!isArchived(activeItem) ? (`) higher up the screen.
    const listed = BODY.indexOf("existingListing ? (");
    const archived = BODY.indexOf(") : isArchived(activeItem) ? (");
    const want = BODY.indexOf(") : activeItem.isWishlist ? (");
    assert.ok(listed > 0 && archived > listed, "the listed branch must come first");
    assert.ok(want > archived, "the want branch sits under both, so neither loses its answer");
  });

  it("the hint is a sentence, not a disabled button", () => {
    // Same argument the archived branch makes: a greyed-out CTA invites a
    // press that explains nothing.
    const start = BODY.indexOf(") : activeItem.isWishlist ? (");
    const branch = BODY.slice(start, BODY.indexOf(") : (", start + 4));
    assert.ok(branch.length > 0, "could not parse the want branch");
    assert.ok(branch.includes("marketplaceWishlistHint"), "wrong slice — the hint is not in it");
    assert.ok(!branch.includes("disabled"), "the want branch renders a disabled control");
    assert.ok(!branch.includes("Pressable"), "the want branch renders a button");
  });

  it("asks the field and not a re-derivation of it", () => {
    // `isLiveItem` would be wrong here: it also answers false for an archived
    // item, and that case has its own branch with its own sentence.
    assert.match(BODY, /activeItem\.isWishlist/);
    const start = BODY.indexOf(") : activeItem.isWishlist ? (");
    const branch = BODY.slice(start, BODY.indexOf(") : (", start + 4));
    assert.ok(!branch.includes("isLiveItem"), "one predicate cannot answer two branches");
  });

  it("does not add an unreachable second lock in the submit handler", () => {
    // Stated rather than assumed: the archived guard is there because that
    // state can arrive while the sheet is open. `isWishlist` cannot.
    const submit = BODY.slice(
      BODY.indexOf("function handleSubmitListing"),
      BODY.indexOf("const result = addListing("),
    );
    assert.ok(submit.length > 0, "could not parse the submit handler");
    assert.match(submit, /if \(isArchived\(activeItem\)\) \{/);
    assert.ok(!submit.includes("isWishlist"), "a guard no path can reach is a claim nobody can check");
  });
});

describe("marketplaceWishlistHint", () => {
  const I18N = readI18nSource();

  it("is declared by every locale", () => {
    assertDeclaredInEveryLocale(I18N, "marketplaceWishlistHint");
  });

  it("each locale writes its own words", () => {
    const values = [...localeValuesOf(I18N, "marketplaceWishlistHint").values()];
    assert.equal(new Set(values).size, values.length, "two locales share a value");
  });

  it("says what to do and not only what is refused, in every locale", () => {
    // The archived hint's shape: the sentence exists because there is no
    // button left to press, so it has to name the action that unblocks it.
    // Length against the archived BLOCKED toast, which is the terse form.
    const terse = localeValuesOf(I18N, "marketplaceArchivedBlocked");
    for (const [code, hint] of localeValuesOf(I18N, "marketplaceWishlistHint")) {
      assert.ok(
        hint.length > (terse.get(code) ?? "").length,
        `${code}'s hint says no more than a refusal`,
      );
    }
  });

  it("is not the archived hint reused", () => {
    // Two different states with two different answers: one says restore, the
    // other says you do not have this yet.
    const archived = localeValuesOf(I18N, "marketplaceArchivedHint");
    for (const [code, hint] of localeValuesOf(I18N, "marketplaceWishlistHint")) {
      assert.notEqual(hint, archived.get(code), `${code} answers both states the same way`);
    }
  });
});
