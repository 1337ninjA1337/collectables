import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { stripComments } from "@/lib/strip-comments";

import { readI18nSource } from "./helpers/i18n-source-file";
import { assertDeclaredInEveryLocale, localeValuesOf } from "./helpers/i18n-locales";
import { readRepoFile } from "./helpers/repo-file";

/**
 * An archived item cannot be put up for sale.
 *
 * The archive rounds gave the state a screen, a restore and a banner, and left
 * the marketplace block underneath that banner completely unchanged: "List on
 * marketplace" rendered as normal, the sheet opened, and `addListing` accepted
 * the id. So a seller could offer an item the app itself was describing, two
 * inches higher up, as one they no longer have.
 *
 * **Why this is the one affordance worth closing.** The share sheet, the
 * reaction bar and the edit form all act on the seller's own data; a listing
 * creates an expectation in somebody ELSE, who then claims it and waits for a
 * thing that was sold last month. And the archived items most likely to be
 * re-listed are exactly the ones that got there through the sold-listing
 * prompt — items whose whole history is "this was already bought".
 *
 * **Why the feed is not the place to fix it.** Items are local-first: a
 * buyer's device has the listing and not the seller's `archivedAt`, so no
 * filter on the browse page could see the state. The lock has to be on the
 * device that knows, which is the seller's.
 */

const SRC = stripComments(readRepoFile("app/item/[id].tsx"));

describe("the listing CTA", () => {
  it("is not rendered at all for an archived item", () => {
    // Not disabled: an archived item is usually one that has already been
    // sold, and a greyed-out "List on marketplace" invites a press that
    // explains nothing.
    assert.match(SRC, /\) : isArchived\(activeItem\) \? \(/);
    assert.match(SRC, /t\("marketplaceArchivedHint"\)/);
  });

  it("says what to do instead of only refusing", () => {
    const branch = SRC.slice(
      SRC.indexOf(") : isArchived(activeItem) ? ("),
      SRC.indexOf("styles.listingButton"),
    );
    assert.ok(branch.length > 0, "could not parse the archived branch");
    assert.ok(!branch.includes("marketplaceListOnMarketplace"), "the CTA is still in the archived branch");
    assert.ok(!branch.includes("openListingSheet"), "the sheet is still reachable from the archived branch");
  });

  it("leaves the remove-listing path alone", () => {
    // Taking a listing DOWN must keep working on an archived item — that is
    // the direction that reduces the obligation rather than creating one, and
    // an item archived while listed is exactly the case that needs it.
    assert.match(SRC, /onPress=\{handleRemoveListing\}/);
    assert.match(SRC, /t\("marketplaceRemoveListing"\)/);
  });

  it("keeps the free-cap branch for live items", () => {
    // The archived branch is inserted between the two existing ones, and the
    // realistic slip is for it to swallow the cap hint with them.
    assert.match(SRC, /disabled=\{overFreeCap\}/);
    assert.match(SRC, /t\("marketplaceUpgradeHint"\)/);
  });
});

describe("the submit path holds its own lock", () => {
  const handler = SRC.slice(
    SRC.indexOf("function handleSubmitListing"),
    SRC.indexOf("function handleRemoveListing"),
  );

  it("parsed the handler (guards the assertions below from passing vacuously)", () => {
    assert.ok(handler.length > 0);
  });

  it("refuses an archived item even with the sheet already open", () => {
    // The sold-listing prompt fires on a realtime update, on whatever screen
    // the seller happens to be looking at — including this one with the sheet
    // open. Hiding the button is not the same as closing the door.
    assert.match(handler, /if \(isArchived\(activeItem\)\) \{/);
    assert.match(handler, /toast\.error\(t\("marketplaceArchivedBlocked"\)\);/);
    assert.match(handler, /setListingSheetOpen\(false\);/);
  });

  it("checks before it calls addListing, not after", () => {
    const guard = handler.indexOf("isArchived(activeItem)");
    const call = handler.indexOf("addListing({");
    assert.ok(guard > 0 && call > 0, "could not find both the guard and the call");
    assert.ok(guard < call, "a check after the write is not a check");
  });

  it("keeps the free-cap guard ahead of it", () => {
    const cap = handler.indexOf("if (overFreeCap) return;");
    assert.ok(cap >= 0 && cap < handler.indexOf("isArchived(activeItem)"));
  });
});

describe("both strings are translated everywhere", () => {
  const I18N = readI18nSource();
  const KEYS = ["marketplaceArchivedHint", "marketplaceArchivedBlocked"] as const;

  for (const key of KEYS) {
    it(`${key} is declared by every locale`, () => {
      assertDeclaredInEveryLocale(I18N, key);
    });
  }

  it("the two are not the same sentence", () => {
    // One is a standing explanation under an empty slot, the other is a toast
    // fired at the moment of a refusal. A hint that reads like an error is
    // alarming where nothing went wrong, and an error that reads like a hint
    // does not say that the press was rejected.
    for (const [code, hint] of localeValuesOf(I18N, "marketplaceArchivedHint")) {
      const blocked = localeValuesOf(I18N, "marketplaceArchivedBlocked").get(code) ?? "";
      assert.notEqual(hint, blocked, `${code} uses one string for both`);
      assert.ok(hint.length > blocked.length, `${code}'s standing hint explains less than its toast`);
    }
  });

  it("each locale writes its own words", () => {
    for (const key of KEYS) {
      const values = [...localeValuesOf(I18N, key).values()];
      assert.equal(new Set(values).size, values.length, `two locales share a value for '${key}'`);
    }
  });
});
