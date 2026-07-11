import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { hasReplacedPhotoSet } from "../lib/analytics-helpers";
import { ANALYTICS_EVENTS } from "../lib/analytics-events";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("hasReplacedPhotoSet — pure replacement predicate", () => {
  it("true when a URI is swapped at the same count", () => {
    assert.equal(hasReplacedPhotoSet(["a", "b"], ["a", "c"]), true);
  });

  it("true when the count changes on a non-empty set", () => {
    assert.equal(hasReplacedPhotoSet(["a"], ["a", "b"]), true);
    assert.equal(hasReplacedPhotoSet(["a", "b"], ["a"]), true);
  });

  it("false for the identical set, even reordered", () => {
    assert.equal(hasReplacedPhotoSet(["a", "b"], ["a", "b"]), false);
    assert.equal(hasReplacedPhotoSet(["a", "b"], ["b", "a"]), false);
  });

  it("false for the attach edge (none → some) — that's item_photo_attached", () => {
    assert.equal(hasReplacedPhotoSet([], ["a"]), false);
  });

  it("false for a removal (some → none) — not a replacement", () => {
    assert.equal(hasReplacedPhotoSet(["a"], []), false);
  });
});

describe("item_photos_replaced — taxonomy registration", () => {
  it("is registered with the payload's exact prop keys", () => {
    const def = ANALYTICS_EVENTS.item_photos_replaced;
    assert.ok(def.description.length > 0);
    assert.deepEqual(
      [...def.props].sort(),
      ["collectionId", "itemId", "photoCount"],
    );
  });
});

describe("app/item/[id].tsx — item_photos_replaced wiring", () => {
  const src = read("app/item/[id].tsx");

  it("imports hasReplacedPhotoSet from @/lib/analytics-helpers", () => {
    assert.match(
      src,
      /import\s*\{[^}]*\bhasReplacedPhotoSet\b[^}]*\}\s*from\s*["']@\/lib\/analytics-helpers["']/,
    );
  });

  it("captures previousPhotos before the updateItem mutation", () => {
    const handlerIdx = src.indexOf("handleSaveEdit()");
    const updateIdx = src.indexOf("await updateItem(", handlerIdx);
    const prevIdx = src.indexOf("const previousPhotos = activeItem.photos", handlerIdx);
    assert.ok(prevIdx >= 0, "must snapshot previousPhotos");
    assert.ok(
      prevIdx < updateIdx,
      "previousPhotos must be captured before updateItem mutates the item",
    );
  });

  it("fires as the else-branch of the attach edge (mutually exclusive events)", () => {
    assert.match(
      src,
      /\}\s*else\s+if\s*\(\s*hasReplacedPhotoSet\s*\(\s*previousPhotos\s*,\s*finalPhotos\s*\)\s*\)\s*\{\s*trackEvent\(\s*"item_photos_replaced"/,
      "a single save must fire either item_photo_attached or item_photos_replaced, never both",
    );
  });

  it("sends itemId + collectionId + photoCount", () => {
    const trackIdx = src.indexOf('trackEvent("item_photos_replaced"');
    assert.ok(trackIdx >= 0);
    const block = src.slice(trackIdx, trackIdx + 250);
    assert.match(block, /itemId:\s*activeItem\.id/);
    assert.match(block, /collectionId:\s*activeItem\.collectionId/);
    assert.match(block, /photoCount:\s*finalPhotos\.length/);
  });
});
