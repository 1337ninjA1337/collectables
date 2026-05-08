import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  hasNewCloudEntries,
  mergeCollectionsFromCloud,
  mergeItemsFromCloud,
} from "../lib/collections-cloud-merge";
import type { Collection, CollectableItem } from "../lib/types";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const ownerId = "user-1";

function makeCollection(overrides: Partial<Collection>): Collection {
  return {
    id: "c-1",
    name: "Default",
    description: "",
    coverPhoto: "",
    ownerName: "owner",
    ownerUserId: ownerId,
    role: "viewer",
    visibility: "public",
    sortOrder: 0,
    sharedWith: [],
    sharedWithUserIds: [],
    ...overrides,
  };
}

function makeItem(overrides: Partial<CollectableItem>): CollectableItem {
  return {
    id: "i-1",
    collectionId: "c-1",
    title: "Default",
    acquiredAt: "",
    acquiredFrom: "",
    description: "",
    variants: "",
    photos: [],
    createdBy: "owner",
    createdByUserId: ownerId,
    createdAt: "2026-05-01T00:00:00.000Z",
    cost: null,
    sortOrder: 0,
    ...overrides,
  };
}

describe("mergeCollectionsFromCloud", () => {
  it("adds a cloud-only collection to the local list", () => {
    const local = [makeCollection({ id: "c-local", role: "owner" })];
    const cloud = [makeCollection({ id: "c-cloud" })];
    const merged = mergeCollectionsFromCloud(local, cloud, ownerId);
    assert.deepEqual(
      merged.map((c) => c.id).sort(),
      ["c-cloud", "c-local"].sort(),
    );
  });

  it("promotes role to 'owner' when ownerUserId matches the active user", () => {
    const cloud = [makeCollection({ id: "c-cloud", role: "viewer" })];
    const merged = mergeCollectionsFromCloud([], cloud, ownerId);
    assert.equal(merged[0].role, "owner");
  });

  it("keeps role='viewer' for cloud rows owned by someone else", () => {
    const cloud = [
      makeCollection({ id: "c-other", ownerUserId: "user-2", role: "viewer" }),
    ];
    const merged = mergeCollectionsFromCloud([], cloud, ownerId);
    assert.equal(merged[0].role, "viewer");
  });

  it("does NOT downgrade an existing local 'owner' role to 'viewer'", () => {
    const local = [makeCollection({ id: "c-1", role: "owner" })];
    const cloud = [makeCollection({ id: "c-1", role: "viewer" })];
    const merged = mergeCollectionsFromCloud(local, cloud, ownerId);
    assert.equal(merged.find((c) => c.id === "c-1")!.role, "owner");
  });

  it("preserves local-only collections (offline write not yet synced)", () => {
    const local = [makeCollection({ id: "c-pending", role: "owner" })];
    const cloud: Collection[] = [];
    const merged = mergeCollectionsFromCloud(local, cloud, ownerId);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, "c-pending");
  });

  it("cloud row wins on conflict (prefer cloud-fresh fields)", () => {
    const local = [
      makeCollection({ id: "c-1", name: "old-name", description: "stale" }),
    ];
    const cloud = [
      makeCollection({ id: "c-1", name: "fresh-name", description: "fresh" }),
    ];
    const merged = mergeCollectionsFromCloud(local, cloud, ownerId);
    const updated = merged.find((c) => c.id === "c-1")!;
    assert.equal(updated.name, "fresh-name");
    assert.equal(updated.description, "fresh");
  });
});

describe("mergeItemsFromCloud", () => {
  it("adds a cloud-only item to the local list", () => {
    const local = [makeItem({ id: "i-local" })];
    const cloud = [makeItem({ id: "i-cloud" })];
    const merged = mergeItemsFromCloud(local, cloud);
    assert.deepEqual(merged.map((i) => i.id).sort(), ["i-cloud", "i-local"].sort());
  });

  it("preserves local-only items (offline write not yet synced)", () => {
    const local = [makeItem({ id: "i-pending" })];
    const cloud: CollectableItem[] = [];
    const merged = mergeItemsFromCloud(local, cloud);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, "i-pending");
  });

  it("cloud row wins on conflict (prefer cloud-fresh fields)", () => {
    const local = [makeItem({ id: "i-1", title: "old", description: "stale" })];
    const cloud = [makeItem({ id: "i-1", title: "fresh", description: "fresh" })];
    const merged = mergeItemsFromCloud(local, cloud);
    const updated = merged.find((i) => i.id === "i-1")!;
    assert.equal(updated.title, "fresh");
    assert.equal(updated.description, "fresh");
  });

  it("returns an empty array when both inputs are empty", () => {
    assert.deepEqual(mergeItemsFromCloud([], []), []);
  });
});

describe("hasNewCloudEntries", () => {
  it("returns true when cloud has an ID not in local", () => {
    assert.equal(hasNewCloudEntries(new Set(["a"]), ["a", "b"]), true);
  });
  it("returns false when every cloud ID is already in local", () => {
    assert.equal(hasNewCloudEntries(new Set(["a", "b"]), ["a", "b"]), false);
  });
  it("returns false when cloud is empty", () => {
    assert.equal(hasNewCloudEntries(new Set(["a"]), []), false);
  });
  it("returns true when local is empty and cloud has entries", () => {
    assert.equal(hasNewCloudEntries(new Set(), ["a"]), true);
  });
});

describe("CollectionsProvider — cloud-sync effect wiring", () => {
  const src = read("lib/collections-context.tsx");

  it("imports the merge helpers from collections-cloud-merge", () => {
    assert.match(
      src,
      /from\s+["']@\/lib\/collections-cloud-merge["']/,
      "collections-context must import the merge helpers",
    );
    for (const symbol of [
      "hasNewCloudEntries",
      "mergeCollectionsFromCloud",
      "mergeItemsFromCloud",
    ]) {
      assert.match(
        src,
        new RegExp(`\\b${symbol}\\b`),
        `collections-context must use ${symbol}`,
      );
    }
  });

  it("declares a cloud-sync useEffect that depends on [user, ready, refreshTick]", () => {
    // The deps array of the new effect must contain all three so refresh() reaches it.
    assert.match(
      src,
      /\}, \[user, ready, refreshTick\]\)/,
      "cloud-sync effect must depend on [user, ready, refreshTick] so refresh() retriggers it",
    );
  });

  it("calls fetchCollectionsByUserId AND fetchItemsByCollectionId in the cloud-sync effect", () => {
    // Both functions are already imported; verify they're referenced in the
    // syncFromCloud function (the second usage — first is the original
    // empty-only bootstrap).
    const calls = src.match(/fetchCollectionsByUserId\(/g) ?? [];
    assert.ok(
      calls.length >= 2,
      "fetchCollectionsByUserId must appear in both the bootstrap path and the new cloud-sync effect",
    );
    const itemCalls = src.match(/fetchItemsByCollectionId\(/g) ?? [];
    assert.ok(
      itemCalls.length >= 2,
      "fetchItemsByCollectionId must appear in both the bootstrap and the cloud-sync paths",
    );
  });

  it("guards the cloud-sync effect on `ready` so it doesn't race the local-first paint", () => {
    // The new effect must early-return when !ready.
    const syncIdx = src.indexOf("syncFromCloud");
    assert.ok(syncIdx >= 0, "syncFromCloud function not declared");
    // The useEffect immediately preceding the syncFromCloud declaration
    // must contain `if (!ready || !user) return;`
    const head = src.slice(Math.max(0, syncIdx - 600), syncIdx);
    assert.match(
      head,
      /if\s*\(\s*!ready\s*\|\|\s*!user\s*\)\s*return;/,
      "cloud-sync effect must guard on (!ready || !user) to wait for the local-first paint",
    );
  });

  it("uses functional setState so cross-device merges don't clobber concurrent local writes", () => {
    // setLocalCollections((current) => ...) and setLocalItems((current) => ...)
    // must both appear in the cloud-sync section to avoid stale-closure overwrites.
    const syncIdx = src.indexOf("syncFromCloud");
    const block = src.slice(syncIdx, syncIdx + 2500);
    assert.match(
      block,
      /setLocalCollections\(\s*\(\s*current\s*\)\s*=>/,
      "cloud-sync effect must use setLocalCollections((current) => ...) for concurrency safety",
    );
    assert.match(
      block,
      /setLocalItems\(\s*\(\s*current\s*\)\s*=>/,
      "cloud-sync effect must use setLocalItems((current) => ...) for concurrency safety",
    );
  });

  it("short-circuits the setState when no new cloud entries arrived (avoid storage write storm)", () => {
    const syncIdx = src.indexOf("syncFromCloud");
    const block = src.slice(syncIdx, syncIdx + 2500);
    assert.match(
      block,
      /if\s*\(\s*!hasNewCloudEntries\(/,
      "cloud-sync effect must early-return setState when nothing is new",
    );
  });
});
