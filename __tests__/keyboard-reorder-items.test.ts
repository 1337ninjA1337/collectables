/**
 * The pointer-free reorder on the screen a collector actually reorders in.
 *
 * `app/index.tsx` got these actions first because it is the easy half: no
 * filtering between the rendered list and the writer, so the row's index IS
 * its position. `app/collection/[id].tsx` is not that. It renders a chunked
 * PAGE of a filtered list, and its `onDragEnd` has always carried a rule about
 * the rest — the unrendered remainder keeps the order it had, or every item
 * below the page boundary gets renumbered against a slice the user never saw.
 *
 * A keyboard move has to obey the same rule, so this change moved it out of
 * the `onDragEnd` literal and into `orderWithUnrenderedTail`. That function is
 * pure and importable, which is why the rule is asserted here as behaviour and
 * only its ADOPTION is asserted as structure.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { moveItem, orderWithUnrenderedTail } from "@/lib/drag-reorder";
import { readRepoFile } from "./helpers/repo-file";

function readScreenSrc(): string {
  return readRepoFile("app/collection/[id].tsx");
}

/** The `renderItemRow` body, which is where the actions live. */
function renderer(): string {
  const src = readScreenSrc();
  const start = src.indexOf("const renderItemRow =");
  assert.ok(start > 0, "expected to find renderItemRow in the collection screen");
  const end = src.indexOf("\n  // VM-D:", start);
  assert.ok(end > start, "expected renderItemRow to end before the VM-D note");
  return src.slice(start, end);
}

const row = (id: string) => ({ id });

describe("the unrendered tail — what it does", () => {
  const all = ["a", "b", "c", "d", "e"].map(row);
  const page = all.slice(0, 3);

  it("keeps the rows the page did not render, in the order they had", () => {
    assert.deepEqual(orderWithUnrenderedTail(page, all), ["a", "b", "c", "d", "e"]);
  });

  it("moves only the page, leaving the tail where it was", () => {
    const moved = moveItem(page, 2, 0);
    assert.deepEqual(orderWithUnrenderedTail(moved, all), ["c", "a", "b", "d", "e"]);
  });

  it("names every row exactly once", () => {
    // The failure this prevents is a duplicate or a dropped id reaching
    // `reorderItemsInCollection`, which renumbers from the list it is handed.
    const ids = orderWithUnrenderedTail(moveItem(page, 0, 2), all);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.length, all.length);
  });

  it("survives a page that is the whole list", () => {
    assert.deepEqual(orderWithUnrenderedTail(all, all), ["a", "b", "c", "d", "e"]);
  });

  it("survives an empty page and an empty list", () => {
    assert.deepEqual(orderWithUnrenderedTail([], all), ["a", "b", "c", "d", "e"]);
    assert.deepEqual(orderWithUnrenderedTail(page, []), ["a", "b", "c"]);
    assert.deepEqual(orderWithUnrenderedTail([], []), []);
  });

  it("does not duplicate a row the page holds and the list repeats", () => {
    // `items` and `visibleItems` are two views of one array, so a row is in
    // both — the page wins and the list contributes only what it left out.
    assert.deepEqual(orderWithUnrenderedTail([row("c"), row("a")], all), ["c", "a", "b", "d", "e"]);
  });
});

describe("the collection screen's reorder actions", () => {
  it("delegates the action pair to lib/reorder-actions.ts, and spreads both props", () => {
    // The twelve lines this used to pin were duplicated character for
    // character in `app/index.tsx`. `reorderActionProps` owns them now; which
    // actions exist and where they land is run as a function in
    // reorder-actions.test.ts rather than matched here.
    assert.match(readScreenSrc(), /import \{ reorderActionProps \} from "@\/lib\/reorder-actions";/);
    const body = renderer();
    assert.match(body, /const reorderActions = reorderActionProps\(\{/);
    assert.match(body, /label: t,/);
    // `accessibilityActions` without its handler is a list of actions a screen
    // reader offers and nothing answers.
    assert.match(body, /\{\.\.\.reorderActions\}/);
  });

  it("gates them on isDragBranch, not merely on ownership", () => {
    // Under a non-default sort the visible order is not the manual one, so
    // committing it from a keyboard corrupts exactly what dragging is blocked
    // from corrupting. The screen already says so in the reorder-blocked
    // notice; these actions disappear for the same reason.
    // `enabled` is the whole gate: reorderActionProps offers nothing at all
    // when it is false, so a sorted list cannot be committed from a keyboard.
    assert.match(renderer(), /enabled: isDragBranch,/);
  });

  it("is declared after isDragBranch so the gate is not read before it exists", () => {
    const src = readScreenSrc();
    assert.ok(
      src.indexOf("const isDragBranch =") < src.indexOf("const renderItemRow ="),
      "isDragBranch must be derived above renderItemRow",
    );
  });

  it("moves within the visible page, which is what the row's index counts", () => {
    // `getIndex()` is the index into `data`, and `data` is `visibleItems`.
    // Moving within `items` would be off by every row the filter dropped —
    // `rows` is what reorderActionProps computes the move against.
    const body = renderer();
    assert.match(body, /rows: visibleItems,/);
    assert.match(body, /commit: commitItemOrder,/);
  });

  it("reads the row's own index rather than assuming one", () => {
    // `getIndex()` is `number | undefined` for a windowed row the list has not
    // placed; the guard for that moved into `reorderActionProps` with the rest
    // of the wiring, so what stays here is the read.
    assert.match(renderer(), /const index = getIndex\(\);/);
  });

  it("keeps the long press for owners, and only for owners", () => {
    // The wrapper that announces the pick-up and then calls `drag()` moved
    // into `reorderActionProps`. What stays here is the ownership decision:
    // withholding `drag` is what leaves a viewer's row with no long press at
    // all, rather than one that announces a pick-up they cannot perform.
    assert.match(renderer(), /drag: isOwner \? drag : undefined,/);
  });
});

describe("the collection screen's two reorder routes", () => {
  it("commit through one function", () => {
    // The whole point of the extraction: the drag and the actions cannot drift
    // on what happens to the rows below the page boundary.
    const src = readScreenSrc();
    assert.match(
      src,
      /const commitItemOrder = \(page: CollectableItem\[\]\) => \{\n\s*reorderItemsInCollection\(activeCollection\.id, orderWithUnrenderedTail\(page, items\)\);\n\s*\};/,
    );
    assert.match(src, /onDragEnd=\{\(\{ data, to \}\) => \{\n\s*commitItemOrder\(data\);/);
  });

  it("leaves no second copy of the tail rule in the screen", () => {
    // The rule was inline in `onDragEnd` before this change; a leftover copy
    // is the drift the extraction exists to prevent.
    const src = readScreenSrc();
    assert.doesNotMatch(src, /const visibleIds = new Set\(visibleItems\.map/);
    assert.doesNotMatch(src, /\[\.\.\.data, \.\.\.tail\]/);
  });

  it("writes through reorderItemsInCollection exactly once", () => {
    const src = readScreenSrc();
    const calls = src.match(/reorderItemsInCollection\(/g) ?? [];
    assert.equal(
      calls.length,
      1,
      `expected one call site for reorderItemsInCollection, found ${calls.length}`,
    );
  });

  it("imports the tail rule from the module that owns it, and no longer moveItem", () => {
    // `moveItem` reaches this screen through `reorderActionProps` now — a
    // second call site for "where does the row land" is what the extraction
    // removed.
    const src = readScreenSrc();
    assert.match(src, /import \{ orderWithUnrenderedTail \} from "@\/lib\/drag-reorder";/);
    assert.doesNotMatch(src, /import \{ moveItem/);
  });
});
