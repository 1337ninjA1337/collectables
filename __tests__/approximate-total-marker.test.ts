import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { stripComments } from "@/lib/strip-comments";

import { readI18nSource } from "./helpers/i18n-source-file";
import { assertDeclaredInEveryLocale, localeValuesOf } from "./helpers/i18n-locales";
import { readRepoFile } from "./helpers/repo-file";

/**
 * The in-app surfaces say what the PDF was taught to say.
 *
 * `approximate` shipped for the export — the one output a user keeps, mails
 * and files, where a sum of three currencies stated as a figure in one is
 * permanent. The three surfaces that show the same total in the app said
 * nothing, on the argument that they re-render when the rates land. That is an
 * argument for a quieter marker than a sentence, not for silence: a user reads
 * the number in the meantime, and "1,500 USD" for items priced in three
 * currencies is a claim the app is making.
 *
 * So the cards and the collection-detail summary take the `≈` they already
 * print for a converted item cost, and the stats screen — whose entire job is
 * one total — gets the sentence.
 */

describe("<CollectionCard> takes the total as one object", () => {
  const SRC = stripComments(readRepoFile("components/collection-card.tsx"));

  it("has one total prop, not an amount beside a currency", () => {
    // Four call sites spread the pair by hand from the one object the provider
    // hands them, and `approximate` would have made it three props.
    assert.match(SRC, /total\?: CollectionTotalCost;/);
    assert.ok(!SRC.includes("totalCostCurrency"));
    assert.ok(!SRC.includes("totalCost?: number"));
  });

  it("marks an approximate total and leaves an exact one plain", () => {
    assert.match(SRC, /\{total && total\.amount > 0 \? \(/);
    assert.match(SRC, /\{total\.approximate \? "≈ " : ""\}/);
  });

  it("still hides the line when nothing is priced", () => {
    // `total.amount > 0` and not `total`: an empty collection has a total, and
    // it is zero.
    assert.match(SRC, /total\.amount > 0/);
  });
});

describe("every caller passes the object", () => {
  for (const file of ["app/index.tsx", "app/profile/[id].tsx"] as const) {
    it(`${file} hands over the whole total`, () => {
      const SRC = stripComments(readRepoFile(file));
      assert.ok(!SRC.includes("totalCostCurrency="), "the prop pair is back");
      assert.match(SRC, /total=\{total(Cost)?\}/);
    });
  }
});

describe("<CostBadge> prints the marker in raw mode too", () => {
  const SRC = stripComments(readRepoFile("components/cost-badge.tsx"));

  it("takes the flag and prefixes the same symbol the item mode uses", () => {
    assert.match(SRC, /approximate\?: boolean;/);
    assert.match(SRC, /\{approximate \? "≈ " : ""\}\{formatCostAmount\(amount\)\}/);
  });

  it("leaves the item mode's own marker alone", () => {
    // Item mode computes its own `approx` from whether a real conversion
    // changed the currency; the raw-mode flag is about a missing rate TABLE.
    // Two different questions that happen to print the same symbol.
    assert.match(SRC, /const approx = conv\.converted && item\.costCurrency != null/);
  });
});

describe("the collection-detail summary card", () => {
  const SRC = stripComments(readRepoFile("app/collection/[id].tsx"));

  it("passes the flag on both branches", () => {
    // Owners get a tap-to-swap Pressable and non-owners a plain View, and the
    // badge is written out in each — the realistic slip is marking one.
    const marked = SRC.match(/approximate=\{total\.approximate\}/g) ?? [];
    assert.equal(marked.length, 2, "one of the two summary-card branches is unmarked");
  });
});

describe("the stats screen says it in words", () => {
  const SRC = stripComments(readRepoFile("app/stats.tsx"));

  it("marks the figure and explains it", () => {
    assert.match(SRC, /approximate=\{ownedTotalCost\.approximate\}/);
    assert.match(SRC, /\{ownedTotalCost\.approximate \? \(\s*<Text style=\{styles\.summaryHint\}>\{t\("statsTotalValueApprox"\)\}<\/Text>/);
  });

  it("lets the unconverted sentence win over the partial one", () => {
    // A total summed with no rate table at all is in no single currency, which
    // is a worse claim than being short of a few items — and the screen said
    // nothing about the first while saying "excludes N items" about the
    // second.
    const approxAt = SRC.indexOf("ownedTotalCost.approximate ? (");
    const skippedAt = SRC.indexOf("ownedTotalCost.skipped > 0 ? (");
    assert.ok(approxAt > 0 && skippedAt > approxAt, "the partial branch is checked first");
  });

  it("keeps the counted partial sentence", () => {
    assert.match(SRC, /t\("statsTotalValuePartial", \{ count: ownedTotalCost\.skipped \}\)/);
  });
});

describe("statsTotalValueApprox is translated everywhere", () => {
  const I18N = readI18nSource();

  it("is declared by every locale", () => {
    assertDeclaredInEveryLocale(I18N, "statsTotalValueApprox");
  });

  it("says the currencies are mixed, not merely that something is missing", () => {
    // The partial sentence already covers "some items are absent". This one
    // has to say the figure itself is in no single unit, or the two read as
    // the same warning.
    for (const [code, value] of localeValuesOf(I18N, "statsTotalValueApprox")) {
      assert.notEqual(
        value,
        localeValuesOf(I18N, "statsTotalValuePartial").get(code),
        `${code} uses one sentence for both`,
      );
      assert.ok(value.length > 20, `${code}'s sentence is too short to say which case it is`);
    }
  });

  it("each locale writes its own words", () => {
    const values = [...localeValuesOf(I18N, "statsTotalValueApprox").values()];
    assert.equal(new Set(values).size, values.length, "two locales share the string");
  });
});
