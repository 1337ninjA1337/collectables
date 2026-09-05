import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCollectionExportHtml, type ExportLabels } from "@/lib/export-pdf-html";
import type { CollectableItem, Collection } from "@/lib/types";

/**
 * The PDF export's document, which had no suite because it could not be loaded.
 *
 * `lib/export-pdf.ts` imports `expo-print`, `expo-sharing` and `react-native`,
 * so a node suite cannot require it — and the escaping, the totals and the
 * field list all lived behind those imports. Six modules in `lib/` and
 * `components/` are mentioned by no suite; this was the largest, and the reason
 * was reachability rather than a decision that a print document does not need
 * checking. Splitting the pure half out is what these cases are.
 *
 * WHAT IS ASSERTED ABOUT ESCAPING. Not the four replacements — the property:
 * user text cannot end an attribute, open a tag, or add one. A photo URL is the
 * only user string that reaches an attribute, and a title is the one most
 * likely to contain a `<`.
 */

const LABELS: ExportLabels = {
  acquiredHow: "Acquired how",
  acquiredDate: "Acquired date",
  description: "Description",
  variants: "Variants",
  costLabel: "Cost",
  totalCost: "Total cost",
  exportPdfItemCount: "Items",
  photosSaved: "Photos",
};

const PRINTED_ON = new Date("2026-01-02T03:04:05Z");

function collection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: "c1",
    name: "Vinyl",
    coverPhoto: "",
    description: "Records bought in Europe",
    ownerName: "Ann",
    ownerUserId: "u1",
    sharedWith: [],
    sharedWithUserIds: [],
    role: "owner",
    visibility: "private",
    ...overrides,
  };
}

function item(overrides: Partial<CollectableItem> = {}): CollectableItem {
  return {
    id: "i1",
    collectionId: "c1",
    title: "Kind of Blue",
    acquiredAt: "",
    acquiredFrom: "",
    description: "",
    variants: "",
    photos: [],
    createdBy: "Ann",
    createdByUserId: "u1",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("the collection export document", () => {
  it("escapes user text so it cannot open a tag", () => {
    const html = buildCollectionExportHtml(
      collection({ name: "<script>alert(1)</script>", description: "a & b" }),
      [item({ title: "<img onerror=x>" })],
      LABELS,
      PRINTED_ON,
    );
    // The only tags in the document are the ones the template wrote. A `<` that
    // survived from user text would be one it did not.
    assert.ok(!html.includes("<script>"), "a title's `<script>` reached the document as a tag");
    assert.ok(!html.includes("<img onerror"), "an item title opened an `img` tag");
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "the name was not escaped into text");
    assert.ok(html.includes("a &amp; b"), "an ampersand in the description was left raw");
  });

  it("keeps a photo URL inside its own attribute", () => {
    // The one place user text lands in an attribute. A `"` that survived would
    // end `src` and let the rest of the URL become attributes of the `img`.
    const html = buildCollectionExportHtml(
      collection(),
      [item({ photos: ['x.png" onerror="alert(1)'] })],
      LABELS,
      PRINTED_ON,
    );
    assert.ok(!html.includes('onerror="alert(1)"'), "a photo URL escaped its attribute");
    assert.match(html, /<img src="x\.png&quot; onerror=&quot;alert\(1\)"/);
  });

  it("counts the items and their photos in the header", () => {
    const html = buildCollectionExportHtml(
      collection(),
      [item({ photos: ["a.png", "b.png"] }), item({ id: "i2", photos: ["c.png"] })],
      LABELS,
      PRINTED_ON,
    );
    assert.match(html, /<div class="stat-value">2<\/div>\s*<div class="stat-label">Items<\/div>/);
    assert.match(html, /<div class="stat-value">3<\/div>\s*<div class="stat-label">Photos<\/div>/);
  });

  it("adds the cost stat only when something cost something", () => {
    // `cost` is `number | null | undefined`, so the sum has to skip two kinds of
    // absence — and a collection of free items must not print a "Total cost 0".
    const free = buildCollectionExportHtml(
      collection(),
      [item({ cost: null }), item({ id: "i2" })],
      LABELS,
      PRINTED_ON,
    );
    assert.ok(!free.includes("Total cost"), "a collection with no costs printed a total");

    const paid = buildCollectionExportHtml(
      collection(),
      [item({ cost: 12 }), item({ id: "i2", cost: null }), item({ id: "i3", cost: 30 })],
      LABELS,
      PRINTED_ON,
    );
    assert.match(paid, /<div class="stat-value">42<\/div>\s*<div class="stat-label">Total cost<\/div>/);
  });

  it("prints a field only when the item has one", () => {
    const bare = buildCollectionExportHtml(collection(), [item()], LABELS, PRINTED_ON);
    for (const label of ["Acquired how", "Acquired date", "Description", "Variants", "Cost"]) {
      assert.ok(!bare.includes(label), `an empty item printed the \`${label}\` field`);
    }

    const full = buildCollectionExportHtml(
      collection(),
      [
        item({
          acquiredFrom: "a shop",
          acquiredAt: "2026-01-01",
          description: "sleeve worn",
          variants: "180g",
          cost: 0,
        }),
      ],
      LABELS,
      PRINTED_ON,
    );
    for (const label of ["Acquired how", "Acquired date", "Description", "Variants", "Cost"]) {
      assert.ok(full.includes(label), `a filled item did not print the \`${label}\` field`);
    }
    // Zero is a cost somebody recorded, and `if (item.cost)` would drop it —
    // which is why the template asks `typeof`. The header still has no total,
    // because nothing was spent.
    assert.ok(!full.includes("Total cost"), "a zero cost was summed into a total");
  });

  it("does not read the clock, so the same collection prints the same document", () => {
    // The footer used to call `new Date()` inside the builder, which made the
    // output different on every call and unassertable. The date is a parameter.
    const args: [Collection, CollectableItem[], ExportLabels] = [collection(), [item()], LABELS];
    assert.equal(
      buildCollectionExportHtml(...args, PRINTED_ON),
      buildCollectionExportHtml(...args, PRINTED_ON),
    );
    assert.notEqual(
      buildCollectionExportHtml(...args, PRINTED_ON),
      buildCollectionExportHtml(...args, new Date("2020-06-07T00:00:00Z")),
    );
  });

  it("renders an empty collection without an items section", () => {
    const html = buildCollectionExportHtml(collection(), [], LABELS, PRINTED_ON);
    assert.ok(!html.includes('class="item"'), "an empty collection rendered an item card");
    assert.match(html, /<div class="stat-value">0<\/div>\s*<div class="stat-label">Items<\/div>/);
  });
});
