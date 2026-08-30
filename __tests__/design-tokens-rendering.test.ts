import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactElement } from "react";

import { autoUnmount, installNativeModuleStubs, render, styleOf, type RenderResult } from "./helpers/render";
import {
  SOFT_DESTRUCTIVE_FOREGROUND,
  SOFT_DESTRUCTIVE_SURFACE,
} from "@/lib/danger-surface";
import {
  AMBER_ACCENT,
  CARD_BG_10,
  DANGER_DEEP_4,
  DANGER_SOFT_2,
  HERO_DARK,
  MUTED_3,
  RADIUS_PILL,
  TEXT_ON_DARK_5,
} from "@/lib/design-tokens";
import type { ItemFilters } from "@/lib/item-filters";

installNativeModuleStubs();
// Ends every tree a case rendered, including the cases that fail early.
autoUnmount();

/**
 * RUNTIME design-token assertions: mount a component and compare the colour it
 * actually renders against the imported token constant.
 *
 * Every other token test in this repo scans source text — `assert.match(src,
 * /backgroundColor: CARD_BG_10/)`. That catches a hex literal creeping back
 * in, but it cannot catch a token applied to the wrong element, a style array
 * whose later entry overrides the token, or a conditional branch that renders
 * the unstyled variant. Those are exactly the regressions that compile fine
 * and skip visual review.
 *
 * The two halves are complementary, not redundant: the source scans stay as
 * the "no inline hex" guard (`npm run lint:hex` enforces that repo-wide), and
 * this file is the "and it reaches the screen" guard. New per-file token
 * migrations should add their runtime assertion here rather than starting
 * another suite.
 *
 * Mounting works through `__tests__/helpers/render.ts`; see that file for why
 * `react-native` and `@expo/vector-icons` have to be aliased and why the
 * component has to come in through a dynamic `import()`.
 */

async function mountFilterBar(
  overrides: Partial<ItemFilters> = {},
): Promise<{ tree: RenderResult; changes: ItemFilters[] }> {
  const { I18nProvider } = await import("@/lib/i18n-context");
  const { ItemFilterBar, EMPTY_FILTERS } = await import("@/components/item-filters");

  const changes: ItemFilters[] = [];
  const element = createElement(
    I18nProvider,
    null,
    createElement(ItemFilterBar, {
      filters: { ...EMPTY_FILTERS, ...overrides },
      onChange: (next: ItemFilters) => changes.push(next),
    }),
  ) as ReactElement;

  return { tree: render(element), changes };
}

/**
 * The reset chip is the only pale-red surface in the bar, which is what makes
 * it findable without a testID: every other chip is amber or dark brown. If a
 * future chip adopts the same surface this lookup goes ambiguous — and the
 * uniqueness assertion below is what will say so, rather than this quietly
 * matching the wrong one.
 */
function findResetChip(tree: RenderResult) {
  const matches = tree.findAll(
    (node) =>
      node.type === "Pressable" && styleOf(node).backgroundColor === SOFT_DESTRUCTIVE_SURFACE.backgroundColor,
  );
  assert.equal(matches.length, 1, `expected exactly one soft-destructive chip, got ${matches.length}`);
  return matches[0];
}

describe("<ItemFilterBar> — reset chip renders the danger tokens", () => {
  it("renders no reset chip at all when no filter is active", async () => {
    const { tree } = await mountFilterBar();
    const pale = tree.findAll(
      (node) => styleOf(node).backgroundColor === SOFT_DESTRUCTIVE_SURFACE.backgroundColor,
    );
    assert.deepEqual(pale, [], "the chip is the affordance for clearing — nothing to clear, no chip");
  });

  it("renders no reset chip for a whitespace-only query, which matches nothing", async () => {
    // `countActiveFilters` trims before counting and `applyItemFilters` treats
    // "   " as a no-op; this pins that the BAR agrees, so a stray space can
    // never offer a "Reset" that clears nothing.
    const { tree } = await mountFilterBar({ query: "   " });
    assert.deepEqual(
      tree.findAll(
        (node) => styleOf(node).backgroundColor === SOFT_DESTRUCTIVE_SURFACE.backgroundColor,
      ),
      [],
    );
  });

  it("paints the chip surface with CARD_BG_10 + DANGER_SOFT_2 when a filter is active", async () => {
    const { tree } = await mountFilterBar({ hasPhotos: true });
    const style = styleOf(findResetChip(tree));
    assert.equal(style.backgroundColor, CARD_BG_10);
    assert.equal(style.borderColor, DANGER_SOFT_2);
    assert.equal(style.borderWidth, 1);
  });

  it("paints the chip LABEL with DANGER_DEEP_4", async () => {
    const { tree } = await mountFilterBar({ hasPhotos: true });
    const chip = findResetChip(tree);
    const label = chip.children.find((child) => child.type === "Text");
    assert.ok(label, "the chip renders a <Text> label");
    assert.equal(styleOf(label).color, DANGER_DEEP_4);
  });

  it("paints the chip ICON with DANGER_DEEP_4 (the tint is a prop, not a stylesheet entry)", async () => {
    const { tree } = await mountFilterBar({ hasPhotos: true });
    const icon = findResetChip(tree).children.find((child) => child.type === "Ionicons");
    assert.ok(icon, "the chip renders an Ionicon");
    assert.equal(icon.props.color, DANGER_DEEP_4);
    assert.equal(icon.props.name, "close-circle");
  });

  it("routes both chip colours through lib/danger-surface, not a second copy of the trio", async () => {
    // If someone re-derives the surface from the raw tokens in one consumer
    // and edits `danger-surface.ts` in the other, this is the assertion that
    // notices — the rendered values must equal the SHARED constants, and the
    // shared constants must equal the tokens.
    assert.equal(SOFT_DESTRUCTIVE_FOREGROUND, DANGER_DEEP_4);
    assert.equal(SOFT_DESTRUCTIVE_SURFACE.backgroundColor, CARD_BG_10);
    assert.equal(SOFT_DESTRUCTIVE_SURFACE.borderColor, DANGER_SOFT_2);

    const { tree } = await mountFilterBar({ hasPhotos: true });
    const chip = findResetChip(tree);
    assert.equal(styleOf(chip).backgroundColor, SOFT_DESTRUCTIVE_SURFACE.backgroundColor);
    const label = chip.children.find((child) => child.type === "Text");
    assert.equal(styleOf(label!).color, SOFT_DESTRUCTIVE_FOREGROUND);
  });

  it("keeps the pill geometry on the chip and NOT in the shared surface", async () => {
    const { tree } = await mountFilterBar({ hasPhotos: true });
    const style = styleOf(findResetChip(tree));
    assert.equal(style.borderRadius, RADIUS_PILL);
    assert.equal(style.paddingHorizontal, 12);
    assert.equal(style.paddingVertical, 8);
    assert.ok(
      !("borderRadius" in SOFT_DESTRUCTIVE_SURFACE),
      "geometry in the shared surface would resize <DangerSection tone=\"soft\"> too",
    );
  });

  it("clears every filter when pressed — the chip is wired, not decorative", async () => {
    const { tree, changes } = await mountFilterBar({ hasPhotos: true, query: "penny" });
    tree.press(findResetChip(tree));
    assert.equal(changes.length, 1);
    assert.equal(changes[0].hasPhotos, false);
    assert.equal(changes[0].query, "");
    assert.equal(changes[0].sort, "default");
  });
});

describe("<ItemFilterBar> — the rest of the chip row renders its tokens", () => {
  it("swaps the filter button to HERO_DARK + TEXT_ON_DARK_5 once a filter is active", async () => {
    const idle = await mountFilterBar();
    const idleButton = idle.tree.findByType("Pressable");
    assert.notEqual(styleOf(idleButton).backgroundColor, HERO_DARK);
    assert.equal(idle.tree.findByType("Ionicons").props.color, MUTED_3);

    const active = await mountFilterBar({ hasPhotos: true });
    const activeButton = active.tree.findByType("Pressable");
    assert.equal(styleOf(activeButton).backgroundColor, HERO_DARK);
    assert.equal(active.tree.findByType("Ionicons").props.color, TEXT_ON_DARK_5);
  });

  it("renders the query chip in AMBER_ACCENT with the TRIMMED needle", async () => {
    const { tree } = await mountFilterBar({ query: "  penny  " });
    const chip = tree.find(
      (node) => node.type === "Pressable" && styleOf(node).maxWidth === 180,
    );
    assert.equal(styleOf(chip).backgroundColor, AMBER_ACCENT);
    const label = chip.children.find((child) => child.type === "Text");
    assert.equal(label?.children[0]?.text, "penny", "the chip must show what actually matches");
    assert.equal(styleOf(label!).color, TEXT_ON_DARK_5);
  });

  it("renders the sort chip in AMBER_ACCENT only for a non-default sort", async () => {
    // The sort chip is the amber pill with no `maxWidth` — the query chip caps
    // itself at 180 so an unbounded needle cannot push the row off-screen.
    const isSortChip = (node: { type: string; props: Record<string, unknown> }) =>
      node.type === "Pressable" &&
      styleOf(node as never).backgroundColor === AMBER_ACCENT &&
      styleOf(node as never).maxWidth === undefined;

    const defaulted = await mountFilterBar();
    assert.deepEqual(
      defaulted.tree.findAll(isSortChip),
      [],
      "`sort: default` is the absence of a sort — nothing to surface or clear",
    );

    const { tree } = await mountFilterBar({ sort: "name-asc" });
    const sortChip = tree.find(isSortChip);
    assert.equal(styleOf(sortChip).borderRadius, RADIUS_PILL);
    // Mode icon on the left, close-circle on the right.
    assert.equal(sortChip.children.filter((child) => child.type === "Ionicons").length, 2);
    assert.equal(sortChip.children.at(-1)?.props.name, "close-circle");
  });

  it("keeps the closed filter sheet out of the tree, so these queries see the bar only", async () => {
    const { tree } = await mountFilterBar({ hasPhotos: true });
    const modal = tree.findByType("Modal");
    assert.equal(modal.props.visible, false);
    assert.deepEqual(modal.children, [], "a shut Modal mounts nothing on any platform");
  });
});
