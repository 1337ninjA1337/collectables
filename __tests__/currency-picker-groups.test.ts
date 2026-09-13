import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CURRENCIES, currencyPickerGroups } from "@/lib/currencies";

import { readI18nSource } from "./helpers/i18n-source-file";
import { assertDeclaredInEveryLocale, localeValuesOf } from "./helpers/i18n-locales";
import { readRepoFile } from "./helpers/repo-file";

/**
 * The shortlist the picker was missing.
 *
 * `<CurrencyInput>`'s chip strip has led with recently-used codes since it was
 * written — `getPinnedCurrencies` is an MRU list and `pinCurrency` writes to it
 * on every pick. The sheet behind its "…" chip ignored all of that and listed
 * 160 rows in ISO order, so a collector who types in three currencies scrolled
 * past all three to reach the fourth. This is that same shortlist, one control
 * over.
 *
 * The logic is here rather than in the component because it is a decision with
 * three edges — a query, an unknown code, a duplicate — and a decision inside a
 * `useMemo` is one nobody can argue with.
 */

const ALL = CURRENCIES.length;

describe("currencyPickerGroups", () => {
  it("returns one unheaded list when nothing is pinned", () => {
    // What the sheet did before this existed, and what the screens that pass
    // no shortlist still get.
    const groups = currencyPickerGroups([], "");
    assert.deepEqual(
      groups.map((group) => group.kind),
      [null],
    );
    assert.equal(groups[0].items.length, ALL);
  });

  it("leads with the pinned codes, in the order it was given them", () => {
    // MRU order, not alphabetical: the list is "what you used last", and
    // sorting it would answer a different question.
    const groups = currencyPickerGroups(["PLN", "JPY", "USD"], "");
    assert.deepEqual(
      groups.map((group) => group.kind),
      ["recent", "all"],
    );
    assert.deepEqual(
      groups[0].items.map((c) => c.code),
      ["PLN", "JPY", "USD"],
    );
  });

  it("never lists a currency twice", () => {
    // Two identical rows, one of them checked, is a picker that looks broken.
    const groups = currencyPickerGroups(["PLN", "JPY"], "");
    const codes = groups.flatMap((group) => group.items.map((c) => c.code));
    assert.equal(new Set(codes).size, codes.length);
    assert.equal(codes.length, ALL);
    assert.ok(!groups[1].items.some((c) => c.code === "PLN"));
  });

  it("ignores a code the currency list does not know", () => {
    // Storage is a place a code can outlive a currency; the list is the
    // authority on what one is.
    const groups = currencyPickerGroups(["ZZZ", "PLN"], "");
    assert.deepEqual(
      groups[0].items.map((c) => c.code),
      ["PLN"],
    );
  });

  it("drops a repeat inside the shortlist itself", () => {
    const groups = currencyPickerGroups(["PLN", "PLN"], "");
    assert.equal(groups[0].items.length, 1);
  });

  it("falls back to the flat list when every pinned code is unknown", () => {
    const groups = currencyPickerGroups(["ZZZ"], "");
    assert.deepEqual(
      groups.map((group) => group.kind),
      [null],
    );
  });

  it("collapses to one list as soon as the user types", () => {
    // Somebody typing "PL" already knows what they want, and a match hidden
    // under a second heading is worse than a match in one list.
    const groups = currencyPickerGroups(["JPY"], "pl");
    assert.deepEqual(
      groups.map((group) => group.kind),
      [null],
    );
    assert.ok(groups[0].items.some((c) => c.code === "PLN"));
    assert.ok(groups[0].items.length < ALL);
  });

  it("searches names as well as codes, and ignores case and padding", () => {
    const byName = currencyPickerGroups([], "  Zloty ");
    assert.deepEqual(
      byName[0].items.map((c) => c.code),
      ["PLN"],
    );
  });

  it("returns an empty list rather than everything when nothing matches", () => {
    const groups = currencyPickerGroups(["PLN"], "zzzzz");
    assert.deepEqual(groups.map((group) => group.items.length), [0]);
  });
});

describe("the sheet that renders them", () => {
  const SHEET = readRepoFile("components/currency-sheet.tsx");
  const INPUT = readRepoFile("components/currency-input.tsx");

  it("asks the helper rather than filtering for itself", () => {
    assert.match(SHEET, /currencyPickerGroups\(pinned \?\? EMPTY_PINNED, query\)/);
    assert.doesNotMatch(SHEET, /CURRENCIES\.filter/);
  });

  it("keeps one empty array for the sheets that pass no shortlist", () => {
    // A fresh `[]` on every render is a new prop to a memoized component and
    // a new dependency to the memo inside it.
    assert.match(SHEET, /const EMPTY_PINNED: readonly string\[\] = \[\];/);
  });

  it("announces each section heading as a heading", () => {
    // Both screen readers navigate by heading, so "the long list starts here"
    // is how somebody skips the shortlist without swiping through it.
    assert.match(SHEET, /styles\.sectionTitle\} accessibilityRole="header"/);
  });

  it("hands the sheet the same shortlist the chip strip leads with", () => {
    assert.match(INPUT, /pinned=\{pinned\}/);
    assert.match(INPUT, /getPinnedCurrencies\(\)/);
  });
});

describe("the section headings", () => {
  const SOURCE = readI18nSource();

  it("every locale declares both", () => {
    assertDeclaredInEveryLocale(SOURCE, "currencyRecent");
    assertDeclaredInEveryLocale(SOURCE, "currencyAll");
  });

  it("no locale gives the two sections the same words", () => {
    const recent = localeValuesOf(SOURCE, "currencyRecent");
    const all = localeValuesOf(SOURCE, "currencyAll");
    for (const [code, value] of recent) {
      assert.notEqual(value, all.get(code), `${code} names both sections the same`);
    }
  });
});
