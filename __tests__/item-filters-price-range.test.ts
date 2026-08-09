import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  applyItemFilters,
  EMPTY_FILTERS,
  parsePriceBound,
  PRICE_RANGE_ERROR_I18N_KEY,
  validatePriceRange,
  type ItemFilters,
  type PriceRangeError,
} from "@/lib/item-filters";
import type { CollectableItem } from "@/lib/types";

/**
 * The price range accepted anything the user could type and failed silently
 * in two different directions:
 *
 *  - a bound that does not parse is SKIPPED by `applyItemFilters` while still
 *    being counted by `countActiveFilters`, so the bar reads "Filters (1)"
 *    over a list nothing was filtered out of;
 *  - an inverted range (`from > to`) parses fine and matches no item at all,
 *    so the collection renders empty with nothing explaining why.
 *
 * `validatePriceRange` names both, and `parsePriceBound` is now the single
 * parser BOTH the validator and `applyItemFilters` use — the invariant that
 * matters, since a sheet that validated "12,50" as 12.5 while the matcher
 * read it as 12 would be worse than no validation at all.
 */

function item(title: string, cost: number | null): CollectableItem {
  return {
    id: title.toLowerCase().replace(/\s+/g, "-"),
    collectionId: "c1",
    title,
    cost: cost ?? undefined,
    acquiredAt: "",
    acquiredFrom: "",
    description: "",
    variants: "",
    photos: [],
    createdBy: "u1",
    createdByUserId: "u1",
    createdAt: "2026-05-23",
  };
}

function withPrice(priceFrom: string, priceTo: string): ItemFilters {
  return { ...EMPTY_FILTERS, priceFrom, priceTo };
}

describe("parsePriceBound", () => {
  it("treats an unset bound as empty rather than an error", () => {
    // A half-open range is the normal case — "from 10, no ceiling".
    for (const raw of ["", "   ", "\t"]) {
      assert.deepEqual(parsePriceBound(raw), { value: null, error: "empty" });
    }
  });

  it("parses plain and decimal amounts", () => {
    assert.deepEqual(parsePriceBound("12"), { value: 12, error: null });
    assert.deepEqual(parsePriceBound("12.5"), { value: 12.5, error: null });
    assert.deepEqual(parsePriceBound("  7 "), { value: 7, error: null });
    assert.deepEqual(parsePriceBound(".5"), { value: 0.5, error: null });
    assert.deepEqual(parsePriceBound("12."), { value: 12, error: null });
  });

  it("accepts zero — a filter bound of 0 means 'from free', unlike a listing price", () => {
    assert.deepEqual(parsePriceBound("0"), { value: 0, error: null });
    assert.deepEqual(parsePriceBound("0.00"), { value: 0, error: null });
  });

  it("reads the comma decimal separator five of six locales write", () => {
    // `parseFloat("12,50")` is 12 — the filter applies, just at the wrong
    // price, which is the failure mode nobody reports because it looks like
    // it worked.
    assert.deepEqual(parsePriceBound("12,50"), { value: 12.5, error: null });
  });

  it("rejects text, trailing junk and the shapes Number would silently coerce", () => {
    for (const raw of ["abc", "12abc", "$12", "12 50", "1.2.3", "-", ".", "1e3", "0x10", "1_000"]) {
      assert.deepEqual(
        parsePriceBound(raw),
        { value: null, error: "unparseable" },
        `${JSON.stringify(raw)} must not become a number`,
      );
    }
  });

  it("separates a negative bound from an unparseable one", () => {
    // Worth its own reason: "-5" IS a number, it is just not a price, and
    // "must be a number" would be a confusing thing to tell that user.
    assert.deepEqual(parsePriceBound("-5"), { value: null, error: "negative" });
    assert.deepEqual(parsePriceBound("-0.5"), { value: null, error: "negative" });
  });

  it("treats negative zero as zero, not as a negative bound", () => {
    assert.deepEqual(parsePriceBound("-0"), { value: -0, error: null });
  });
});

describe("validatePriceRange", () => {
  it("accepts an empty range and every half-open range", () => {
    assert.equal(validatePriceRange("", ""), null);
    assert.equal(validatePriceRange("10", ""), null);
    assert.equal(validatePriceRange("", "10"), null);
  });

  it("accepts a well-ordered range, including the degenerate equal one", () => {
    assert.equal(validatePriceRange("10", "20"), null);
    assert.equal(validatePriceRange("10", "10"), null);
    assert.equal(validatePriceRange("0", "0"), null);
    assert.equal(validatePriceRange("1,5", "2,5"), null);
  });

  it("names which end failed to parse", () => {
    assert.equal(validatePriceRange("abc", ""), "from_unparseable");
    assert.equal(validatePriceRange("", "abc"), "to_unparseable");
  });

  it("names which end is negative", () => {
    assert.equal(validatePriceRange("-5", ""), "from_negative");
    assert.equal(validatePriceRange("", "-5"), "to_negative");
  });

  it("reports the 'from' end first when both are bad", () => {
    // The sheet has one inline slot; reporting the first field in reading
    // order keeps the message next to the field the user is likely in.
    assert.equal(validatePriceRange("abc", "xyz"), "from_unparseable");
    assert.equal(validatePriceRange("-1", "xyz"), "from_negative");
  });

  it("prefers a parse failure over the inversion it would otherwise imply", () => {
    // "abc" has no value to compare, so calling this "inverted" would be a
    // guess. The parse error is the actionable one.
    assert.equal(validatePriceRange("abc", "5"), "from_unparseable");
    assert.equal(validatePriceRange("50", "abc"), "to_unparseable");
  });

  it("rejects an inverted range — the state that matches nothing at all", () => {
    assert.equal(validatePriceRange("20", "10"), "inverted");
    assert.equal(validatePriceRange("0.51", "0.5"), "inverted");
  });

  it("compares the range numerically, not lexicographically", () => {
    // String comparison would call "9" > "10" an inversion and let
    // "100" < "9" through — both wrong.
    assert.equal(validatePriceRange("9", "10"), null);
    assert.equal(validatePriceRange("100", "9"), "inverted");
  });
});

describe("PRICE_RANGE_ERROR_I18N_KEY", () => {
  const ALL_ERRORS: PriceRangeError[] = [
    "from_unparseable",
    "to_unparseable",
    "from_negative",
    "to_negative",
    "inverted",
  ];

  it("maps every error code to a non-empty key", () => {
    for (const code of ALL_ERRORS) {
      const key = PRICE_RANGE_ERROR_I18N_KEY[code];
      assert.ok(key && key.length > 0, `${code} has no i18n key`);
    }
  });

  it("has no key the union does not cover, and none the union misses", () => {
    // The `satisfies Record<PriceRangeError, string>` makes a missing row a
    // type error; this catches the other direction — a row left behind after
    // a code is renamed — which the type does not.
    assert.deepEqual(Object.keys(PRICE_RANGE_ERROR_I18N_KEY).sort(), [...ALL_ERRORS].sort());
  });

  it("declares every key in the English translation map", () => {
    const source = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "lib", "i18n-context.tsx"),
      "utf8",
    ) as string;
    for (const key of Object.values(PRICE_RANGE_ERROR_I18N_KEY)) {
      assert.match(source, new RegExp(`\\b${key}:`), `translation key '${key}' is not declared`);
    }
  });

  it("gives both negative codes the same message — the field is not worth naming", () => {
    assert.equal(
      PRICE_RANGE_ERROR_I18N_KEY.from_negative,
      PRICE_RANGE_ERROR_I18N_KEY.to_negative,
    );
  });
});

describe("applyItemFilters — price bounds go through the validated parser", () => {
  const corpus = [item("Free", 0), item("Cheap", 5), item("Mid", 12.5), item("Dear", 40), item("Priceless", null)];
  const titles = (f: ItemFilters) => applyItemFilters(corpus, f).map((i) => i.title);

  it("filters on the comma-written amount the user actually meant", () => {
    // Under `parseFloat` this bound was 12, so "Mid" (12.5) survived a
    // "up to 12,50"... and equally survived "up to 12,00". Now the two differ.
    assert.deepEqual(titles(withPrice("", "12,50")), ["Free", "Cheap", "Mid"]);
    assert.deepEqual(titles(withPrice("", "12,00")), ["Free", "Cheap"]);
  });

  it("includes an item priced exactly on either bound", () => {
    assert.deepEqual(titles(withPrice("5", "40")), ["Cheap", "Mid", "Dear"]);
  });

  it("keeps a zero-cost item under a 'from 0' bound rather than treating 0 as unset", () => {
    // `if (filters.priceFrom)` is a STRING truthiness check, so "0" is a real
    // bound; the item at 0 must survive it.
    assert.deepEqual(titles(withPrice("0", "5")), ["Free", "Cheap"]);
  });

  it("drops items with no cost whenever either bound is set", () => {
    assert.ok(!titles(withPrice("1", "")).includes("Priceless"));
    assert.ok(!titles(withPrice("", "100")).includes("Priceless"));
  });

  it("skips a bound that does not parse instead of emptying the collection", () => {
    // Legacy filters persisted before validation shipped must not wipe a
    // user's collection on upgrade — the sheet is what stops NEW ones.
    assert.deepEqual(titles(withPrice("abc", "")), corpus.map((i) => i.title));
    assert.deepEqual(titles(withPrice("", "abc")), corpus.map((i) => i.title));
  });

  it("still applies the good half when only one bound is broken", () => {
    assert.deepEqual(titles(withPrice("abc", "5")), ["Free", "Cheap"]);
  });

  it("matches nothing for an inverted range — the state the sheet now blocks", () => {
    assert.deepEqual(titles(withPrice("40", "5")), []);
  });

  it("no longer reads a trailing-junk bound as a number", () => {
    // `parseFloat("12abc")` was 12, so this silently filtered by a bound the
    // user never typed. It is now ignored, and unreachable through the sheet.
    assert.deepEqual(titles(withPrice("12abc", "")), corpus.map((i) => i.title));
  });

  it("agrees with the validator on every bound it accepts", () => {
    // The invariant the shared parser exists for: anything Apply lets through
    // is matched on the exact number the validator approved.
    for (const raw of ["0", "5", "12.5", "12,50", "40"]) {
      assert.equal(validatePriceRange(raw, ""), null, `${raw} should validate`);
      const parsed = parsePriceBound(raw).value;
      assert.ok(parsed !== null);
      assert.deepEqual(
        titles(withPrice(raw, "")),
        corpus.filter((i) => typeof i.cost === "number" && i.cost >= parsed).map((i) => i.title),
      );
    }
  });
});
