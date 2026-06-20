import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { selectOwnedForImport } from "@/lib/cloud-import";
import { cloudImportedKey } from "@/lib/storage-keys";
import type { CollectableItem, Collection } from "@/lib/types";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function makeCollection(over: Partial<Collection>): Collection {
  return {
    id: "c1",
    name: "Vinyl",
    coverPhoto: "",
    description: "",
    ownerName: "",
    ownerUserId: ME,
    sharedWith: [],
    sharedWithUserIds: [],
    role: "owner",
    visibility: "private",
    ...over,
  };
}

function makeItem(over: Partial<CollectableItem>): CollectableItem {
  return {
    id: "i1",
    collectionId: "c1",
    title: "Record",
    acquiredAt: "",
    acquiredFrom: "",
    description: "",
    variants: "",
    photos: [],
    createdBy: "",
    createdByUserId: ME,
    createdAt: "2026-06-20T00:00:00Z",
    ...over,
  };
}

// --- selectOwnedForImport (pure) ---
describe("selectOwnedForImport", () => {
  it("returns empty for empty inputs", () => {
    const { collections, items } = selectOwnedForImport([], [], ME);
    assert.deepEqual(collections, []);
    assert.deepEqual(items, []);
  });

  it("keeps only collections owned by the user with role owner", () => {
    const mine = makeCollection({ id: "c1", ownerUserId: ME, role: "owner" });
    const theirs = makeCollection({ id: "c2", ownerUserId: OTHER, role: "owner" });
    const { collections } = selectOwnedForImport([mine, theirs], [], ME);
    assert.deepEqual(collections.map((c) => c.id), ["c1"]);
  });

  it("excludes a collection the user merely views (role viewer) even if ownerUserId matches", () => {
    // role is the authoritative signal — a viewer copy must never be re-uploaded.
    const viewerCopy = makeCollection({ id: "c1", ownerUserId: ME, role: "viewer" });
    const { collections } = selectOwnedForImport([viewerCopy], [], ME);
    assert.deepEqual(collections, []);
  });

  it("keeps items belonging to an owned collection", () => {
    const mine = makeCollection({ id: "c1", ownerUserId: ME, role: "owner" });
    const item = makeItem({ id: "i1", collectionId: "c1" });
    const { items } = selectOwnedForImport([mine], [item], ME);
    assert.deepEqual(items.map((i) => i.id), ["i1"]);
  });

  it("drops items in a collection the user doesn't own", () => {
    const theirs = makeCollection({ id: "c2", ownerUserId: OTHER, role: "viewer" });
    const item = makeItem({ id: "i1", collectionId: "c2", createdByUserId: OTHER });
    const { items } = selectOwnedForImport([theirs], [item], ME);
    assert.deepEqual(items, []);
  });

  it("keeps the user's own wishlist items even without an owned collection", () => {
    const wish = makeItem({
      id: "w1",
      collectionId: "",
      isWishlist: true,
      createdByUserId: ME,
    });
    const { items } = selectOwnedForImport([], [wish], ME);
    assert.deepEqual(items.map((i) => i.id), ["w1"]);
  });

  it("drops another user's wishlist items", () => {
    const wish = makeItem({
      id: "w1",
      collectionId: "",
      isWishlist: true,
      createdByUserId: OTHER,
    });
    const { items } = selectOwnedForImport([], [wish], ME);
    assert.deepEqual(items, []);
  });

  it("does not mutate the input arrays", () => {
    const cols = [makeCollection({ id: "c1" })];
    const items = [makeItem({ id: "i1" })];
    const colsCopy = [...cols];
    const itemsCopy = [...items];
    selectOwnedForImport(cols, items, ME);
    assert.deepEqual(cols, colsCopy);
    assert.deepEqual(items, itemsCopy);
  });
});

// --- storage key ---
describe("cloudImportedKey", () => {
  it("is per-user and versioned", () => {
    assert.equal(cloudImportedKey(ME), `collectables-cloud-imported-v1-${ME}`);
  });
});

// --- structural wiring guards ---
const root = process.cwd();
const cloudImportSrc = readFileSync(
  path.join(root, "lib", "cloud-import.ts"),
  "utf8",
);
const storageKeysSrc = readFileSync(
  path.join(root, "lib", "storage-keys.ts"),
  "utf8",
);
const contextSrc = readFileSync(
  path.join(root, "lib", "collections-context.tsx"),
  "utf8",
);

describe("cloud-import flag helpers (structural)", () => {
  it("hasCloudImported / markCloudImported are keyed via cloudImportedKey", () => {
    assert.match(cloudImportSrc, /export async function hasCloudImported/);
    assert.match(cloudImportSrc, /export async function markCloudImported/);
    assert.match(cloudImportSrc, /cloudImportedKey\(userId\)/);
  });
});

describe("clearAllUserData resets the import flag", () => {
  it("includes cloudImportedKey in the per-user reset", () => {
    assert.match(storageKeysSrc, /cloudImportedKey\(userId\),/);
  });
});

describe("collections-context one-time import wiring", () => {
  it("imports the helpers", () => {
    assert.match(contextSrc, /selectOwnedForImport/);
    assert.match(contextSrc, /hasCloudImported/);
    assert.match(contextSrc, /markCloudImported/);
  });

  it("gates the import on the flag and only marks done after the writes", () => {
    assert.match(contextSrc, /if \(await hasCloudImported\(activeUser\.id\)\) return;/);
    assert.match(contextSrc, /await markCloudImported\(activeUser\.id\);/);
  });

  it("upserts collections before items (FK order)", () => {
    const colIdx = contextSrc.indexOf("for (const collection of collections)");
    const itemIdx = contextSrc.indexOf("for (const item of items)");
    assert.ok(colIdx > 0 && itemIdx > 0 && colIdx < itemIdx);
  });
});
