import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  hasNewCloudEntries,
  mergeCollectionsFromCloud,
  mergeItemsFromCloud,
} from "../lib/collections-cloud-merge";
import type { Collection, CollectableItem } from "../lib/types";
import { readRepoFile as read } from "./helpers/repo-file";

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

describe("the cloud merges keep their input reference when nothing changed", () => {
  /**
   * The no-op contract every neighbouring helper states and these two did not.
   *
   * The delta window is `updated_at=gt` over a timestamp, so the boundary row
   * comes back on the next pull by construction — and a merge that always
   * allocated made `setLocalItems` see a new reference for it, which re-rendered
   * every collection screen and rewrote both AsyncStorage blobs for a row the
   * device already held.
   *
   * `structuredClone` rather than the same object: a re-fetched row is freshly
   * parsed JSON, so equal-but-not-identical is the whole point. A reference test
   * against the identical object would pass without the field comparison.
   */
  it("returns the local items when the cloud row is an equal copy", () => {
    const local = [makeItem({ id: "i-1", photos: ["a.jpg"], tags: [{ label: "rare", color: "#d89c5b" }] })];
    assert.equal(mergeItemsFromCloud(local, structuredClone(local)), local);
  });

  it("returns the local collections when the cloud row is an equal copy", () => {
    const local = [makeCollection({ id: "c-1", role: "owner", sharedWithUserIds: ["u-2"] })];
    assert.equal(mergeCollectionsFromCloud(local, structuredClone(local), ownerId), local);
  });

  it("still allocates when one field of one row differs", () => {
    const local = [makeItem({ id: "i-1", title: "Charizard" }), makeItem({ id: "i-2" })];
    const cloud = structuredClone(local);
    cloud[1] = { ...cloud[1], description: "changed" };
    const out = mergeItemsFromCloud(local, cloud);
    assert.notEqual(out, local);
    assert.equal(out[1].description, "changed");
  });

  it("still allocates for a nested value that differs only inside an array", () => {
    // The depth `===` cannot see and the reason the comparison is structural:
    // `photos` and `tags` arrive as new arrays on every fetch, so an identity
    // test would call every row changed and a one-level test would miss this.
    const local = [makeItem({ id: "i-1", tags: [{ label: "rare", color: "#d89c5b" }] })];
    const cloud = [makeItem({ id: "i-1", tags: [{ label: "rare", color: "#000000" }] })];
    assert.notEqual(mergeItemsFromCloud(local, cloud), local);
  });

  it("still allocates when the cloud brings an id the local list does not have", () => {
    const local = [makeItem({ id: "i-1" })];
    const out = mergeItemsFromCloud(local, [makeItem({ id: "i-2" })]);
    assert.notEqual(out, local);
    assert.equal(out.length, 2);
  });

  it("keeps the local reference when the cloud row only re-states the owner role", () => {
    // The promotion path: a cloud read hardcodes `viewer`, the merge promotes it
    // back to `owner` for the signed-in owner, and the result equals what was
    // already held. That is the COMMON delta row for one's own collection, so
    // treating it as a change would have made the contract useless in practice.
    const local = [makeCollection({ id: "c-1", role: "owner" })];
    const cloud = [makeCollection({ id: "c-1", role: "viewer" })];
    assert.equal(mergeCollectionsFromCloud(local, cloud, ownerId), local);
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

  /**
   * The body of `syncFromCloud`, delimited rather than measured.
   *
   * This was `src.slice(syncIdx, syncIdx + 2800)` in four cases, and 2800 is a
   * length somebody counted once: the moment the function grew — the overlap
   * cursor, then the tombstone gate that holds it — the window stopped
   * reaching the items half, and four cases went red about the wrong thing.
   * The end of the function is a thing the source states (`void
   * syncFromCloud()` is the call that follows the declaration), so read that.
   */
  function syncFromCloudBody(): string {
    const start = src.indexOf("async function syncFromCloud");
    assert.ok(start >= 0, "syncFromCloud is no longer declared as a named async function");
    const end = src.indexOf("void syncFromCloud();", start);
    assert.ok(end > start, "the call that ends the declaration is gone — the slice has no delimiter");
    return src.slice(start, end);
  }

  it("declares a cloud-sync useEffect that depends on [user, ready, refreshTick]", () => {
    // The deps array of the new effect must contain all three so refresh() reaches it.
    assert.match(
      src,
      /\}, \[user, ready, refreshTick\]\)/,
      "cloud-sync effect must depend on [user, ready, refreshTick] so refresh() retriggers it",
    );
  });

  it("delta-pulls own collections AND items in the cloud-sync effect (BE-14)", () => {
    // The warm refresh path no longer refetches whole tables — it asks for the
    // user's own rows changed since a per-entity cursor. The cold-bootstrap
    // path still keeps the full `fetchCollectionsByUserId` pull.
    const block = syncFromCloudBody();
    assert.match(
      block,
      /fetchOwnCollectionsSince\(activeUser\.id, colCursor\)/,
      "cloud-sync effect must delta-pull collections via fetchOwnCollectionsSince",
    );
    assert.match(
      block,
      /fetchOwnItemsSince\(activeUser\.id, itemCursor\)/,
      "cloud-sync effect must delta-pull items via fetchOwnItemsSince",
    );
    // The cold-bootstrap full pull is still wired.
    assert.ok(
      (src.match(/fetchCollectionsByUserId\(/g) ?? []).length >= 1,
      "fetchCollectionsByUserId must remain in the cold-bootstrap path",
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
    const block = syncFromCloudBody();
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

  it("re-applies local state when the delta returned rows OR a tombstone changed + persists the advanced cursor", () => {
    const block = syncFromCloudBody();
    // A delta row is, by definition, newer than the cursor, so the merge fires
    // on a non-empty delta (no `hasNewCloudEntries` id check). BE-15b also
    // re-applies when the accumulated tombstone set grew, so a soft-deleted row
    // is dropped from the cache even on a delta that carried only the tombstone.
    assert.match(
      block,
      /if\s*\(\s*deltaCollections\.length\s*>\s*0\s*\|\|\s*colTombstones\s*!==\s*prevColTombstones\s*\)/,
      "cloud-sync effect must re-apply collections on a non-empty delta or a new tombstone",
    );
    assert.match(
      block,
      /if\s*\(\s*deltaItems\.length\s*>\s*0\s*\|\|\s*itemTombstones\s*!==\s*prevItemTombstones\s*\)/,
      "cloud-sync effect must re-apply items on a non-empty delta or a new tombstone",
    );
    assert.match(
      block,
      /setSyncCursor\(\s*"collections",\s*activeUser\.id,\s*overlapCursor\(nextColCursor, colCursor\),/,
      "cloud-sync effect must persist the advanced collections cursor, through the overlap margin",
    );
  });

  it("partitions tombstones out of each delta and persists the accumulated set (BE-15b)", () => {
    const block = syncFromCloudBody();
    // The delta pull now surfaces tombstoned ids alongside the alive rows.
    assert.match(
      block,
      /tombstonedIds:\s*colTombstoned/,
      "cloud-sync effect must read the collections delta's tombstoned ids",
    );
    assert.match(
      block,
      /tombstonedIds:\s*itemTombstoned/,
      "cloud-sync effect must read the items delta's tombstoned ids",
    );
    // The accumulated set is merged and dropped from the merged cache.
    assert.match(block, /mergeTombstoneIds\(prevColTombstones, colTombstoned\)/);
    assert.match(block, /mergeTombstoneIds\(prevItemTombstones, itemTombstoned\)/);
    assert.match(block, /applyTombstones\(\s*\n?\s*mergeCollectionsFromCloud/);
    // Item delta is deduped (lib/dedupe-items.ts) before tombstones are applied
    // so a legacy-id re-upsert double pulled from cloud can't survive the merge.
    assert.match(block, /dedupeItems\(mergeItemsFromCloud\(current, deltaItems\)\)/);
    // The merged set is persisted for re-application on the next hydrate.
    assert.match(block, /setTombstones\("collections", activeUser\.id, colTombstones, prevColTombstones\)/);
    assert.match(block, /setTombstones\("items", activeUser\.id, itemTombstones, prevItemTombstones\)/);
  });

  it("holds the cursor until the tombstone is safely stored (BE-15b)", () => {
    const block = syncFromCloudBody();
    // A soft-delete arrives as ONE update and nothing re-sends it. Advancing
    // `updated_at=gt` past a tombstone that never reached the store loses the
    // delete permanently: the row is still in the local cache and comes back on
    // the next hydrate, with no tombstone, no new id and no second write to
    // bring it back. So the cursor waits for `setTombstones` to say true.
    for (const entity of ["col", "item"] as const) {
      assert.match(
        block,
        new RegExp(
          `const ${entity}TombstonesSafe =\\s*\\n\\s*stored${entity === "col" ? "Col" : "Item"}Tombstones !== null &&`,
        ),
        `${entity} cursor must be gated on both halves: a store that could not be READ must not be written over, and a write that failed must not be treated as stored`,
      );
      assert.match(
        block,
        new RegExp(`if \\(${entity}TombstonesSafe\\) \\{\\s*\\n\\s*await setSyncCursor\\(`),
        `${entity} cursor must only advance inside the tombstone gate`,
      );
    }
  });

  it("treats an unreadable tombstone store as unreadable, not as empty", () => {
    const block = syncFromCloudBody();
    // `getTombstones` answers null for a store it could not read. Merging into
    // `[]` and writing the union back would replace every tombstone this device
    // holds with the ones this one pull saw — so the null is kept in its own
    // binding and the write is what consults it.
    assert.match(block, /const storedColTombstones = await getTombstones\("collections", activeUser\.id\)/);
    assert.match(block, /const prevColTombstones = storedColTombstones \?\? \[\]/);
    assert.match(block, /const storedItemTombstones = await getTombstones\("items", activeUser\.id\)/);
    assert.match(block, /const prevItemTombstones = storedItemTombstones \?\? \[\]/);
  });

  it("recordTombstones skips its write when the stored set could not be read", () => {
    // The local-delete path has the same read-merge-write shape and the same
    // hazard: a null read folded into `[]` replaces the whole persisted set
    // with the single id just deleted.
    assert.match(
      src,
      /void getTombstones\(entity, activeUser\.id\)\.then\(\(prev\) => \{[\s\S]{0,600}?if \(prev === null\) return;/,
      "recordTombstones must not write a merged set over a store it could not read",
    );
  });

  it("soft-deletes owned collections/items and records local tombstones (BE-15b)", () => {
    // Owned deletes must PATCH `deleted_at` (so a delta pull can observe the
    // tombstone) and record it locally so a cache/seed row can't resurrect it.
    assert.match(src, /softDeleteRemoteItem\(itemId\)\.catch/);
    assert.match(src, /softDeleteRemoteCollection\(collectionId\)\.catch/);
    assert.match(src, /recordTombstones\("items", \[itemId\]\)/);
    assert.match(src, /recordTombstones\("collections", \[collectionId\]\)/);
    // Hydrate re-applies the persisted set so deleted rows stay gone.
    assert.match(src, /applyTombstones\(visibleCollections, colTombstones/);
    assert.match(src, /applyTombstones\(dedupeItems\(normalizedItems\), itemTombstones/);
  });
});
