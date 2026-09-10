import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  byOwnedCollectionOrder,
  nextCollectionSortOrder,
  planCollectionReorder,
} from "@/lib/collections-helpers";
import type { Collection } from "@/lib/types";
import { readRepoFile } from "./helpers/repo-file";

/**
 * The home screen's collection order.
 *
 * `reorderOwnedCollections` has written `sortOrder` since the drag shipped —
 * to the local row and to the cloud column — while the list rendered the array
 * it also reordered. The number was written, synced, and never read, so a
 * second device pulled the rows and showed them in merge order. These cases
 * pin the read side, the dense-run write, and the newcomer's place.
 */
function collection(id: string, overrides: Partial<Collection> = {}): Collection {
  return {
    id,
    name: `Collection ${id}`,
    coverPhoto: "",
    description: "",
    ownerName: "You",
    ownerUserId: "u1",
    sharedWith: [],
    sharedWithUserIds: [],
    role: "owner",
    visibility: "private",
    ...overrides,
  };
}

const ids = (rows: readonly Collection[]) => rows.map((c) => c.id);

describe("byOwnedCollectionOrder", () => {
  it("puts a dragged collection ahead of one that was never dragged", () => {
    assert.ok(byOwnedCollectionOrder(collection("a", { sortOrder: 3 }), collection("b")) < 0);
    assert.ok(byOwnedCollectionOrder(collection("b"), collection("a", { sortOrder: 3 })) > 0);
  });

  it("treats sortOrder 0 as present, not as missing", () => {
    // `if (c.sortOrder)` would demote the collection the user dragged to the
    // very top — the one position they are sure to notice.
    assert.ok(byOwnedCollectionOrder(collection("a", { sortOrder: 0 }), collection("b")) < 0);
  });

  it("orders two dragged collections ascending by sortOrder", () => {
    assert.ok(byOwnedCollectionOrder(collection("z", { sortOrder: 1 }), collection("a", { sortOrder: 2 })) < 0);
  });

  it("breaks a cross-device sortOrder tie by id rather than by input order", () => {
    const rows = [
      collection("c", { sortOrder: 2 }),
      collection("a", { sortOrder: 2 }),
      collection("b", { sortOrder: 2 }),
    ];
    assert.deepEqual(ids([...rows].sort(byOwnedCollectionOrder)), ["a", "b", "c"]);
    assert.deepEqual(ids([...rows].reverse().sort(byOwnedCollectionOrder)), ["a", "b", "c"]);
  });

  it("keeps two undragged collections in the order they came in", () => {
    // No `createdAt` on the row to rank them by, so the comparator returns 0
    // and the stable sort preserves the array — which is newest-first, because
    // addCollection prepends.
    const rows = [collection("new"), collection("older"), collection("oldest")];
    assert.equal(byOwnedCollectionOrder(rows[0], rows[1]), 0);
    assert.deepEqual(ids([...rows].sort(byOwnedCollectionOrder)), ["new", "older", "oldest"]);
  });

  it("sorts a mixed list dragged-first, undragged in array order", () => {
    const rows = [
      collection("fresh"),
      collection("second", { sortOrder: 1 }),
      collection("older"),
      collection("first", { sortOrder: 0 }),
    ];
    assert.deepEqual(ids([...rows].sort(byOwnedCollectionOrder)), ["first", "second", "fresh", "older"]);
  });
});

describe("planCollectionReorder", () => {
  it("numbers the named ids 0..N-1 in the order given", () => {
    const rows = [collection("a"), collection("b"), collection("c")];
    const plan = planCollectionReorder(rows, ["c", "a", "b"]);
    assert.deepEqual(ids([...plan.collections].sort(byOwnedCollectionOrder)), ["c", "a", "b"]);
    assert.deepEqual(
      plan.collections.map((c) => [c.id, c.sortOrder]),
      [
        ["a", 1],
        ["b", 2],
        ["c", 0],
      ],
    );
  });

  it("renumbers the owned collections the caller left out", () => {
    // Renumbering only `orderedIds` would write 0 over `a` while `c` keeps its
    // own 0 — two collections at index 0, from one device.
    const rows = [
      collection("a", { sortOrder: 2 }),
      collection("b", { sortOrder: 1 }),
      collection("c", { sortOrder: 0 }),
    ];
    const plan = planCollectionReorder(rows, ["a"]);
    const written = plan.collections.map((c) => c.sortOrder as number).sort((x, y) => x - y);
    assert.deepEqual(written, [0, 1, 2]);
    assert.deepEqual(ids([...plan.collections].sort(byOwnedCollectionOrder)), ["a", "c", "b"]);
  });

  it("skips an unknown id instead of letting it consume an index", () => {
    const rows = [collection("a"), collection("b")];
    const plan = planCollectionReorder(rows, ["ghost", "b", "a"]);
    assert.deepEqual(ids([...plan.collections].sort(byOwnedCollectionOrder)), ["b", "a"]);
  });

  it("counts a repeated id once, at its first appearance", () => {
    const rows = [collection("a"), collection("b"), collection("c")];
    const plan = planCollectionReorder(rows, ["b", "a", "b", "c"]);
    assert.deepEqual(ids([...plan.collections].sort(byOwnedCollectionOrder)), ["b", "a", "c"]);
  });

  it("leaves collections the user does not own untouched", () => {
    const rows = [
      collection("shared", { role: "viewer", ownerUserId: "u2", sortOrder: 9 }),
      collection("a"),
      collection("b"),
    ];
    const plan = planCollectionReorder(rows, ["shared", "b", "a"]);
    assert.equal(plan.collections.find((c) => c.id === "shared")?.sortOrder, 9);
    assert.deepEqual(plan.changed.map((c) => c.id).sort(), ["a", "b"]);
    assert.deepEqual(ids(plan.collections), ["shared", "a", "b"], "the array order of other rows moved");
  });

  it("returns nothing to write when the run is already the requested one", () => {
    const rows = [collection("a", { sortOrder: 0 }), collection("b", { sortOrder: 1 })];
    const plan = planCollectionReorder(rows, ["a", "b"]);
    assert.deepEqual(plan.changed, []);
    assert.equal(plan.collections, rows, "a no-op reorder allocated a new array");
  });

  it("does nothing when the user owns no collections", () => {
    const rows = [collection("shared", { role: "viewer" })];
    const plan = planCollectionReorder(rows, ["shared"]);
    assert.equal(plan.collections, rows);
    assert.deepEqual(plan.changed, []);
  });

  it("never mutates the input rows", () => {
    const rows = [collection("a", { sortOrder: 5 }), collection("b")];
    const snapshot = rows.map((c) => c.sortOrder);
    planCollectionReorder(rows, ["b", "a"]);
    assert.deepEqual(rows.map((c) => c.sortOrder), snapshot);
  });
});

describe("nextCollectionSortOrder", () => {
  it("stamps nothing while the user has never dragged", () => {
    // An undragged list renders in array order and addCollection prepends, so
    // the newcomer is already on top; stamping would invent a manual order.
    assert.equal(nextCollectionSortOrder([collection("a"), collection("b")]), undefined);
    assert.equal(nextCollectionSortOrder([]), undefined);
  });

  it("puts the newcomer one below the lowest existing index", () => {
    const rows = [collection("a", { sortOrder: 0 }), collection("b", { sortOrder: 1 })];
    assert.equal(nextCollectionSortOrder(rows), -1);
    assert.equal(nextCollectionSortOrder([...rows, collection("c", { sortOrder: -1 })]), -2);
  });

  it("lands the newcomer at the top of the rendered list", () => {
    const rows = [collection("a", { sortOrder: 0 }), collection("b", { sortOrder: 1 })];
    const fresh = collection("fresh", { sortOrder: nextCollectionSortOrder(rows) });
    assert.deepEqual(ids([fresh, ...rows].sort(byOwnedCollectionOrder)), ["fresh", "a", "b"]);
  });

  it("ignores collections the user does not own", () => {
    // A shared row's `sort_order` is its owner's business, not a floor for our
    // manual order.
    const rows = [collection("a"), collection("shared", { role: "viewer", sortOrder: -50 })];
    assert.equal(nextCollectionSortOrder(rows), undefined);
  });
});

describe("the provider reads the order back instead of trusting the array", () => {
  it("sorts the collections memo through byOwnedCollectionOrder", () => {
    const source = readRepoFile("lib/collections-context.tsx");
    assert.match(source, /\[\.\.\.localCollections\]\.sort\(byOwnedCollectionOrder\)/);
  });

  it("writes the reorder through planCollectionReorder", () => {
    const source = readRepoFile("lib/collections-context.tsx");
    assert.match(source, /planCollectionReorder\(localCollections, orderedIds\)/);
    assert.doesNotMatch(
      source,
      /orderedIds\.forEach\(\(id, index\)/,
      "the provider re-inlined the partial renumber planCollectionReorder replaced",
    );
  });

  it("stamps a new collection through nextCollectionSortOrder", () => {
    const source = readRepoFile("lib/collections-context.tsx");
    assert.match(source, /sortOrder: nextCollectionSortOrder\(localCollections\)/);
  });
});
