import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { addViewerToSharedIds, shouldAutoSaveSharedCollection } from "@/lib/share-access";
import { Collection } from "@/lib/types";

function makeCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: "col-1",
    name: "Test",
    coverPhoto: "",
    description: "",
    ownerName: "Alice",
    ownerUserId: "owner-1",
    sharedWith: [],
    sharedWithUserIds: [],
    role: "viewer",
    visibility: "private",
    ...overrides,
  };
}

describe("shouldAutoSaveSharedCollection", () => {
  it("returns false when collection is missing", () => {
    assert.equal(shouldAutoSaveSharedCollection(null, "user-1"), false);
    assert.equal(shouldAutoSaveSharedCollection(undefined, "user-1"), false);
  });

  it("returns false when user id is missing", () => {
    assert.equal(shouldAutoSaveSharedCollection(makeCollection(), null), false);
    assert.equal(shouldAutoSaveSharedCollection(makeCollection(), undefined), false);
    assert.equal(shouldAutoSaveSharedCollection(makeCollection(), ""), false);
  });

  it("returns false when the viewer is the owner", () => {
    const col = makeCollection({ ownerUserId: "viewer-1" });
    assert.equal(shouldAutoSaveSharedCollection(col, "viewer-1"), false);
  });

  it("returns false when the collection is public", () => {
    const col = makeCollection({ visibility: "public" });
    assert.equal(shouldAutoSaveSharedCollection(col, "viewer-1"), false);
  });

  it("returns false when the viewer is already in sharedWithUserIds", () => {
    const col = makeCollection({ sharedWithUserIds: ["viewer-1"] });
    assert.equal(shouldAutoSaveSharedCollection(col, "viewer-1"), false);
  });

  it("returns true when viewer opens a private collection they do not own yet", () => {
    const col = makeCollection();
    assert.equal(shouldAutoSaveSharedCollection(col, "viewer-1"), true);
  });

  it("handles missing sharedWithUserIds gracefully", () => {
    const col = makeCollection();
    // Simulate older record without the field.
    const legacy = { ...col, sharedWithUserIds: undefined as unknown as string[] };
    assert.equal(shouldAutoSaveSharedCollection(legacy, "viewer-1"), true);
  });
});

describe("addViewerToSharedIds", () => {
  it("appends a new viewer", () => {
    assert.deepEqual(addViewerToSharedIds(["a"], "b"), ["a", "b"]);
  });

  it("deduplicates existing viewers", () => {
    assert.deepEqual(addViewerToSharedIds(["a", "b"], "a"), ["a", "b"]);
  });

  it("handles undefined existing list", () => {
    assert.deepEqual(addViewerToSharedIds(undefined, "a"), ["a"]);
  });

  it("returns a fresh array (does not mutate input)", () => {
    const input: string[] = ["a"];
    const result = addViewerToSharedIds(input, "b");
    assert.notStrictEqual(result, input);
    assert.deepEqual(input, ["a"]);
  });
});
