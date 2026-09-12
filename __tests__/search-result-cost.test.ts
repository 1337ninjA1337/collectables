import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { hasFiniteCost } from "@/lib/item-cost";
import { stripComments } from "@/lib/strip-comments";
import type { CollectableItem } from "@/lib/types";

import { readRepoFile } from "./helpers/repo-file";

/**
 * The search overlay's result row printed `item.cost` raw.
 *
 *   {item.cost ? ` · ${item.cost}` : ""}
 *
 * Three defects in one expression, and each is one the app had already fixed
 * somewhere else:
 *
 * A BARE NUMBER WITH NO CURRENCY. "1500" for an item priced in euros beside
 * "1500" for one priced in dollars, with nothing in the row able to tell them
 * apart — the defect the export round fixed in the PDF, on a surface a user
 * reads more often than any document.
 *
 * A TRUTHINESS CHECK WHERE THE APP HAS A GATE. `hasFiniteCost` exists because
 * six call sites were asking a weaker question, and its first documented case
 * is that zero and a negative are prices. `item.cost ?` hides a free item's
 * price and prints `Infinity` for a non-finite one — falsy and truthy landing
 * on opposite sides of the same bug.
 *
 * NO CONVERSION. Every other surface in the app converts into the viewer's
 * display currency and marks a real conversion with `≈`. This one showed the
 * stored number.
 */

const item = (over: Partial<CollectableItem> = {}): CollectableItem =>
  ({
    id: "i-1",
    collectionId: "c-1",
    title: "A thing",
    description: "",
    acquiredFrom: "",
    photos: [],
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  }) as CollectableItem;

describe("the shared gate answers what the truthiness check got wrong", () => {
  it("a cost of zero is a price", () => {
    // The row hid it: a free item is exactly the kind a collector searches for
    // by name and then wants the record of.
    assert.equal(hasFiniteCost(item({ cost: 0 })), true);
    assert.equal(Boolean(item({ cost: 0 }).cost), false);
  });

  it("a non-finite cost is not a price, and it IS truthy", () => {
    assert.equal(hasFiniteCost(item({ cost: Number.POSITIVE_INFINITY })), false);
    assert.equal(Boolean(item({ cost: Number.POSITIVE_INFINITY }).cost), true);
  });

  it("an absent cost is not a price either way", () => {
    assert.equal(hasFiniteCost(item()), false);
    assert.equal(hasFiniteCost(item({ cost: null })), false);
  });
});

describe("the search result row", () => {
  const SRC = readRepoFile("components/search-overlay.tsx");
  const BODY = stripComments(SRC);

  it("renders the cost through <CostBadge> rather than interpolating the field", () => {
    assert.match(BODY, /<CostBadge item=\{item\} style=\{styles\.rowMeta\} \/>/);
    assert.doesNotMatch(
      BODY,
      /\$\{item\.cost\}/,
      "a raw cost is a bare number with no currency beside it",
    );
  });

  it("gates the row on hasFiniteCost and not on truthiness", () => {
    assert.match(BODY, /hasFiniteCost\(item\)/);
    assert.doesNotMatch(BODY, /item\.cost \?/, "the weak check is back");
  });

  it("reaches the shared gate rather than spelling the finite check out", () => {
    // `lib/item-filters.ts` had the whole check written out beside the helper
    // that IS the check, which is the shape that makes a shared gate look
    // optional.
    assert.match(SRC, /import \{ hasFiniteCost \} from "@\/lib\/item-cost";/);
    assert.doesNotMatch(BODY, /Number\.isFinite/, "the gate is a helper, not a re-derivation");
  });

  it("the separator and the badge appear together or not at all", () => {
    // The old expression carried its separator inside the same conditional,
    // and that property is the one worth keeping: a `·` on a row with no cost
    // after it reads as a truncation.
    const branch = BODY.slice(BODY.indexOf("hasFiniteCost(item)"));
    const sep = branch.indexOf('{" · "}');
    const badge = branch.indexOf("<CostBadge");
    const close = branch.indexOf(") : null}");
    assert.ok(sep > 0 && badge > sep, "the separator must precede the badge inside one branch");
    assert.ok(close > badge, "both must sit inside the same conditional");
  });

  it("the badge takes the row's own text style", () => {
    // It renders a <Text> inside the meta <Text>; without the style it would
    // inherit the platform default rather than the row's 12px muted line.
    assert.match(BODY, /<CostBadge item=\{item\} style=\{styles\.rowMeta\} \/>/);
  });
});
