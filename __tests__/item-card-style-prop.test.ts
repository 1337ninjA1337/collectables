import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * ItemCard `style` prop (VM-C follow-up): the masonry cell's `flex: 1` used
 * to come from a per-item `<View style={styles.masonryItem}>` wrapper around
 * every card — one extra node per cell × hundreds of cells. `ItemCard` now
 * accepts an additive `style?: StyleProp<ViewStyle>` forwarded to its outer
 * Pressable (both branches), and the viewer renderItem passes the cell style
 * directly. Sources pull in react-native peers — assertions are regex-based.
 */
function readCardSrc(): string {
  return readFileSync(path.join(process.cwd(), "components", "item-card.tsx"), "utf8");
}

function readCollectionSrc(): string {
  return readFileSync(path.join(process.cwd(), "app", "collection", "[id].tsx"), "utf8");
}

describe("ItemCard style prop — masonry wrapper collapse", () => {
  it("declares the additive style prop and destructures it", () => {
    const src = readCardSrc();
    assert.match(src, /style\?: StyleProp<ViewStyle>/);
    assert.match(src, /function ItemCard\(\{ item, compact, style \}/);
  });

  // The merge stays caller-last so a caller's style still wins — but it must go
  // through `StyleSheet.flatten`, never reach the Pressable as a raw array: this
  // Pressable is the child of `<Link asChild>`, and Radix's Slot merges the two
  // styles with an object spread. Spreading an array yields `{0:…,1:…}`, which
  // react-native-web pushes into the DOM as `node.style[0] = …` and crashes the
  // web build ("Failed to set an indexed property [0] on 'CSSStyleDeclaration'").
  // See `__tests__/link-aschild-style-flatten.test.ts`.
  it("forwards style to the outer Pressable of BOTH branches, caller-last so it can win", () => {
    const src = readCardSrc();
    assert.match(
      src,
      /<Pressable style=\{StyleSheet\.flatten\(\[styles\.compactCard, \{ backgroundColor: theme\.card, borderColor: theme\.border \}, style\]\)\}>/,
    );
    assert.match(
      src,
      /<Pressable style=\{StyleSheet\.flatten\(\[styles\.card, \{ backgroundColor: theme\.card, borderColor: theme\.border \}, SHADOW_SOFT, style\]\)\}>/,
    );
  });

  it("the viewer renderItem passes the cell style directly — no wrapper View", () => {
    const src = readCollectionSrc();
    assert.match(src, /<ItemCard item=\{item\} compact style=\{styles\.masonryItem\} \/>/);
    assert.doesNotMatch(src, /<View style=\{styles\.masonryItem\}>/);
  });
});
