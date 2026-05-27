import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { userScopedCollectionId } from "@/lib/collections-helpers";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("userScopedCollectionId", () => {
  it("composes `${userId}-${suffix}` for the Acquired-marketplace collection", () => {
    assert.equal(
      userScopedCollectionId("u-1", "acquired-marketplace"),
      "u-1-acquired-marketplace",
    );
  });

  it("works with arbitrary system-managed suffixes (wishlist, trash, etc.)", () => {
    assert.equal(userScopedCollectionId("u-2", "wishlist"), "u-2-wishlist");
    assert.equal(userScopedCollectionId("u-3", "trash"), "u-3-trash");
  });

  it("does not mutate or sanitise the inputs (callers own the validation)", () => {
    // Empty parts are passed through verbatim — the helper is a pure
    // concatenator, not a validator. Test pins this so a future
    // sanitisation step is a *conscious* breaking change, not an accident.
    assert.equal(userScopedCollectionId("", "wishlist"), "-wishlist");
    assert.equal(userScopedCollectionId("u-1", ""), "u-1-");
  });
});

describe("transferItemToBuyer uses userScopedCollectionId", () => {
  it("composes the Acquired collection id via the new helper, not a template string", () => {
    const src = read("lib/collections-context.tsx");
    assert.match(
      src,
      /import\s+\{\s*userScopedCollectionId\s*\}\s+from\s+"@\/lib\/collections-helpers"/,
    );
    assert.match(
      src,
      /userScopedCollectionId\(ownerUserId,\s*ACQUIRED_COLLECTION_ID_SUFFIX\)/,
    );
    // The legacy `${ownerUserId}-${ACQUIRED_COLLECTION_ID_SUFFIX}` template
    // is gone; a regression that re-inlines it would silently bypass the
    // future cross-suffix invariants the helper might add.
    assert.doesNotMatch(
      src,
      /`\$\{ownerUserId\}-\$\{ACQUIRED_COLLECTION_ID_SUFFIX\}`/,
    );
  });
});
