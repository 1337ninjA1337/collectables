import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { convertItemCost, hasFiniteCost } from "@/lib/item-cost";
import type { CollectableItem } from "@/lib/types";

import { readRepoFile } from "./helpers/repo-file";
import { sourceCode, tsxFiles } from "./helpers/source-files";

/**
 * The wishlist card printed a bare number where the price was.
 *
 * `{item.cost}` — the raw field, interpolated. A want priced in euros and one
 * priced in dollars both read "1500", with nothing in the row able to tell
 * them apart, on the one screen whose whole job is comparing prices the
 * collector has NOT paid yet. Every other cost surface in the app renders
 * `<CostBadge>`, which converts into the viewer's display currency, marks a
 * real conversion with `≈` and carries the stored original in its
 * accessibility label.
 *
 * IT IS THE SAME DEFECT THE SEARCH ROW CARRIED, found the same way: a sweep
 * after the round that fixed the other one. Two sites, two rounds, and each
 * was found by a person reading rather than by anything in the tree — which
 * is the argument for the sweep at the bottom of this file. The class is "a
 * screen that renders `.cost` itself", and a rule stated only in the surfaces
 * that follow it cannot name the one that does not.
 *
 * A WANT HAS NO COLLECTION, and that is what makes the item mode correct
 * here rather than merely available. `addWishlistItem` writes
 * `collectionId: ""`, so `getCollectionById` finds nothing and no collection
 * currency override applies — which is the right answer: a thing you do not
 * own is not in a collection yet, so the viewer's display currency is the
 * only currency the row can be about.
 */

const SRC = readRepoFile("app/wishlist.tsx");
const BODY = sourceCode("app/wishlist.tsx");

function want(over: Partial<CollectableItem> = {}): CollectableItem {
  return {
    id: "w1",
    collectionId: "",
    title: "Want",
    acquiredAt: "",
    acquiredFrom: "",
    description: "",
    variants: "",
    photos: [],
    createdBy: "You",
    createdByUserId: "u1",
    createdAt: "2026-09-12T00:00:00.000Z",
    cost: 1500,
    isWishlist: true,
    ...over,
  } as CollectableItem;
}

describe("the wishlist card's cost chip", () => {
  it("renders the shared badge and not the raw field", () => {
    assert.match(BODY, /import \{ CostBadge \} from "@\/components\/cost-badge";/);
    assert.match(BODY, /<CostBadge item=\{item\} style=\{styles\.metaChipText\} \/>/);
    assert.ok(!BODY.includes("{item.cost}"), "the raw field is still interpolated");
  });

  it("keeps the gate, because the pill is what must not render empty", () => {
    // <CostBadge> already returns null without a finite cost. The branch that
    // stays is the chip's View — a pill background around an empty string
    // reads as a rendering bug, which is the same branch-sharing the search
    // row settled between its separator and its badge.
    const row = BODY.indexOf("<View style={styles.metaRow}>");
    const gate = BODY.indexOf("hasFiniteCost(item) ? (", row);
    const chip = BODY.indexOf("<View style={styles.metaChip}>", row);
    const badge = BODY.indexOf("<CostBadge", row);
    assert.ok(gate > row, "the cost chip lost its gate");
    assert.ok(gate < chip && chip < badge, "the pill must sit inside the gate, around the badge");
  });

  it("asks hasFiniteCost and not a truthiness check", () => {
    // Zero and a negative are prices, and `Infinity` is not. A `item.cost ?`
    // would hide a free want and print a non-finite one — falsy and truthy
    // landing on opposite sides of the same bug.
    assert.ok(!BODY.includes("item.cost ?"), "a truthiness check is back");
    assert.match(BODY, /import \{ hasFiniteCost \} from "@\/lib\/item-cost";/);
  });

  it("does not rebuild the conversion pipeline on the screen", () => {
    // The adoption case every other <CostBadge> call site has: the point of a
    // shared renderer is that the screen stops knowing how money is rendered.
    assert.ok(!BODY.includes("convertItemCost"), "the screen converts by hand");
    assert.ok(!BODY.includes("formatCostAmount"), "the screen formats by hand");
    assert.ok(!BODY.includes("itemValueApprox"), "the screen marks conversions by hand");
  });

  it("is a block-level child of the pill, not nested inside a <Text>", () => {
    // The one property that separates this call site from the search row's,
    // which relies on React Native flattening a nested <Text> and gets a
    // tooltip in the middle of a sentence on web for its trouble.
    const chip = SRC.slice(SRC.indexOf("<View style={styles.metaChip}>"));
    const badge = chip.indexOf("<CostBadge");
    const text = chip.indexOf("<Text");
    assert.ok(badge > 0, "could not find the badge");
    assert.ok(text === -1 || text > badge, "the badge is wrapped in a <Text>");
  });
});

describe("what the badge can answer for a want", () => {
  const RATES = { USD: 1, EUR: 0.9 };

  it("a want carries no collection, so no override can apply", () => {
    // `addWishlistItem` writes an empty collectionId; the badge's
    // getCollectionById(item.collectionId) finds nothing and falls through to
    // the viewer's display currency. Pinned on the provider, because this is
    // the premise and not a coincidence.
    const PROVIDER = readRepoFile("lib/collections-context.tsx");
    const creator = PROVIDER.slice(
      PROVIDER.indexOf("addWishlistItem: async (input)"),
      PROVIDER.indexOf("promoteWishlistItem: async (itemId"),
    );
    assert.ok(creator.includes('collectionId: ""'), "a want now has a collection");
  });

  it("a want with no stored currency reads as the display currency", () => {
    // Not a conversion and not a guess: `convertItemCost` treats a missing
    // costCurrency as already-in-target, the same fallback the collection
    // totals use. So the chip gains a currency without inventing a rate.
    const conv = convertItemCost(want({ costCurrency: null }), "USD", RATES);
    assert.deepEqual(conv, { amount: 1500, currency: "USD", converted: true });
  });

  it("a want stored in another currency converts, and says so", () => {
    const conv = convertItemCost(want({ costCurrency: "EUR" }), "USD", RATES);
    assert.equal(conv.currency, "USD");
    assert.equal(conv.converted, true);
    assert.notEqual(conv.amount, 1500);
  });

  it("with no rate table it keeps the stored currency rather than mislabelling", () => {
    const conv = convertItemCost(want({ costCurrency: "EUR" }), "USD", null);
    assert.deepEqual(conv, { amount: 1500, currency: "EUR", converted: false });
  });

  it("a free want is a priced want", () => {
    assert.equal(hasFiniteCost(want({ cost: 0 })), true);
    assert.equal(hasFiniteCost(want({ cost: null })), false);
    assert.equal(hasFiniteCost(want({ cost: Number.POSITIVE_INFINITY })), false);
  });
});

describe("the sweep — no screen renders a cost itself", () => {
  /**
   * The class-catcher, and the reason this round is not the last one.
   *
   * Two surfaces printed a raw `.cost` and each was found by a person reading
   * the file after an unrelated round. A third would be found the same way,
   * eventually, on whatever screen nobody happened to open. So the rule stops
   * being a habit and becomes a scan: no file under `app/` or `components/`
   * puts a cost on screen except through `<CostBadge>` and the two modules
   * that implement it.
   *
   * Comments are stripped before matching, because `components/
   * search-overlay.tsx` explains its own fix by quoting the shape it replaced
   * — a rule that read the source text would fail on its own rationale, which
   * is a thing this repository has now done twice.
   */
  const ALLOWED = new Set([
    // The badge IS the renderer. Everything the rule is about lives here.
    "components/cost-badge.tsx",
  ]);

  it("nothing interpolates a cost field into JSX", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles("app", "components")) {
      if (ALLOWED.has(file)) continue;
      const code = sourceCode(file);
      // `{x.cost}` and `${x.cost}` — the two shapes both fixed sites had.
      for (const m of code.matchAll(/\{\s*\w+\.cost\s*\}/g)) {
        const line = code.slice(0, m.index).split("\n").length;
        offenders.push(`${file}:${line} ${m[0]}`);
      }
    }
    assert.deepEqual(offenders, [], `render these through <CostBadge>:\n${offenders.join("\n")}`);
  });

  it("the sweep can see an offender (guards it from passing vacuously)", () => {
    // The rule above passes on an empty tree just as happily as on a clean
    // one, and `tsxFiles` returning nothing is a failure mode the walk has
    // had before.
    const files = tsxFiles("app", "components");
    assert.ok(files.length > 40, `the walk found ${files.length} files`);
    assert.ok(files.includes("app/wishlist.tsx"), "the walk misses the screen this round fixed");
    assert.match("<Text>{item.cost}</Text>", /\{\s*\w+\.cost\s*\}/);
    assert.match("`· ${item.cost}`", /\{\s*\w+\.cost\s*\}/);
  });
});
