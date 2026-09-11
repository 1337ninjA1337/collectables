import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactElement } from "react";

import { stripComments } from "@/lib/strip-comments";

import { autoUnmount, installNativeModuleStubs, mockModule, render } from "./helpers/render";
import { readRepoFile } from "./helpers/repo-file";

mockModule("@/lib/i18n-context", {
  useI18n: () => ({
    t: (key: string, params?: { count?: number }) =>
      params?.count === undefined ? key : `${key}:${params.count}`,
  }),
});

installNativeModuleStubs();
autoUnmount();

async function mount(remaining: number, onPress: () => void = () => undefined) {
  const { LoadMoreButton } = await import("@/components/load-more-button");
  return render(createElement(LoadMoreButton, { remaining, onPress }) as ReactElement);
}

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

describe("LoadMoreButton, rendered", () => {
  it("puts no node in the tree when nothing remains", async () => {
    // The claim the regexes cannot check. `return null` and a node styled to
    // nothing look identical in source and are not identical in a layout: an
    // empty pressable still takes its 14pt of vertical padding, which on the
    // home screen would be a gap under the last card that nobody can explain.
    const tree = await mount(0);

    assert.deepEqual(tree.all(), [], "a spent window renders nothing at all");
    assert.deepEqual(tree.texts(), []);
  });

  it("renders nothing for a negative remaining either", async () => {
    const tree = await mount(-3);

    assert.deepEqual(tree.all(), []);
  });

  it("renders a button carrying the count when rows are left", async () => {
    const tree = await mount(7);

    assert.deepEqual(tree.texts(), ["loadMoreItems:7"]);
    const buttons = tree.all().filter((node) => node.props?.accessibilityRole === "button");
    assert.equal(buttons.length, 1);
  });

  it("labels and hints the button for a reader that cannot see the count", async () => {
    const tree = await mount(7);

    const [button] = tree.all().filter((node) => node.props?.accessibilityRole === "button");
    assert.equal(button.props?.accessibilityLabel, "loadMoreItemsA11y:7");
    assert.equal(button.props?.accessibilityHint, "loadMoreItemsHint");
  });

  it("grows the window when pressed", async () => {
    let presses = 0;
    const tree = await mount(7, () => { presses += 1; });

    const [button] = tree.all().filter((node) => node.props?.accessibilityRole === "button");
    (button.props.onPress as () => void)();
    assert.equal(presses, 1);
  });

  it("renders one row remaining without special-casing it", async () => {
    // The boundary between "a button" and "no button" is 1 / 0, and the label
    // is a count rather than a plural form — so one is not a different
    // sentence, it is the same one with a 1 in it.
    const tree = await mount(1);

    assert.deepEqual(tree.texts(), ["loadMoreItems:1"]);
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
