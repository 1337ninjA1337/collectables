import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LISTING_RULE_BY_ITEM_PATH } from "@/lib/marketplace-helpers";
import { stripComments } from "@/lib/strip-comments";

import { readRepoFile } from "./helpers/repo-file";

/**
 * Every path that acts on an item, and whether it asks the marketplace.
 *
 * Two bugs this week were the same bug. The archive round taught `archiveItem`
 * to retire an open listing and did not think about `deleteItem`; the round
 * that fixed `deleteItem` did not think about the bulk pair. Each was found by
 * writing a suggestion afterwards rather than by anything in the tree, because
 * the failure is always a path nobody remembered — and a rule stated only in
 * the paths that follow it cannot name the one that does not.
 *
 * So this is a list, checked against the provider's own mutations. The
 * expensive half is not the eight entries: it is the case below that finds a
 * NINTH, which is what turns "somebody has to remember" into "the build says
 * so". `moveItems` is the entry that proves the list is worth having — four
 * rounds carried it as an open question and the answer turned out to be
 * "exempt, and here is why", which no amount of copying the archive path
 * would have produced.
 */

const PROVIDER = stripComments(readRepoFile("lib/collections-context.tsx"));

/**
 * The provider's item mutations, read off the context type.
 *
 * Derived rather than listed twice: a mutation added to the type and not to
 * the record is exactly the shape this suite exists to catch, and a
 * hand-written copy of the type here would be one more place to forget.
 */
const declaredItemPaths = (): readonly string[] => {
  const matches = PROVIDER.matchAll(
    /^ {2}([a-zA-Z]+): \((?:itemId: string|itemIds: string\[\])[^)]*\) => Promise</gm,
  );
  return [...matches].map((m) => m[1]).sort();
};

const verdict = (path: string): string => LISTING_RULE_BY_ITEM_PATH[path] ?? "";
const retires = (path: string): boolean => verdict(path).startsWith("retires");

describe("the record covers the provider", () => {
  it("found the provider's mutations at all", () => {
    // Without this the two comparisons below pass on an empty list, which is
    // the way a sweep like this dies quietly.
    assert.ok(declaredItemPaths().length >= 6, "the type scan found almost nothing — the regex has drifted");
  });

  it("names every item mutation the provider declares", () => {
    const missing = declaredItemPaths().filter((path) => !(path in LISTING_RULE_BY_ITEM_PATH));
    assert.deepEqual(
      missing,
      [],
      `these item mutations have no listing verdict: ${missing.join(", ")}.\n` +
        "  Decide whether the path has to retire an open listing before letting the item go,\n" +
        "  and record the reason in LISTING_RULE_BY_ITEM_PATH — including when the answer is no.",
    );
  });

  it("names nothing the provider does not declare", () => {
    // A verdict for a mutation that was renamed or removed is a rule nobody
    // is following and nobody can see is dead.
    const stale = Object.keys(LISTING_RULE_BY_ITEM_PATH).filter(
      (path) => !declaredItemPaths().includes(path),
    );
    assert.deepEqual(stale, [], `these verdicts describe mutations that no longer exist: ${stale.join(", ")}`);
  });

  it("gives every entry a reason, not just a verdict", () => {
    // "EXEMPT" alone is the state the four `moveItems` rounds were already in.
    const thin = Object.entries(LISTING_RULE_BY_ITEM_PATH)
      .filter(([, reason]) => reason.length < 60)
      .map(([path]) => path);
    assert.deepEqual(thin, [], `these verdicts state an answer without an argument: ${thin.join(", ")}`);
  });

  it("splits into retiring and exempt, with both sides populated", () => {
    const paths = Object.keys(LISTING_RULE_BY_ITEM_PATH);
    const retiring = paths.filter(retires);
    const exempt = paths.filter((p) => verdict(p).startsWith("EXEMPT"));

    assert.deepEqual([...retiring, ...exempt].sort(), paths.slice().sort(), "a verdict reads as neither");
    assert.ok(retiring.length > 0 && exempt.length > 0);
  });
});

describe("the verdicts match what the code does", () => {
  const ITEM_SCREEN = stripComments(readRepoFile("app/item/[id].tsx"));
  const COLLECTION_SCREEN = stripComments(readRepoFile("app/collection/[id].tsx"));

  it("archiveItem and deleteItem retire, on the screen that calls them", () => {
    assert.ok(retires("archiveItem") && retires("deleteItem"));
    assert.match(ITEM_SCREEN, /const retiring = isOpenListing\(existingListing\);/);
    assert.match(ITEM_SCREEN, /if \(isOpenListing\(existingListing\) && existingListing\) \{/);
  });

  it("archiveItems and deleteItems retire, on the screen that calls them", () => {
    assert.ok(retires("archiveItems") && retires("deleteItems"));
    assert.match(COLLECTION_SCREEN, /openListingsForItems\(myListings, Array\.from\(selectedIds\)\)/);
    const del = COLLECTION_SCREEN.slice(
      COLLECTION_SCREEN.indexOf("const performBulkDelete"),
      COLLECTION_SCREEN.indexOf("const handleBulkDelete"),
    );
    const arc = COLLECTION_SCREEN.slice(
      COLLECTION_SCREEN.indexOf("const performBulkArchive"),
      COLLECTION_SCREEN.indexOf("const handleBulkArchive"),
    );
    assert.match(del, /retireSelectedListings\(\);/);
    assert.match(arc, /retireSelectedListings\(\);/);
  });

  it("moveItems is exempt, and the code it calls agrees", () => {
    assert.ok(verdict("moveItems").startsWith("EXEMPT"));
    const move = PROVIDER.slice(
      PROVIDER.indexOf("moveItems: async"),
      PROVIDER.indexOf("deleteCollection: async"),
    );
    assert.ok(move.length > 0, "could not parse moveItems");
    assert.ok(!move.includes("Listing"), "moveItems touches listings while its verdict says it does not");
  });

  it("the reason moveItems is exempt is a fact about the data, and still true", () => {
    // The verdict says a listing carries `itemId` and nothing about the
    // collection, so a move is invisible to the marketplace. That is the
    // sentence a future round would otherwise re-derive — or get wrong.
    assert.match(verdict("moveItems"), /carries `itemId` and nothing about the collection/);
    const LISTING_SCREEN = stripComments(readRepoFile("app/listing/[id].tsx"));
    assert.match(LISTING_SCREEN, /getItemById\(listing\.itemId\)/);
    assert.ok(!LISTING_SCREEN.includes("listing.collectionId"));
    const TYPES = stripComments(readRepoFile("lib/types.ts"));
    const shape = TYPES.slice(TYPES.indexOf("export type MarketplaceListing = {"));
    assert.ok(!shape.slice(0, shape.indexOf("};")).includes("collectionId"));
  });

  it("the provider itself retires nothing, which every verdict assumes", () => {
    // The rule is enforced by the screens, because the two providers cannot
    // see each other. That is a real limitation and it is the premise of this
    // whole record: a verdict of "retires" is a claim about a CALL SITE.
    assert.ok(!PROVIDER.includes("isOpenListing"));
    assert.ok(!PROVIDER.includes("openListingsForItems"));
  });
});
