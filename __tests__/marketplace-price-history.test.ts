import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PRICE_HISTORY_SIMILARITY_THRESHOLD,
  priceHistoryForTitle,
  titleSimilarity,
} from "@/lib/marketplace-helpers";
import { MarketplaceListing } from "@/lib/types";
import { localeKeys } from "@/lib/i18n-source";
import { readI18nSource } from "./helpers/i18n-source-file";
import { locales } from "./helpers/i18n-locales";
import { readRepoFile as read } from "./helpers/repo-file";

function listing(overrides: Partial<MarketplaceListing> = {}): MarketplaceListing {
  return {
    id: "l-" + Math.random().toString(36).slice(2, 8),
    itemId: "item-1",
    ownerUserId: "alice",
    mode: "sell",
    askingPrice: 100,
    currency: "USD",
    notes: "",
    createdAt: "2026-04-25T10:00:00.000Z",
    soldAt: null,
    buyerUserId: null,
    arrivedAt: null,
    ...overrides,
  };
}

describe("titleSimilarity threshold edge cases", () => {
  it("treats casing differences as identical", () => {
    assert.equal(titleSimilarity("CHARIZARD", "charizard"), 1);
  });

  it("treats trailing punctuation as identical normalized titles", () => {
    assert.equal(titleSimilarity("Charizard!", "Charizard"), 1);
  });

  it("just-below-threshold pairs are filtered out", () => {
    // Different but partially overlapping should not pass the 0.9 cutoff.
    const sim = titleSimilarity("Charizard Holo", "Blastoise Holo");
    assert.ok(
      sim < PRICE_HISTORY_SIMILARITY_THRESHOLD,
      `expected < ${PRICE_HISTORY_SIMILARITY_THRESHOLD}, got ${sim}`,
    );
  });

  it("returns 0 when both inputs normalize to empty strings", () => {
    assert.equal(titleSimilarity("...", "!!!"), 0);
  });
});

describe("priceHistoryForTitle additional edge cases", () => {
  function withItemTitles(map: Record<string, string>) {
    return (id: string) => map[id] ?? null;
  }

  it("returns an empty array when no item titles match", () => {
    const ls = [listing({ itemId: "x", askingPrice: 50 })];
    const out = priceHistoryForTitle(
      "Totally different",
      ls,
      withItemTitles({ x: "Random Other Title XYZ" }),
    );
    assert.deepEqual(out, []);
  });

  it("skips listings whose item title can't be resolved", () => {
    const ls = [listing({ id: "L", itemId: "missing", askingPrice: 50 })];
    const out = priceHistoryForTitle("Anything", ls, () => null);
    assert.deepEqual(out, []);
  });

  it("returns the similarity score on each entry", () => {
    const ls = [listing({ id: "L", itemId: "i", askingPrice: 50 })];
    const out = priceHistoryForTitle(
      "Charizard Holo",
      ls,
      withItemTitles({ i: "Charizard Holo" }),
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].similarity, 1);
  });

  it("default limit of 10 caps the result set", () => {
    const ls: MarketplaceListing[] = [];
    for (let i = 0; i < 15; i++) {
      ls.push(
        listing({
          id: `L${i}`,
          itemId: `i${i}`,
          askingPrice: 10 + i,
          createdAt: `2026-04-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`,
        }),
      );
    }
    const titles: Record<string, string> = {};
    ls.forEach((_, i) => (titles[`i${i}`] = "Same Title"));
    const out = priceHistoryForTitle("Same Title", ls, (id) => titles[id] ?? null);
    assert.equal(out.length, 10);
  });
});

describe("listing detail: price history wiring", () => {
  it("renders the price-history section using the helper", () => {
    const src = read("app/listing/[id].tsx");
    assert.match(src, /priceHistoryForTitle/);
    assert.match(src, /marketplacePriceHistoryLabel/);
    // `listing?.id`, not `listing.id`: the hook moved above the screen's
    // `if (!listing)` early return on 2026-09-27, because sitting below it
    // meant a render with two more hooks than the one before it as soon as a
    // deep-linked listing's fetch landed — which React throws on. The
    // exclusion is still the listing this screen is showing history FOR;
    // there is simply nothing to exclude before it arrives.
    assert.match(src, /excludeListingId:\s*listing\?\.id/);
    // Limit must default to (or pass) 10 per spec.
    assert.match(src, /limit:\s*10/);
  });

  it("reads the reference title INSIDE the memo rather than hoisting it above", () => {
    // The whole of `react-hooks/preserve-manual-memoization`'s one finding in
    // this tree, read on 2026-10-03.
    //
    // The title used to be `const referenceTitle = item?.title ?? ""` on the
    // line above, with `referenceTitle` in the dependency list. `item` is the
    // return of `getItemById`, a context function the React Compiler cannot
    // look inside, so it could not prove the hoisted value would not be
    // mutated after the memo read it — and its answer to that is not a warning
    // on the memo, it is declining to compile the component at all. One
    // hoisted string cost a 763-line screen its optimization.
    //
    // Read inside the factory the value never outlives the call, and the
    // dependency is `item` itself. This case is here because the hoist is
    // exactly the shape a tidy-up re-introduces: a `const` used once, pulled
    // up to sit beside the other derived values.
    const src = read("app/listing/[id].tsx");
    //
    // Two spaces of indent is the component's own body; four is inside the
    // factory. The hoisted declaration is the one at two.
    assert.doesNotMatch(
      src,
      /^ {2}const referenceTitle = /m,
      "referenceTitle belongs inside the useMemo factory — hoisted, the compiler skips the whole screen",
    );
    assert.match(src, /useMemo\(\(\) => \{\s*\n\s*const referenceTitle = item\?\.title \?\? "";/);
    // The dependency list keys on `item`, not on a string derived from it.
    assert.match(src, /\}, \[item, listings, getItemById, listing\?\.id\]\);/);
  });

  it("declares price-history translations in every language map", () => {
    const src = readI18nSource();
    const requiredKeys = [
      "marketplacePriceHistoryLabel",
      "marketplacePriceHistoryHint",
    ];
    for (const lang of locales(src)) {
      const declared = localeKeys(src, lang);
      for (const key of requiredKeys) {
        assert.ok(
          declared.has(key),
          `language '${lang}' missing key '${key}'`,
        );
      }
    }
  });
});
