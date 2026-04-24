import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { seedCollections, seedItems } from "@/data/seed";

describe("seed", () => {
  it("seedCollections is an array", () => {
    assert.ok(Array.isArray(seedCollections));
  });

  it("seedItems is an array", () => {
    assert.ok(Array.isArray(seedItems));
  });

  it("every seed item references an existing seed collection (if any)", () => {
    const collectionIds = new Set(seedCollections.map((c) => c.id));
    for (const item of seedItems) {
      if (collectionIds.size > 0) {
        assert.ok(
          collectionIds.has(item.collectionId),
          `item ${item.id} references unknown collection ${item.collectionId}`,
        );
      }
    }
  });
});
