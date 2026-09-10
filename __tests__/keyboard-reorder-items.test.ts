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
  it("offers both moves as named actions with translated labels", () => {
    const body = renderer();
    assert.match(body, /\{ name: "moveUp", label: t\("moveUp"\) \}/);
    assert.match(body, /\{ name: "moveDown", label: t\("moveDown"\) \}/);
    assert.match(body, /actionName === "moveUp"\) moveBy\(-1\)/);
    assert.match(body, /actionName === "moveDown"\) moveBy\(1\)/);
  });

  it("gates them on isDragBranch, not merely on ownership", () => {
    // Under a non-default sort the visible order is not the manual one, so
    // committing it from a keyboard corrupts exactly what dragging is blocked
    // from corrupting. The screen already says so in the reorder-blocked
    // notice; these actions disappear for the same reason.
    const body = renderer();
    assert.match(body, /const canMoveUp = isDragBranch && index !== undefined && index > 0;/);
    assert.match(
      body,
      /const canMoveDown = isDragBranch && index !== undefined && index < visibleItems\.length - 1;/,
    );
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
    // Moving within `items` would be off by every row the filter dropped.
    const body = renderer();
    assert.match(body, /commitItemOrder\(moveItem\(visibleItems, index, index \+ delta\)\)/);
  });

  it("does nothing when the row has no index", () => {
    const body = renderer();
    assert.match(body, /const index = getIndex\(\);/);
    assert.match(body, /if \(index === undefined\) return;/);
  });

  it("keeps the long press for owners", () => {
    assert.match(renderer(), /onLongPress=\{isOwner \? drag : undefined\}/);
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
    assert.match(src, /onDragEnd=\{\(\{ data \}\) => commitItemOrder\(data\)\}/);
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

  it("imports both helpers from the module that owns them", () => {
    assert.match(
      readScreenSrc(),
      /import \{ moveItem, orderWithUnrenderedTail \} from "@\/lib\/drag-reorder";/,
    );
  });
});
