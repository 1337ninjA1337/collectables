import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { hasFiniteCost } from "@/lib/item-cost";
import { buildCollectionExportHtml } from "@/lib/export-pdf-html";
import { stripComments } from "@/lib/strip-comments";
import { CollectableItem, Collection } from "@/lib/types";

import { readRepoFile } from "./helpers/repo-file";

/**
 * "Does this item have a price?", asked the same way everywhere.
 *
 * Six places asked it and four asked it as `typeof item.cost === "number"`,
 * which is true of `NaN` and of `Infinity`. One such item made the stats
 * screen's headline figure read `NaN`, put `NaN` in the total of an exported
 * PDF somebody keeps, and printed it in a cost cell.
 *
 * **No entry path can produce one today** and that is the reason to do this
 * now rather than the reason not to: the forms parse through
 * `parseCurrencyValueDetailed`, which rejects a non-finite number, and cloud
 * rows through `coerceNumberOrNull`, which does the same. The weak check gives
 * the wrong answer the day one more importer, paste handler or migration
 * disagrees — and it gives it silently, in a total.
 *
 * `hasFiniteCost` is a type guard now, so a caller that filters through it
 * narrows to `cost: number` and sums or prints the field with no cast. That is
 * what makes the shared gate easier to reach for than the hand-written check,
 * which is the only thing that keeps a seventh copy from being written.
 */

const item = (over: Partial<CollectableItem> = {}): CollectableItem => ({
  id: "i-1",
  collectionId: "c-1",
  title: "An item",
  acquiredAt: "",
  acquiredFrom: "",
  description: "",
  variants: "",
  photos: [],
  createdBy: "u-1",
  createdByUserId: "u-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("hasFiniteCost", () => {
  it("accepts a real price", () => {
    assert.equal(hasFiniteCost(item({ cost: 12.5 })), true);
  });

  it("accepts zero and a negative, which are prices", () => {
    // Free and "cost me money to be rid of" are both answers; missing is not.
    assert.equal(hasFiniteCost(item({ cost: 0 })), true);
    assert.equal(hasFiniteCost(item({ cost: -5 })), true);
  });

  it("rejects a missing or null cost", () => {
    assert.equal(hasFiniteCost(item()), false);
    assert.equal(hasFiniteCost(item({ cost: null })), false);
  });

  it("rejects NaN and both infinities", () => {
    assert.equal(hasFiniteCost(item({ cost: NaN })), false);
    assert.equal(hasFiniteCost(item({ cost: Infinity })), false);
    assert.equal(hasFiniteCost(item({ cost: -Infinity })), false);
  });

  it("narrows the cost to a number for the caller", () => {
    // The type-guard signature is the point: `.filter(hasFiniteCost)` gives an
    // array whose `cost` is a `number`, which is what lets four call sites sum
    // or print it without a cast. `tsc --noEmit` runs before this suite, so a
    // signature that stopped narrowing would fail the build — this case is
    // here to say the compile-time claim is deliberate.
    const priced = [item({ cost: 3 }), item({ cost: NaN }), item()].filter(hasFiniteCost);
    const total: number = priced.reduce((sum, i) => sum + i.cost, 0);

    assert.equal(total, 3);
  });
});

describe("the PDF export prices what it can and drops what it cannot", () => {
  const collection: Collection = {
    id: "c-1",
    name: "Stamps",
    coverPhoto: "",
    description: "",
    ownerName: "Ada",
    ownerUserId: "u-1",
    sharedWith: [],
    sharedWithUserIds: [],
    role: "owner",
    visibility: "private",
  };

  const labels = {
    acquiredHow: "From",
    acquiredDate: "Date",
    description: "Description",
    variants: "Variants",
    costLabel: "Cost",
    totalCost: "Total",
    exportPdfItemCount: "Items",
    photosSaved: "Photos",
  };

  it("does not put NaN in the printed total", () => {
    // A PDF is the one output a user keeps, mails and files. A `NaN` in it
    // outlives every re-render that would have fixed the screen.
    const html = buildCollectionExportHtml(
      collection,
      [item({ id: "a", cost: 10 }), item({ id: "b", cost: NaN })],
      labels,
      new Date("2026-01-01T00:00:00.000Z"),
    );

    assert.doesNotMatch(html, /NaN/);
    assert.match(html, /10/);
  });

  it("omits the cost row for an item whose price is not a number", () => {
    const html = buildCollectionExportHtml(
      collection,
      [item({ id: "b", cost: Infinity })],
      labels,
      new Date("2026-01-01T00:00:00.000Z"),
    );

    assert.doesNotMatch(html, /Infinity/);
  });
});

describe("no caller asks the weak question", () => {
  const FILES = [
    "app/wishlist.tsx",
    "app/item/[id].tsx",
    "lib/item-filters.ts",
    "lib/export-pdf-html.ts",
    "lib/transfer-item-helpers.ts",
    "lib/collection-total.ts",
  ] as const;

  for (const file of FILES) {
    it(`${file} reads the shared gate`, () => {
      const CODE = stripComments(readRepoFile(file));
      assert.match(CODE, /hasFiniteCost/, `${file} no longer reaches the gate`);
      assert.doesNotMatch(
        CODE,
        /typeof \w+\.cost === "number"/,
        `${file} still asks a question that is true of NaN`,
      );
    });
  }

  it("app/stats.tsx does not sum costs at all any more", () => {
    // It was the seventh caller and read the gate directly, because it kept
    // its own `reduce` over `cost` — the one total in the app that never
    // converted. That sum is `portfolioTotalCost` now and the screen reads a
    // value off the context, so the right pin is that no arithmetic came
    // back rather than that the gate is still imported.
    const CODE = stripComments(readRepoFile("app/stats.tsx"));
    assert.doesNotMatch(CODE, /typeof \w+\.cost === "number"/);
    assert.doesNotMatch(CODE, /Number\.isFinite\(\w+\.cost\)/);
    assert.doesNotMatch(CODE, /\.cost/, "the screen must not touch item costs directly");
    assert.match(CODE, /ownedTotalCost/);
  });

  it("the gate itself is the only place the check is spelled out", () => {
    // Including the `Number.isFinite` half: `item-filters.ts` had a verbatim
    // second copy of the whole expression, which is the shape that makes a
    // shared helper look optional.
    const GATE = stripComments(readRepoFile("lib/item-cost.ts"));
    assert.match(GATE, /typeof item\.cost === "number" && Number\.isFinite\(item\.cost\)/);

    const offenders = FILES.filter((file) =>
      /Number\.isFinite\(\w+\.cost\)/.test(stripComments(readRepoFile(file))),
    );
    assert.deepEqual(offenders, [], "these still spell the finite check out");
  });
});
