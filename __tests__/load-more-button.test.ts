import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { stripComments } from "@/lib/strip-comments";

import { readRepoFile } from "./helpers/repo-file";

/**
 * One Load-more button, for the three screens that grow a window.
 *
 * It was written out three times — collection detail's drag-mode fallback,
 * `app/collections-feed.tsx`, and the home screen's two borrowed-list tabs —
 * each copy arriving when that screen got its window, each carrying the same
 * three i18n keys, the same two style rules and the same accessibility props.
 * The third copy was added on 2026-09-11 and retired the same day, which is
 * the only reason this is a component and not a fourth.
 *
 * Structural: the component pulls react-native, so what is asserted is that
 * every screen reaches it and none of them kept a copy. The behavioural claim
 * — nothing renders when nothing remains — is the one line the sweep below
 * cannot see, and it is pinned by its own case.
 */

const COMPONENT = stripComments(readRepoFile("components/load-more-button.tsx"));

const SCREENS = [
  "app/index.tsx",
  "app/collections-feed.tsx",
  "app/collection/[id].tsx",
] as const;

describe("LoadMoreButton", () => {
  it("renders nothing when nothing remains", () => {
    // Every copy gated on the window's `hasMore` and then computed
    // `total - visibleItems.length` for the label — the same fact asked twice.
    // One number now, and "Load more (0 remaining)" stops being expressible.
    assert.match(COMPONENT, /if \(remaining <= 0\) return null;/);
  });

  it("guards against a negative remaining, not just a zero one", () => {
    // `<=`, not `===`. A caller whose total and window disagree for a render
    // — a list that shrank under a window that had not reset yet — would
    // otherwise render "Load more (-3 remaining)".
    assert.doesNotMatch(COMPONENT, /if \(remaining === 0\)/);
  });

  it("owns the three strings", () => {
    assert.match(COMPONENT, /t\("loadMoreItems", \{ count: remaining \}\)/);
    assert.match(COMPONENT, /t\("loadMoreItemsA11y", \{ count: remaining \}\)/);
    assert.match(COMPONENT, /t\("loadMoreItemsHint"\)/);
  });

  it("takes t from the context rather than its labels from the caller", () => {
    // The `reorderActionProps` precedent: a module that renders a string is
    // handed the translator, not the translation.
    assert.match(COMPONENT, /const \{ t \} = useI18n\(\);/);
  });

  it("is announced as a button", () => {
    assert.match(COMPONENT, /accessibilityRole="button"/);
  });

  it("owns the styles too", () => {
    assert.match(COMPONENT, /loadMore: \{/);
    assert.match(COMPONENT, /loadMoreText: \{/);
  });
});

describe("no screen kept its own copy", () => {
  for (const screen of SCREENS) {
    const CODE = stripComments(readRepoFile(screen));

    it(`${screen} imports the component`, () => {
      assert.match(CODE, /import \{ LoadMoreButton \} from "@\/components\/load-more-button";/);
    });

    it(`${screen} no longer names the strings or the styles`, () => {
      // The three keys and the two style rules are the whole duplicated
      // surface; a screen still naming either has an inline copy.
      assert.doesNotMatch(CODE, /loadMoreItemsA11y/);
      assert.doesNotMatch(CODE, /loadMoreItemsHint/);
      assert.doesNotMatch(CODE, /styles\.loadMoreText/);
      assert.doesNotMatch(CODE, /^\s*loadMore: \{/m);
    });
  }
});
