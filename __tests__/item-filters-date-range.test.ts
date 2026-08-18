import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  applyItemFilters,
  DATE_RANGE_ERROR_I18N_KEY,
  EMPTY_FILTERS,
  parseDateBound,
  validateDateRange,
  type DateRangeError,
  type ItemFilters,
} from "@/lib/item-filters";
import type { CollectableItem } from "@/lib/types";
import { readI18nSource } from "./helpers/i18n-source-file";

/**
 * The acquisition-date range carried every failure the price range did, plus
 * one of its own.
 *
 * `applyItemFilters` compares a bound against `item.acquiredAt` with a raw
 * string `<`/`>`. That is correct and timezone-free for zero-padded
 * `YYYY-MM-DD` on BOTH sides, and silently wrong otherwise: `"2024-01-15" <
 * "2024-1-1"` is TRUE, because `"0"` sorts before `"1"`. So a user who typed
 * the perfectly reasonable `2024-1-1` filtered out most of the year the range
 * was meant to include, with nothing on screen looking wrong.
 *
 * `parseDateBound` normalises to the padded shape the comparison is valid
 * for, and is the same parser `validateDateRange` gates Apply on — the
 * invariant these tests exist to hold.
 */

function item(title: string, acquiredAt: string): CollectableItem {
  return {
    id: title.toLowerCase().replace(/\s+/g, "-"),
    collectionId: "c1",
    title,
    acquiredAt,
    acquiredFrom: "",
    description: "",
    variants: "",
    photos: [],
    createdBy: "u1",
    createdByUserId: "u1",
    createdAt: "2026-05-23",
  };
}

function withDates(dateFrom: string, dateTo: string): ItemFilters {
  return { ...EMPTY_FILTERS, dateFrom, dateTo };
}

describe("parseDateBound", () => {
  it("treats an unset bound as empty rather than an error", () => {
    for (const raw of ["", "   ", "\t"]) {
      assert.deepEqual(parseDateBound(raw), { value: null, error: "empty" });
    }
  });

  it("accepts an already-padded ISO date unchanged", () => {
    assert.deepEqual(parseDateBound("2024-01-31"), { value: "2024-01-31", error: null });
    assert.deepEqual(parseDateBound("  2024-12-01 "), { value: "2024-12-01", error: null });
  });

  it("pads an unpadded date — the bug the whole parser exists for", () => {
    assert.deepEqual(parseDateBound("2024-1-1"), { value: "2024-01-01", error: null });
    assert.deepEqual(parseDateBound("2024-1-15"), { value: "2024-01-15", error: null });
    assert.deepEqual(parseDateBound("2024-11-5"), { value: "2024-11-05", error: null });
  });

  it("rejects anything that is not YYYY-M-D shaped", () => {
    for (const raw of [
      "tomorrow",
      "01/02/2024",
      "2024",
      "2024-01",
      "24-01-01",
      "2024-01-01T00:00:00Z",
      "2024-001-01",
      "2024-1-1-1",
      "-2024-01-01",
    ]) {
      assert.deepEqual(
        parseDateBound(raw),
        { value: null, error: "unparseable" },
        `${JSON.stringify(raw)} is not a date bound`,
      );
    }
  });

  it("separates a shape that is right from a day that does not exist", () => {
    // `new Date("2024-02-30")` does not throw — it rolls over to March 1st, so
    // a Date-based check would accept the typo and filter by a different day
    // than the one on screen.
    for (const raw of ["2024-02-30", "2024-13-01", "2024-00-01", "2024-01-00", "2024-01-32", "2023-02-29"]) {
      assert.deepEqual(
        parseDateBound(raw),
        { value: null, error: "not_a_date" },
        `${raw} is not a real day`,
      );
    }
  });

  it("applies the full Gregorian leap rule, not just 'divisible by four'", () => {
    assert.equal(parseDateBound("2024-02-29").value, "2024-02-29", "2024 is a leap year");
    assert.equal(parseDateBound("2000-02-29").value, "2000-02-29", "2000 is a leap year (÷400)");
    assert.equal(parseDateBound("1900-02-29").error, "not_a_date", "1900 is not (÷100, not ÷400)");
    assert.equal(parseDateBound("2023-02-29").error, "not_a_date");
  });

  it("accepts the last day of every month", () => {
    const lengths = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    lengths.forEach((len, index) => {
      const month = String(index + 1).padStart(2, "0");
      assert.equal(parseDateBound(`2024-${month}-${len}`).error, null, `2024-${month}-${len}`);
      assert.equal(
        parseDateBound(`2024-${month}-${len + 1}`).error,
        "not_a_date",
        `2024-${month}-${len + 1} must not exist`,
      );
    });
  });
});

describe("validateDateRange", () => {
  it("accepts an empty range and every half-open range", () => {
    assert.equal(validateDateRange("", ""), null);
    assert.equal(validateDateRange("2024-01-01", ""), null);
    assert.equal(validateDateRange("", "2024-01-01"), null);
  });

  it("accepts a well-ordered range, including the single-day one", () => {
    assert.equal(validateDateRange("2024-01-01", "2024-12-31"), null);
    assert.equal(validateDateRange("2024-01-01", "2024-01-01"), null);
  });

  it("names which end failed, and separates shape from calendar", () => {
    assert.equal(validateDateRange("tomorrow", ""), "from_unparseable");
    assert.equal(validateDateRange("", "tomorrow"), "to_unparseable");
    assert.equal(validateDateRange("2024-02-30", ""), "from_not_a_date");
    assert.equal(validateDateRange("", "2024-02-30"), "to_not_a_date");
  });

  it("reports the 'from' end first when both are bad", () => {
    assert.equal(validateDateRange("tomorrow", "yesterday"), "from_unparseable");
    assert.equal(validateDateRange("2024-02-30", "yesterday"), "from_not_a_date");
  });

  it("prefers a parse failure over the inversion it would otherwise imply", () => {
    assert.equal(validateDateRange("tomorrow", "2024-01-01"), "from_unparseable");
    assert.equal(validateDateRange("2024-12-31", "tomorrow"), "to_unparseable");
  });

  it("rejects an inverted range", () => {
    assert.equal(validateDateRange("2024-12-31", "2024-01-01"), "inverted");
    assert.equal(validateDateRange("2024-01-02", "2024-01-01"), "inverted");
  });

  it("compares the NORMALISED bounds, so padding cannot fake an inversion", () => {
    // Raw string compare would call this inverted: "2024-1-5" > "2024-01-15".
    assert.equal(validateDateRange("2024-1-5", "2024-01-15"), null);
    // ...and would miss this real one: "2024-1-5" < "2024-01-02" is false, but
    // the reverse pair is where the raw compare goes wrong.
    assert.equal(validateDateRange("2024-1-15", "2024-01-05"), "inverted");
  });
});

describe("DATE_RANGE_ERROR_I18N_KEY", () => {
  const ALL_ERRORS: DateRangeError[] = [
    "from_unparseable",
    "to_unparseable",
    "from_not_a_date",
    "to_not_a_date",
    "inverted",
  ];

  it("has no key the union does not cover, and none the union misses", () => {
    assert.deepEqual(Object.keys(DATE_RANGE_ERROR_I18N_KEY).sort(), [...ALL_ERRORS].sort());
  });

  it("declares every key in the English translation map", () => {
    const source = readI18nSource();
    for (const key of Object.values(DATE_RANGE_ERROR_I18N_KEY)) {
      assert.match(source, new RegExp(`\\b${key}:`), `translation key '${key}' is not declared`);
    }
  });

  it("gives both not-a-date codes the same message", () => {
    assert.equal(
      DATE_RANGE_ERROR_I18N_KEY.from_not_a_date,
      DATE_RANGE_ERROR_I18N_KEY.to_not_a_date,
    );
  });

  it("shares no i18n key with the price range's errors", async () => {
    // The two records name the same five failure SHAPES; reusing a string
    // would produce a message naming the wrong field.
    const { PRICE_RANGE_ERROR_I18N_KEY } = await import("@/lib/item-filters");
    const priceKeys = new Set(Object.values(PRICE_RANGE_ERROR_I18N_KEY) as string[]);
    for (const key of Object.values(DATE_RANGE_ERROR_I18N_KEY)) {
      assert.ok(!priceKeys.has(key), `'${key}' is shared with the price range`);
    }
  });
});

describe("applyItemFilters — date bounds go through the normalising parser", () => {
  const corpus = [
    item("New Year", "2024-01-01"),
    item("Mid Jan", "2024-01-15"),
    item("Summer", "2024-07-04"),
    item("New Year Eve", "2024-12-31"),
    item("Undated", ""),
  ];
  const titles = (f: ItemFilters) => applyItemFilters(corpus, f).map((i) => i.title);

  it("includes items on either bound", () => {
    assert.deepEqual(titles(withDates("2024-01-01", "2024-01-15")), ["New Year", "Mid Jan"]);
  });

  it("reads an unpadded bound as the day the user meant", () => {
    // Under the raw string compare "2024-1-1" excluded "2024-01-15" and
    // "2024-01-01" alike, leaving only the items whose month sorted higher.
    assert.deepEqual(titles(withDates("2024-1-1", "")), [
      "New Year",
      "Mid Jan",
      "Summer",
      "New Year Eve",
    ]);
    assert.deepEqual(titles(withDates("", "2024-1-15")), ["New Year", "Mid Jan"]);
  });

  it("agrees with the padded spelling of the same day", () => {
    assert.deepEqual(titles(withDates("2024-1-15", "")), titles(withDates("2024-01-15", "")));
    assert.deepEqual(titles(withDates("", "2024-7-4")), titles(withDates("", "2024-07-04")));
  });

  it("drops undated items whenever either bound is set", () => {
    assert.ok(!titles(withDates("2024-01-01", "")).includes("Undated"));
    assert.ok(!titles(withDates("", "2024-12-31")).includes("Undated"));
  });

  it("skips a bound that does not parse instead of emptying the collection", () => {
    assert.deepEqual(titles(withDates("tomorrow", "")), corpus.map((i) => i.title));
    assert.deepEqual(titles(withDates("", "2024-02-30")), corpus.map((i) => i.title));
  });

  it("still applies the good half when only one bound is broken", () => {
    assert.deepEqual(titles(withDates("tomorrow", "2024-01-15")), ["New Year", "Mid Jan"]);
  });

  it("matches nothing for an inverted range — the state the sheet now blocks", () => {
    assert.deepEqual(titles(withDates("2024-12-31", "2024-01-01")), []);
  });

  it("agrees with the validator on every bound it accepts", () => {
    for (const raw of ["2024-01-01", "2024-1-1", "2024-07-04", "2024-12-31", "2024-2-29"]) {
      assert.equal(validateDateRange(raw, ""), null, `${raw} should validate`);
      const normalised = parseDateBound(raw).value;
      assert.ok(normalised !== null);
      assert.deepEqual(
        titles(withDates(raw, "")),
        corpus.filter((i) => i.acquiredAt && i.acquiredAt >= normalised).map((i) => i.title),
      );
    }
  });
});
