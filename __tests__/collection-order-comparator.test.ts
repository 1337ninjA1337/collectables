import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { byCollectionOrder } from "@/lib/collections-helpers";
import type { CollectableItem } from "@/lib/types";
import { readRepoFile } from "./helpers/repo-file";

/**
 * The ordering every collection-detail screen renders, which until now lived
 * inline in `CollectionsProvider` — a module that pulls React Native and so
 * cannot be mounted under `tsx --test`. Its rules were pinned only by a source
 * regex in `collection-detail-chunked-render.test.ts`, which can say the
 * comparator is *called* but nothing about what it *does*.
 *
 * The gap that motivated extracting it: rule 3's `createdAt` fallback was
 * pinned to a total order, while rule 2's `sortOrder` comparison was not — the
 * untied path deterministic and the tied one not, which is backwards.
 */
const AT = (n: number) => new Date(1767225600000 + n).toISOString();

function item(
  id: string,
  overrides: Partial<CollectableItem> = {},
): CollectableItem {
  return {
    id,
    collectionId: "c1",
    title: `Item ${id}`,
    acquiredAt: "",
    acquiredFrom: "",
    description: "",
    variants: "",
    photos: [],
    createdBy: "u1",
    createdByUserId: "u1",
    createdAt: AT(0),
    ...overrides,
  };
}

function permutations<T>(rows: readonly T[], count = 12): T[][] {
  const out: T[][] = [];
  let seed = 99;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let n = 0; n < count; n += 1) {
    const copy = rows.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    out.push(copy);
  }
  return out;
}

describe("byCollectionOrder — rule 1: dragged items outrank undragged", () => {
  it("puts an item with a sortOrder before one without, whatever the timestamps say", () => {
    // A dragged item has a place the user chose; an undragged one has no
    // opinion. A newer undragged item must NOT jump the manual order.
    const dragged = item("a", { sortOrder: 5, createdAt: AT(0) });
    const undragged = item("b", { createdAt: AT(9999) });
    assert.ok(byCollectionOrder(dragged, undragged) < 0);
    assert.ok(byCollectionOrder(undragged, dragged) > 0);
  });

  it("treats sortOrder 0 as present, not as missing", () => {
    // The classic falsy-check bug: `if (a.sortOrder)` would demote the item the
    // user dragged to the very top, which is the one position users notice.
    const first = item("a", { sortOrder: 0 });
    const undragged = item("b");
    assert.ok(byCollectionOrder(first, undragged) < 0);
  });
});

describe("byCollectionOrder — rule 2: dragged items by sortOrder, ties by id", () => {
  it("orders ascending by sortOrder", () => {
    assert.ok(byCollectionOrder(item("z", { sortOrder: 1 }), item("a", { sortOrder: 2 })) < 0);
  });

  it("pins a duplicate sortOrder by id instead of by input order", () => {
    // Reachable across devices: `reorderItemsInCollection` writes a dense
    // 0..N-1 run, so one device cannot collide — but the same owner reordering
    // on phone and web merges per-item by `updated_at`, so one surviving index
    // from each write can land on the same number.
    const rows = [
      item("c", { sortOrder: 3 }),
      item("a", { sortOrder: 3 }),
      item("b", { sortOrder: 3 }),
    ];
    const expected = ["a", "b", "c"];
    for (const shuffled of permutations(rows)) {
      assert.deepEqual([...shuffled].sort(byCollectionOrder).map((i) => i.id), expected);
    }
  });

  it("keeps sortOrder ahead of the id tiebreak", () => {
    assert.ok(byCollectionOrder(item("z", { sortOrder: 1 }), item("a", { sortOrder: 9 })) < 0);
  });
});

describe("byCollectionOrder — rule 3: undragged items newest-first, ties by id", () => {
  it("orders newest first", () => {
    assert.ok(byCollectionOrder(item("a", { createdAt: AT(999) }), item("b", { createdAt: AT(0) })) < 0);
  });

  it("pins same-millisecond undragged items by id", () => {
    const rows = [item("c"), item("a"), item("b")];
    for (const shuffled of permutations(rows)) {
      assert.deepEqual([...shuffled].sort(byCollectionOrder).map((i) => i.id), ["a", "b", "c"]);
    }
  });
});

describe("byCollectionOrder is a total order over a mixed collection", () => {
  it("produces one identical order from every input permutation", () => {
    const rows = [
      item("d", { sortOrder: 1 }),
      item("b", { sortOrder: 0 }),
      item("e"),
      item("a", { sortOrder: 1 }),
      item("c"),
      item("f", { sortOrder: 0 }),
    ];
    // Dragged tier first (sortOrder 0 then 1, each tied pair by id), then the
    // undragged tier (same createdAt, so by id).
    const expected = ["b", "f", "a", "d", "c", "e"];
    for (const shuffled of permutations(rows)) {
      assert.deepEqual([...shuffled].sort(byCollectionOrder).map((i) => i.id), expected);
    }
  });

  it("is a consistent comparator — cmp(a,b) and cmp(b,a) never share a sign", () => {
    const rows = [
      item("a", { sortOrder: 0 }),
      item("b", { sortOrder: 0 }),
      item("c"),
      item("a", { sortOrder: 2 }),
      item("d", { createdAt: AT(50) }),
    ];
    for (const x of rows) {
      for (const y of rows) {
        const forward = byCollectionOrder(x, y);
        const backward = byCollectionOrder(y, x);
        if (forward === 0) {
          assert.equal(backward, 0, `${x.id}/${y.id}: 0 one way, ${backward} the other`);
        } else {
          assert.equal(Math.sign(forward), -Math.sign(backward), `${x.id}/${y.id}`);
        }
      }
    }
  });
});

describe("the provider delegates rather than re-inlining the comparator", () => {
  it("sorts getItemsForCollection through byCollectionOrder", () => {
    // Adoption: the point of the extraction is that these rules have ONE
    // definition and it is the tested one. A re-inlined copy in the provider
    // would be invisible to every assertion above.
    const source = readRepoFile("lib/collections-context.tsx");
    assert.match(source, /\.sort\(byCollectionOrder\)/);
    assert.doesNotMatch(
      source,
      /typeof\s+a\.sortOrder\s*===\s*"number"/,
      "the provider re-inlined the sortOrder comparator instead of using byCollectionOrder",
    );
  });
});
