import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactElement } from "react";

import { autoUnmount, installNativeModuleStubs, render, styleOf, type RenderResult, type TestNode } from "./helpers/render";
import { HERO_DARK } from "@/lib/design-tokens";
import { PRICE_RANGE_ERROR_I18N_KEY, type ItemFilters } from "@/lib/item-filters";

installNativeModuleStubs();
// Ends every tree a case rendered, including the cases that fail early.
autoUnmount();

/**
 * Apply is gated on `validatePriceRange`.
 *
 * The pure truth table lives in `item-filters-price-range.test.ts`; what this
 * file pins is the WIRING — that an invalid draft cannot leave the sheet, that
 * the user is told why, and that Reset stays reachable so the block is never
 * a dead end. The last one is the whole reason the gate needed a test: the
 * draft is sticky, so a disabled Apply with no escape hatch would strand a
 * user in a sheet they cannot dismiss into a working state.
 */

async function mount(initial: Partial<ItemFilters> = {}) {
  const { I18nProvider } = await import("@/lib/i18n-context");
  const { ItemFilterBar, EMPTY_FILTERS } = await import("@/components/item-filters");

  let filters: ItemFilters = { ...EMPTY_FILTERS, ...initial };
  let changes = 0;
  const element = () =>
    createElement(
      I18nProvider,
      null,
      createElement(ItemFilterBar, {
        filters,
        onChange: (next: ItemFilters) => {
          filters = next;
          changes += 1;
        },
      }),
    ) as ReactElement;

  const tree = render(element());

  return {
    tree,
    get filters() {
      return filters;
    },
    get changes() {
      return changes;
    },
    flush() {
      tree.rerender(element());
    },
  };
}

function filterButton(tree: RenderResult): TestNode {
  return tree.findByType("Pressable");
}

function fields(tree: RenderResult): TestNode[] {
  return tree.findAllByType("TextInput");
}

/** Search row first, then price-from, price-to, date-from, date-to, source. */
function priceField(tree: RenderResult, end: "from" | "to"): TestNode {
  const field = fields(tree)[end === "from" ? 1 : 2];
  assert.ok(field, `the sheet renders a price-${end} field`);
  return field;
}

function type(tree: RenderResult, field: TestNode, text: string): void {
  const onChangeText = field.props.onChangeText as ((value: string) => void) | undefined;
  assert.ok(onChangeText, "the field must be controlled");
  onChangeText(text);
  tree.rerender();
}

/** The full-width dark CTA. Matched by style so the test is locale-agnostic. */
function applyButton(tree: RenderResult): TestNode {
  return tree.find(
    (node) =>
      node.type === "Pressable" &&
      styleOf(node).backgroundColor === HERO_DARK &&
      styleOf(node).flex === 1,
  );
}

/** The sheet's Reset — the only other Pressable in the actions row. */
function sheetResetButton(tree: RenderResult): TestNode {
  return tree.find(
    (node) => node.type === "Pressable" && styleOf(node).paddingHorizontal === 20,
  );
}

/** Search row, price from/to, date from/to, source. */
function dateField(tree: RenderResult, end: "from" | "to"): TestNode {
  const field = fields(tree)[end === "from" ? 3 : 4];
  assert.ok(field, `the sheet renders a date-${end} field`);
  return field;
}

/** Every inline error slot currently rendered, in document order. */
function errorLines(tree: RenderResult): TestNode[] {
  return tree.findAll((node) => node.props.role === "alert");
}

/** The first inline error line, or null when every range is valid. */
function errorLine(tree: RenderResult): TestNode | null {
  return errorLines(tree)[0] ?? null;
}

function textOf(node: TestNode): string {
  return node.children
    .filter((child) => child.type === "#text")
    .map((child) => child.text ?? "")
    .join("");
}

async function openWith(from: string, to: string) {
  const app = await mount();
  app.tree.press(filterButton(app.tree));
  if (from) type(app.tree, priceField(app.tree, "from"), from);
  if (to) type(app.tree, priceField(app.tree, "to"), to);
  return app;
}

describe("<ItemFilterBar> — Apply is disabled on an invalid price range", () => {
  it("enables Apply for a valid range and applies it", async () => {
    const app = await openWith("10", "20");

    assert.equal(applyButton(app.tree).props.disabled, false);
    assert.equal(errorLine(app.tree), null, "a valid range shows no error line");

    app.tree.press(applyButton(app.tree));
    assert.equal(app.filters.priceFrom, "10");
    assert.equal(app.filters.priceTo, "20");
  });

  it("disables Apply on an inverted range", async () => {
    const app = await openWith("20", "10");
    assert.equal(applyButton(app.tree).props.disabled, true);
  });

  it("disables Apply on a bound that is not a number", async () => {
    const app = await openWith("abc", "");
    assert.equal(applyButton(app.tree).props.disabled, true);
  });

  it("disables Apply on a negative bound", async () => {
    const app = await openWith("-5", "");
    assert.equal(applyButton(app.tree).props.disabled, true);
  });

  it("does not write an invalid range through onChange even if apply() is reached", async () => {
    const app = await openWith("20", "10");

    // Calling the handler directly is the path `disabled` does not cover — a
    // hardware-keyboard submit, or a future call site rewiring the button.
    const onPress = applyButton(app.tree).props.onPress as () => void;
    onPress();

    assert.equal(app.changes, 0, "nothing may be committed while the range is invalid");
    assert.equal(app.filters.priceFrom, "");
  });

  it("keeps the sheet open when a blocked apply is attempted", async () => {
    const app = await openWith("20", "10");
    (applyButton(app.tree).props.onPress as () => void)();
    app.tree.rerender();

    assert.equal(
      app.tree.findByType("Modal").props.visible,
      true,
      "closing on a blocked apply would hide the error that explains the block",
    );
  });

  it("re-enables Apply as soon as the range is corrected", async () => {
    const app = await openWith("20", "10");
    assert.equal(applyButton(app.tree).props.disabled, true);

    type(app.tree, priceField(app.tree, "to"), "30");
    assert.equal(applyButton(app.tree).props.disabled, false);

    app.tree.press(applyButton(app.tree));
    assert.equal(app.filters.priceTo, "30");
  });

  it("marks the disabled state in the accessibility tree, not only visually", async () => {
    const app = await openWith("20", "10");
    const button = applyButton(app.tree);
    assert.equal(button.props.accessibilityRole, "button");
    assert.deepEqual(button.props.accessibilityState, { disabled: true });
    assert.ok(styleOf(button).opacity !== undefined, "the disabled CTA is dimmed");
  });

  it("leaves Reset enabled so a blocked draft is never a dead end", async () => {
    const app = await openWith("20", "10");

    const reset = sheetResetButton(app.tree);
    assert.notEqual(reset.props.disabled, true);

    app.tree.press(reset);
    app.flush();

    assert.equal(app.filters.priceFrom, "");
    assert.equal(app.filters.priceTo, "");
    assert.equal(app.tree.findByType("Modal").props.visible, false);
  });
});

describe("<ItemFilterBar> — the inline error names the failure", () => {
  it("shows a message for each failure mode, and a different one per mode", async () => {
    const cases: [string, string][] = [
      ["20", "10"],
      ["abc", ""],
      ["", "abc"],
      ["-5", ""],
    ];
    const messages: string[] = [];

    for (const [from, to] of cases) {
      const app = await openWith(from, to);
      const line = errorLine(app.tree);
      assert.ok(line, `${from}/${to} must render an error line`);
      const message = textOf(line);
      assert.ok(message.length > 0, `${from}/${to} rendered an empty error line`);
      // A raw i18n key on screen means the key was never translated.
      assert.ok(
        !(Object.values(PRICE_RANGE_ERROR_I18N_KEY) as string[]).includes(message),
        `${from}/${to} rendered the i18n KEY instead of its translation`,
      );
      messages.push(message);
    }

    const [inverted, fromBad, toBad, negative] = messages;
    assert.notEqual(inverted, fromBad);
    assert.notEqual(fromBad, toBad, "the two ends must not share one 'is not a number' string");
    assert.notEqual(inverted, negative);
  });

  it("clears the error line once the range becomes valid again", async () => {
    const app = await openWith("20", "10");
    assert.ok(errorLine(app.tree));

    type(app.tree, priceField(app.tree, "to"), "");
    assert.equal(errorLine(app.tree), null, "an unset bound is a half-open range, not an error");
  });

  it("shows no error for the empty sheet a user opens for the first time", async () => {
    const app = await mount();
    app.tree.press(filterButton(app.tree));

    assert.equal(errorLine(app.tree), null);
    assert.equal(applyButton(app.tree).props.disabled, false);
  });

  it("announces the error politely rather than interrupting on every keystroke", async () => {
    const app = await openWith("20", "10");
    assert.equal(errorLine(app.tree)?.props.accessibilityLiveRegion, "polite");
  });
});

describe("<ItemFilterBar> — Apply is disabled on an invalid date range too", () => {
  async function openDates(from: string, to: string) {
    const app = await mount();
    app.tree.press(filterButton(app.tree));
    if (from) type(app.tree, dateField(app.tree, "from"), from);
    if (to) type(app.tree, dateField(app.tree, "to"), to);
    return app;
  }

  it("enables Apply for a valid range and applies it", async () => {
    const app = await openDates("2024-01-01", "2024-12-31");
    assert.equal(applyButton(app.tree).props.disabled, false);
    assert.equal(errorLine(app.tree), null);

    app.tree.press(applyButton(app.tree));
    assert.equal(app.filters.dateFrom, "2024-01-01");
  });

  it("accepts an unpadded date rather than blocking on it", async () => {
    // Normalisation happens in the matcher, not the field, so what the user
    // typed is what stays on screen and in `filters`.
    const app = await openDates("2024-1-1", "");
    assert.equal(applyButton(app.tree).props.disabled, false);

    app.tree.press(applyButton(app.tree));
    assert.equal(app.filters.dateFrom, "2024-1-1");
  });

  it("disables Apply on an inverted, unparseable or impossible date", async () => {
    for (const [from, to] of [
      ["2024-12-31", "2024-01-01"],
      ["tomorrow", ""],
      ["2024-02-30", ""],
      ["", "01/02/2024"],
    ] as [string, string][]) {
      const app = await openDates(from, to);
      assert.equal(
        applyButton(app.tree).props.disabled,
        true,
        `${from || "∅"} → ${to || "∅"} must block Apply`,
      );
      assert.ok(errorLine(app.tree), `${from || "∅"} → ${to || "∅"} must explain the block`);
    }
  });

  it("shows both slots at once when the price AND the date range are wrong", async () => {
    const app = await mount();
    app.tree.press(filterButton(app.tree));
    type(app.tree, priceField(app.tree, "from"), "20");
    type(app.tree, priceField(app.tree, "to"), "10");
    type(app.tree, dateField(app.tree, "from"), "tomorrow");

    // One slot per range, each under its own row, so fixing one does not
    // swap the other's message out from under the user.
    assert.equal(errorLines(app.tree).length, 2);
    assert.equal(applyButton(app.tree).props.disabled, true);
  });

  it("stays blocked while the OTHER range is still invalid", async () => {
    const app = await mount();
    app.tree.press(filterButton(app.tree));
    type(app.tree, priceField(app.tree, "from"), "20");
    type(app.tree, priceField(app.tree, "to"), "10");
    type(app.tree, dateField(app.tree, "from"), "tomorrow");

    type(app.tree, priceField(app.tree, "to"), "30");
    assert.equal(errorLines(app.tree).length, 1, "the price error is gone");
    assert.equal(applyButton(app.tree).props.disabled, true, "the date error still blocks");

    type(app.tree, dateField(app.tree, "from"), "2024-01-01");
    assert.equal(errorLines(app.tree).length, 0);
    assert.equal(applyButton(app.tree).props.disabled, false);
  });

  it("does not commit an invalid date range through the direct onPress path", async () => {
    const app = await openDates("2024-12-31", "2024-01-01");
    (applyButton(app.tree).props.onPress as () => void)();
    assert.equal(app.changes, 0);
  });
});

describe("<ItemFilterBar> — the sticky draft interacts with the gate", () => {
  it("still shows the error after the sheet is dismissed and reopened", async () => {
    // The draft survives a backdrop tap, so the invalid range comes back —
    // and so must the explanation for why Apply is dead.
    const app = await openWith("20", "10");

    const backdrop = app.tree.findByType("Modal").children[0];
    app.tree.press(backdrop);
    assert.equal(app.tree.findByType("Modal").props.visible, false);

    app.tree.press(filterButton(app.tree));
    assert.equal(priceField(app.tree, "from").props.value, "20");
    assert.ok(errorLine(app.tree), "the reopened sheet must still explain the block");
    assert.equal(applyButton(app.tree).props.disabled, true);
  });

  it("does not block Apply for a range that only touches the untouched fields", async () => {
    const app = await mount();
    app.tree.press(filterButton(app.tree));

    type(app.tree, fields(app.tree)[5], "eBay");
    assert.equal(applyButton(app.tree).props.disabled, false);

    app.tree.press(applyButton(app.tree));
    assert.equal(app.filters.source, "eBay");
  });
});
