import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { readI18nSource } from "./helpers/i18n-source-file";
import { assertDeclaredInEveryLocale, assertNoLocaleDeclares } from "./helpers/i18n-locales";
import { repoPath, readRepoFile } from "./helpers/repo-file";
import { sourceCodeFlat, sourceFiles } from "./helpers/source-files";
import { stripComments } from "@/lib/strip-comments";

/**
 * `app/collections-feed.tsx` is gone, and the app is not missing anything.
 *
 * It was a route no user could open: no `Link`, no nav entry, no
 * `router.push`, nothing in the tree pointing at it, reachable only by typing
 * the URL into a browser. What it rendered was the home screen's "Friends'
 * collections" and "Subscribed" tabs — the same selector over the same two
 * lists, the same `useChunkedList` window, the same `<CollectionCard>`, the
 * same two empty states, the same Load-more button. Four rounds of shared-code
 * work had by then been spent keeping a second copy of two tabs correct for
 * nobody, which is the cost this deletes.
 *
 * The alternative was an entry point, and it was the worse one: "see all"
 * leading to the same twenty cards behind the same Load-more button is not a
 * destination, and adding a link would have made the duplication permanent
 * rather than ended it. Nothing user-facing goes with the file — a screen no
 * route reaches has no users to lose.
 *
 * The one thing it did that the home screen does not is fetch per-collection
 * item counts from Supabase for the cards in its window. That is NOT ported:
 * the collections provider already fetches items for friend, subscribed and
 * shared-with-me collections (`fetchItemsByCollectionId` over each source),
 * and `getItemsForCollection` — what the home screen's cards count — reads the
 * merged result. Porting the fetch would have added a second round trip per
 * visible card for a number the screen already has.
 *
 * The cases below are the ones that would notice it coming back: the file, the
 * route, the two i18n keys nothing reads any more, and the third key that must
 * NOT be deleted with them because the home screen's subscribed tab renders it.
 */

const SCREEN = "app/collections-feed.tsx";
const HOME = stripComments(readRepoFile("app/index.tsx"));

describe("the collections-feed screen is retired", () => {
  it("has no route file", () => {
    assert.equal(
      existsSync(repoPath(SCREEN)),
      false,
      `${SCREEN} is back — expo-router turns any file under app/ into a route, so re-adding it re-adds the unreachable screen`,
    );
  });

  it("is named by no navigation anywhere in the tree", () => {
    // The screen was unreachable, so there is nothing to un-wire; this case is
    // about the other direction — a `/collections-feed` push added later would
    // point at a route that no longer exists, which expo-router answers with
    // an "unmatched route" screen rather than an error anybody sees in review.
    const offenders = sourceFiles("app", "components", "lib").filter((rel) =>
      /["'`]\/?collections-feed["'`]|href=\{?["'`]\/collections-feed/.test(sourceCodeFlat(rel)),
    );
    assert.deepEqual(
      offenders,
      [],
      "these files navigate to a route that does not exist",
    );
  });

  it("leaves the home screen owning both of the tabs it duplicated", () => {
    // The two lists it rendered are the two the home screen windows. If this
    // ever fails it is because the tabs moved, and the deletion above needs
    // re-reading rather than the assertion relaxing.
    assert.match(HOME, /useChunkedList\(friendCollections\)/);
    assert.match(HOME, /useChunkedList\(subscribedCollections\)/);
    assert.match(HOME, /key: "subscribed", label: t\("tabSubscribedCollections"\)/);
  });
});

describe("the copy that left with it", () => {
  const source = readI18nSource();

  it("declares neither of the two keys only that screen read", () => {
    // `collectionsFeed` (its eyebrow) and `collectionsFeedTitle` (its headline)
    // had exactly one reader each. Left in the map they would be six locales'
    // worth of strings that `lint:orphan-i18n` reports and nobody renders.
    assertNoLocaleDeclares(
      source,
      (key) => key === "collectionsFeed" || key === "collectionsFeedTitle",
      "the collections-feed screen was deleted and took its eyebrow and headline with it",
    );
  });

  it("keeps `collectionsFeedSubtitle`, which the home screen renders", () => {
    // The third key of the family survives its screen: the home screen's
    // subscribed tab has used it as its section description since before the
    // feed screen was windowed. Deleting a prefix family wholesale is the
    // realistic mistake here, and it would blank a line of the home screen.
    assertDeclaredInEveryLocale(source, "collectionsFeedSubtitle");
    assert.match(HOME, /t\("collectionsFeedSubtitle"\)/);
  });
});
