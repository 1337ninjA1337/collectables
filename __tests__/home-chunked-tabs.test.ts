import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { stripComments } from "@/lib/strip-comments";

import { readRepoFile } from "./helpers/repo-file";

/**
 * The two home tabs that render somebody else's list are windowed; the one
 * that renders the owner's is not.
 *
 * "Friends' collections" and "Subscribed" both `.map`ped the whole array, so
 * every friend collection and every subscription mounted a `CollectionCard` —
 * and its remote cover image — as soon as the home screen rendered, whether or
 * not the tab was the visible one. `useChunkedList` exists for exactly that
 * iOS memory hot-path, and `app/collections-feed.tsx` has used it for these
 * two lists since it was written. The home screen is where every user lands
 * and it was the one still unbounded.
 *
 * "Mine" stays unwindowed on purpose: it is a drag-to-reorder list, and a
 * window would let the owner drag a row toward a position that is not mounted.
 * The last case is what keeps that a decision rather than an omission.
 *
 * Structural, like the screen's other pins — `app/index.tsx` pulls
 * expo-router and react-native and cannot be mounted here.
 */

const SRC = readRepoFile("app/index.tsx");
const CODE = stripComments(SRC);

describe("the home screen's borrowed-list tabs", () => {
  it("windows both of them", () => {
    assert.match(CODE, /const friendsWindow = useChunkedList\(friendCollections\)/);
    assert.match(CODE, /const subscribedWindow = useChunkedList\(subscribedCollections\)/);
  });

  it("renders the window, not the whole array", () => {
    assert.match(CODE, /friendsWindow\.visibleItems\.map\(/);
    assert.match(CODE, /subscribedWindow\.visibleItems\.map\(/);
    assert.doesNotMatch(CODE, /friendCollections\.map\(\(collection\)/);
    assert.doesNotMatch(CODE, /subscribedCollections\.map\(\(collection\)/);
  });

  it("still asks the FULL length whether the list is empty", () => {
    // `visibleItems.length > 0` would be the same answer today and the wrong
    // question: an empty window over a non-empty list would render the
    // "no friends yet" empty state at somebody who has plenty.
    assert.match(CODE, /friendCollections\.length > 0 \?/);
    assert.match(CODE, /subscribedCollections\.length > 0 \?/);
  });

  it("offers a way to grow each window", () => {
    assert.match(CODE, /renderLoadMore\(friendsWindow, friendCollections\.length\)/);
    assert.match(CODE, /renderLoadMore\(subscribedWindow, subscribedCollections\.length\)/);
  });

  it("declares both hooks above the early return, or they are conditional hooks", () => {
    // `if (!ready)` returns a skeleton; a hook below it runs on some renders
    // and not others, which React treats as a different component.
    const friends = CODE.indexOf("const friendsWindow = useChunkedList(");
    const subscribed = CODE.indexOf("const subscribedWindow = useChunkedList(");
    const early = CODE.indexOf("if (!ready)");
    assert.ok(friends > 0 && subscribed > 0 && early > 0, "all three anchors must be present");
    assert.ok(friends < early, "the friends window must be declared above the early return");
    assert.ok(subscribed < early, "the subscribed window must be declared above the early return");
  });
});

describe("the home screen's Load-more CTA", () => {
  it("is the shared component, not a third copy of the button", () => {
    // This screen's copy was the third — collection detail's drag fallback and
    // the feed screen had the other two, with the same three i18n keys and the
    // same two style rules each. It was added and retired the same day.
    assert.match(CODE, /import \{ LoadMoreButton \} from "@\/components\/load-more-button";/);
    assert.doesNotMatch(CODE, /loadMoreItemsA11y/);
    assert.doesNotMatch(CODE, /styles\.loadMore\b/);
  });

  it("counts what is left, not what is shown", () => {
    // The component renders nothing at zero, so the arithmetic IS the
    // "should this button exist" decision — there is no second gate here to
    // disagree with it.
    assert.match(CODE, /remaining=\{total - window\.visibleItems\.length\}/);
  });

  it("is written once for the two tabs that have one", () => {
    assert.match(CODE, /const renderLoadMore = \(window: ChunkedList<Collection>, total: number\) =>/);
    assert.equal(
      (CODE.match(/renderLoadMore\(/g) ?? []).length,
      2,
      "the two calls — the arrow-function definition is `renderLoadMore = (`, not a call",
    );
  });
});

describe("the owner's own list is deliberately not windowed", () => {
  it("hands the draggable list every row it owns", () => {
    // A window and a drag do not compose: the owner would be dragging a row
    // toward a position that is not mounted. `ownedCollections` also cannot
    // grow the way the other two can — it is collections the user made.
    assert.match(CODE, /data=\{ownedCollections\}/);
    assert.doesNotMatch(CODE, /useChunkedList\(ownedCollections\)/);
  });

  it("says why, where somebody adding a third window would read it", () => {
    assert.match(
      SRC,
      /"Mine" is deliberately NOT windowed/,
      "an unwindowed list beside two windowed ones needs a reason written down",
    );
  });
});
