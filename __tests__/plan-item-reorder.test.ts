import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { planItemReorder } from "@/lib/collections-helpers";
import type { CollectableItem } from "@/lib/types";
import { readRepoFile } from "./helpers/repo-file";

/**
 * The writing half of the collection order.
 *
 * `byCollectionOrder` renders a duplicate `sortOrder` deterministically, but a
 * collision it renders is a collision that stayed in storage. These cases pin
 * the other half: what a reorder is allowed to persist, which is a dense
 * 0..N-1 run over the WHOLE collection and nothing else.
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

/** Every member's `sortOrder`, in the array order the plan returned. */
function orders(items: readonly CollectableItem[], collectionId = "c1") {
  return items.filter((i) => i.collectionId === collectionId).map((i) => [i.id, i.sortOrder] as const);
}

/** The plan's rendered order: what the collection screen would show next. */
function rendered(items: readonly CollectableItem[], collectionId = "c1") {
  return items
    .filter((i) => i.collectionId === collectionId)
    .slice()
    .sort((a, b) => (a.sortOrder as number) - (b.sortOrder as number))
    .map((i) => i.id);
}

describe("planItemReorder writes a dense run", () => {
  it("numbers the named ids 0..N-1 in the order given", () => {
    const rows = [item("a"), item("b"), item("c")];
    const plan = planItemReorder(rows, "c1", ["c", "a", "b"]);
    assert.deepEqual(rendered(plan.items), ["c", "a", "b"]);
    assert.deepEqual(orders(plan.items), [
      ["a", 1],
      ["b", 2],
      ["c", 0],
    ]);
  });

  it("renumbers the members the caller left out instead of leaving them to collide", () => {
    // The bug this closes: renumbering only `orderedIds` writes 0,1 over the
    // two named rows while `c` keeps its old 0 — two items at index 0, in
    // storage, from a single device.
    const rows = [
      item("a", { sortOrder: 2 }),
      item("b", { sortOrder: 1 }),
      item("c", { sortOrder: 0 }),
    ];
    const plan = planItemReorder(rows, "c1", ["a", "b"]);
    const written = orders(plan.items).map(([, order]) => order);
    assert.deepEqual([...written].sort((x, y) => (x as number) - (y as number)), [0, 1, 2]);
    // Named ids take the head; the unnamed member follows.
    assert.deepEqual(rendered(plan.items), ["a", "b", "c"]);
  });

  it("orders the left-out members by byCollectionOrder, not by array position", () => {
    // `d` and `e` were never named, so they keep the places the screen is
    // showing them in — dragged tier (sortOrder 0) ahead of the undragged one,
    // whatever order the id-keyed cloud merge handed the array over in.
    const rows = [
      item("e", { createdAt: AT(500) }),
      item("a"),
      item("d", { sortOrder: 0 }),
    ];
    const plan = planItemReorder(rows, "c1", ["a"]);
    assert.deepEqual(rendered(plan.items), ["a", "d", "e"]);
  });

  it("leaves every index dense after a full drag of a longer collection", () => {
    const rows = ["a", "b", "c", "d", "e"].map((id, index) => item(id, { sortOrder: index }));
    const plan = planItemReorder(rows, "c1", ["e", "d", "c", "b", "a"]);
    assert.deepEqual(rendered(plan.items), ["e", "d", "c", "b", "a"]);
    assert.deepEqual(
      orders(plan.items)
        .map(([, order]) => order)
        .sort((x, y) => (x as number) - (y as number)),
      [0, 1, 2, 3, 4],
    );
  });
});

describe("planItemReorder treats the id list as a request, not as gospel", () => {
  it("skips an id that names no member of this collection", () => {
    const rows = [item("a"), item("b")];
    const plan = planItemReorder(rows, "c1", ["ghost", "b", "a"]);
    // "ghost" must not consume index 0 and push the real rows down.
    assert.deepEqual(rendered(plan.items), ["b", "a"]);
    assert.deepEqual(orders(plan.items), [
      ["a", 1],
      ["b", 0],
    ]);
  });

  it("counts a repeated id once, at its first appearance", () => {
    const rows = [item("a"), item("b"), item("c")];
    const plan = planItemReorder(rows, "c1", ["b", "a", "b", "c"]);
    assert.deepEqual(rendered(plan.items), ["b", "a", "c"]);
  });

  it("ignores an id that belongs to another collection", () => {
    const rows = [item("a"), item("x", { collectionId: "c2", sortOrder: 7 })];
    const plan = planItemReorder(rows, "c1", ["x", "a"]);
    assert.deepEqual(rendered(plan.items), ["a"]);
    assert.deepEqual(
      plan.items.find((i) => i.id === "x")?.sortOrder,
      7,
      "a reorder in one collection perturbed another",
    );
  });

  it("keeps items from other collections at their place in the array", () => {
    const rows = [
      item("x", { collectionId: "c2" }),
      item("a"),
      item("y", { collectionId: "c2" }),
      item("b"),
    ];
    const plan = planItemReorder(rows, "c1", ["b", "a"]);
    assert.deepEqual(plan.items.map((i) => i.id), ["x", "a", "y", "b"]);
    assert.deepEqual(plan.changed.map((i) => i.id).sort(), ["a", "b"]);
  });
});

describe("planItemReorder reports only what moved", () => {
  it("returns nothing to write when the run is already the requested one", () => {
    const rows = [item("a", { sortOrder: 0 }), item("b", { sortOrder: 1 })];
    const plan = planItemReorder(rows, "c1", ["a", "b"]);
    assert.deepEqual(plan.changed, []);
    assert.equal(plan.items, rows, "a no-op reorder allocated a new array");
  });

  it("returns only the rows whose number changed", () => {
    // `a` is already at 0; only `b` and `c` swap.
    const rows = [
      item("a", { sortOrder: 0 }),
      item("b", { sortOrder: 1 }),
      item("c", { sortOrder: 2 }),
    ];
    const plan = planItemReorder(rows, "c1", ["a", "c", "b"]);
    assert.deepEqual(plan.changed.map((i) => i.id).sort(), ["b", "c"]);
  });

  it("does nothing at all for a collection with no items", () => {
    const rows = [item("x", { collectionId: "c2" })];
    const plan = planItemReorder(rows, "c1", ["x"]);
    assert.equal(plan.items, rows);
    assert.deepEqual(plan.changed, []);
  });

  it("never mutates the input rows", () => {
    const rows = [item("a", { sortOrder: 5 }), item("b")];
    const snapshot = rows.map((i) => i.sortOrder);
    planItemReorder(rows, "c1", ["b", "a"]);
    assert.deepEqual(rows.map((i) => i.sortOrder), snapshot);
  });
});

describe("the provider delegates the reorder rather than re-inlining it", () => {
  it("writes through planItemReorder", () => {
    const source = readRepoFile("lib/collections-context.tsx");
    assert.match(source, /\bplanItemReorder\(/);
    assert.doesNotMatch(
      source,
      /const\s+indexById\s*=\s*new\s+Map\(orderedIds\.map/,
      "the provider re-inlined the partial renumber planItemReorder replaced",
    );
  });

  it("computes the plan outside the setState updater", () => {
    // The rows to sync have to be known at call time; an updater that pushes
    // into a closure array only fills it when React runs it, which is a render.
    const source = readRepoFile("lib/collections-context.tsx");
    assert.doesNotMatch(
      source,
      /setLocalItems\(\(current\) => \{[^}]*planItemReorder/s,
      "planItemReorder was moved back inside the state updater",
    );
  });

  it("decides the collection reorder's sync list outside the updater too", () => {
    // The sibling had the same shape: `updated.push(next)` inside
    // `setLocalCollections((current) => …)`, then a synchronous
    // `updated.forEach(sync…)` reading an array React had not necessarily
    // filled yet — a reorder the cloud never hears about.
    const source = readRepoFile("lib/collections-context.tsx");
    assert.doesNotMatch(
      source,
      /setLocalCollections\(\(current\) => \{[^}]*updated\.push/s,
      "reorderOwnedCollections collects its sync list inside the state updater",
    );
    assert.match(source, /const byId = new Map\(localCollections\.map/);
  });
});
