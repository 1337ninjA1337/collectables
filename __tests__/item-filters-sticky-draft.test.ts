import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactElement } from "react";

import { autoUnmount, installNativeModuleStubs, render, styleOf, type RenderResult, type TestNode } from "./helpers/render";
import { HERO_DARK } from "@/lib/design-tokens";
import type { ItemFilters } from "@/lib/item-filters";

installNativeModuleStubs();
// Ends every tree a case rendered, including the cases that fail early.
autoUnmount();

/**
 * The filter sheet's draft is sticky across open/close.
 *
 * It used to reset to the current `filters` on every `openModal()`. That is
 * fine when the sheet is dismissed with Apply, and lossy every other way: a
 * user who typed half a price range and then tapped the backdrop (a big target
 * wrapping a small sheet — easy to hit by accident) lost the input, and the
 * sheet reopened showing the PRE-EDIT filters, so nothing on screen suggested
 * anything had been typed.
 *
 * The replacement syncs the draft on a `filters` change instead, which keeps
 * the two failure modes apart: an edit the user abandoned is preserved, and an
 * edit invalidated by the state moving underneath it (reset chip, quick chip,
 * sort/query chip clear) is discarded. Both halves are asserted below.
 */

async function mount(initial: Partial<ItemFilters> = {}) {
  const { I18nProvider } = await import("@/lib/i18n-context");
  const { ItemFilterBar, EMPTY_FILTERS } = await import("@/components/item-filters");

  let filters: ItemFilters = { ...EMPTY_FILTERS, ...initial };
  const element = () =>
    createElement(
      I18nProvider,
      null,
      createElement(ItemFilterBar, {
        filters,
        onChange: (next: ItemFilters) => {
          filters = next;
        },
      }),
    ) as ReactElement;

  const tree = render(element());

  return {
    tree,
    get filters() {
      return filters;
    },
    /** Re-renders with whatever `onChange` last wrote — what the parent does. */
    flush() {
      tree.rerender(element());
    },
  };
}

/** The "Filters"/"Filters (n)" button that opens the sheet. */
function filterButton(tree: RenderResult): TestNode {
  return tree.findByType("Pressable");
}

function sheet(tree: RenderResult): TestNode {
  return tree.findByType("Modal");
}

/** Every text field in the sheet, in declaration order. */
function fields(tree: RenderResult): TestNode[] {
  return tree.findAllByType("TextInput");
}

function priceFromField(tree: RenderResult): TestNode {
  const [, priceFrom] = fields(tree);
  assert.ok(priceFrom, "the sheet renders a price-from field after the search row");
  return priceFrom;
}

function type(tree: RenderResult, field: TestNode, text: string): void {
  const onChangeText = field.props.onChangeText as ((value: string) => void) | undefined;
  assert.ok(onChangeText, "the field must be controlled");
  onChangeText(text);
  tree.rerender();
}

/**
 * The Apply button — the sheet's only full-width dark CTA. Matched by style
 * rather than by label so the test does not depend on the active locale.
 */
function applyButton(tree: RenderResult): TestNode {
  return tree.find(
    (node) => node.type === "Pressable" && styleOf(node).backgroundColor === HERO_DARK && styleOf(node).flex === 1,
  );
}

/** The backdrop is the outer Pressable inside the Modal. */
function tapBackdrop(tree: RenderResult): void {
  const backdrop = sheet(tree).children[0];
  assert.equal(backdrop.type, "Pressable", "the sheet's first child is the dismiss backdrop");
  tree.press(backdrop);
}

describe("<ItemFilterBar> — the draft survives a backdrop dismiss", () => {
  it("keeps half-typed input when the sheet is dismissed without applying", async () => {
    const app = await mount();

    app.tree.press(filterButton(app.tree));
    assert.equal(sheet(app.tree).props.visible, true);

    type(app.tree, priceFromField(app.tree), "12");
    tapBackdrop(app.tree);
    assert.equal(sheet(app.tree).props.visible, false);

    // Nothing was applied — the parent's filters are untouched.
    assert.equal(app.filters.priceFrom, "");

    app.tree.press(filterButton(app.tree));
    assert.equal(
      priceFromField(app.tree).props.value,
      "12",
      "reopening must show what the user typed, not the pre-edit filters",
    );
  });

  it("applies the preserved draft when the sheet is reopened and Apply is pressed", async () => {
    const app = await mount();

    app.tree.press(filterButton(app.tree));
    type(app.tree, priceFromField(app.tree), "12");
    tapBackdrop(app.tree);

    app.tree.press(filterButton(app.tree));
    app.tree.press(applyButton(app.tree));

    assert.equal(app.filters.priceFrom, "12");
  });
});

describe("<ItemFilterBar> — the draft resyncs when filters move outside the sheet", () => {
  it("discards a stale draft after the reset chip clears everything", async () => {
    const app = await mount({ hasPhotos: true });

    app.tree.press(filterButton(app.tree));
    type(app.tree, priceFromField(app.tree), "99");
    tapBackdrop(app.tree);

    // The reset chip writes EMPTY_FILTERS through onChange.
    const resetChip = app.tree.find(
      (node) => node.type === "Pressable" && node.props.accessibilityRole === "button" &&
        node.children.some((child) => child.props.name === "close-circle"),
    );
    app.tree.press(resetChip);
    app.flush();

    app.tree.press(filterButton(app.tree));
    assert.equal(
      priceFromField(app.tree).props.value,
      "",
      "an edit of a filter set that no longer exists must not reappear",
    );
  });

  it("discards a stale draft after a quick chip toggles a filter", async () => {
    const app = await mount();

    app.tree.press(filterButton(app.tree));
    type(app.tree, priceFromField(app.tree), "99");
    tapBackdrop(app.tree);

    // The "has photos" quick chip is the second Pressable in the bar.
    const quickChip = app.tree.findAllByType("Pressable")[1];
    app.tree.press(quickChip);
    app.flush();
    assert.equal(app.filters.hasPhotos, true);

    app.tree.press(filterButton(app.tree));
    assert.equal(priceFromField(app.tree).props.value, "");
    assert.equal(
      app.tree.findAll((node) => node.props.name === "checkbox").length,
      1,
      "the resynced draft must show the filter the chip just set",
    );
  });

  it("opens showing the applied filters on a first open, with no edit in flight", async () => {
    const app = await mount({ priceFrom: "5", source: "eBay" });

    app.tree.press(filterButton(app.tree));
    assert.equal(priceFromField(app.tree).props.value, "5");
  });
});
