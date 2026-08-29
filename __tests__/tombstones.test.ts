import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  partitionByTombstone,
  applyTombstones,
  mergeTombstoneIds,
} from "@/lib/tombstones";

import { readRepoFile } from "./helpers/repo-file";

// --- partitionByTombstone (pure split alive vs tombstoned) ---
describe("partitionByTombstone", () => {
  const opts = {
    getId: (r: { id: string; deleted_at?: unknown }) => r.id,
    getDeletedAt: (r: { id: string; deleted_at?: unknown }) => r.deleted_at,
  };

  it("treats null/undefined/empty deleted_at as alive, preserving order", () => {
    const { alive, tombstonedIds } = partitionByTombstone(
      [
        { id: "a", deleted_at: null },
        { id: "b" },
        { id: "c", deleted_at: "" },
      ],
      opts,
    );
    assert.deepEqual(alive.map((r) => r.id), ["a", "b", "c"]);
    assert.deepEqual(tombstonedIds, []);
  });

  it("collects ids of rows with a non-null deleted_at timestamp", () => {
    const { alive, tombstonedIds } = partitionByTombstone(
      [
        { id: "a", deleted_at: null },
        { id: "b", deleted_at: "2026-06-19T10:00:00Z" },
        { id: "c", deleted_at: "2026-06-19T11:00:00Z" },
      ],
      opts,
    );
    assert.deepEqual(alive.map((r) => r.id), ["a"]);
    assert.deepEqual(tombstonedIds, ["b", "c"]);
  });

  it("accepts a boolean tombstone marker (false = alive, true = dead)", () => {
    const { alive, tombstonedIds } = partitionByTombstone(
      [
        { id: "a", deleted_at: false },
        { id: "b", deleted_at: true },
      ],
      opts,
    );
    assert.deepEqual(alive.map((r) => r.id), ["a"]);
    assert.deepEqual(tombstonedIds, ["b"]);
  });

  it("returns empty partitions for an empty batch", () => {
    const { alive, tombstonedIds } = partitionByTombstone([], opts);
    assert.deepEqual(alive, []);
    assert.deepEqual(tombstonedIds, []);
  });
});

// --- applyTombstones (drop tombstoned entries from a local cache) ---
describe("applyTombstones", () => {
  const getId = (x: { id: string }) => x.id;

  it("removes entries whose id is tombstoned", () => {
    const result = applyTombstones(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      ["b"],
      getId,
    );
    assert.deepEqual(result.map((x) => x.id), ["a", "c"]);
  });

  it("returns the same reference when nothing is tombstoned", () => {
    const items = [{ id: "a" }, { id: "b" }];
    assert.equal(applyTombstones(items, [], getId), items);
  });

  it("returns the same reference when no tombstone id matches the cache", () => {
    const items = [{ id: "a" }, { id: "b" }];
    assert.equal(applyTombstones(items, ["zzz"], getId), items);
  });

  it("never mutates the input array", () => {
    const items = [{ id: "a" }, { id: "b" }];
    applyTombstones(items, ["a"], getId);
    assert.deepEqual(items.map((x) => x.id), ["a", "b"]);
  });
});

// --- mergeTombstoneIds (accumulate the persisted tombstone set) ---
describe("mergeTombstoneIds", () => {
  it("unions new ids keeping first-seen order, de-duplicating", () => {
    assert.deepEqual(mergeTombstoneIds(["a", "b"], ["b", "c", "a", "d"]), [
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("returns the existing reference when incoming is empty", () => {
    const existing = ["a"];
    assert.equal(mergeTombstoneIds(existing, []), existing);
  });

  it("returns the existing reference when every incoming id is already known", () => {
    const existing = ["a", "b"];
    assert.equal(mergeTombstoneIds(existing, ["a", "b"]), existing);
  });
});

// --- structural: storage key + reset wiring (file-scan, no AsyncStorage) ---
const read = (p: string) => readRepoFile(p);

describe("tombstones storage + key wiring", () => {
  it("keys tombstone sets per entity + user under collectables-tombstones-v1", () => {
    const keys = read("lib/storage-keys.ts");
    assert.match(keys, /collectables-tombstones-v1-\$\{entity\}-\$\{userId\}/);
    assert.match(keys, /tombstoneKey/);
  });

  it("clears both tombstone keys on per-user data reset", () => {
    const keys = read("lib/storage-keys.ts");
    assert.match(keys, /tombstoneKey\("collections", userId\)/);
    assert.match(keys, /tombstoneKey\("items", userId\)/);
  });

  it("the AsyncStorage wrappers no-op a persist when the set is unchanged", () => {
    const mod = read("lib/tombstones.ts");
    // The no-op reports TRUE: nothing to write means the stored set already
    // covers `ids`, which is what the caller's cursor gate is asking about.
    assert.match(mod, /if \(previous !== undefined && ids === previous\) return true;/);
  });

  it("setTombstones reports whether the stored set now covers the ids", () => {
    const mod = read("lib/tombstones.ts");
    assert.match(mod, /\): Promise<boolean> \{/);
    // The failure arm returns false rather than swallowing into `void`. A
    // soft-delete arrives as ONE update and nothing re-sends it, so a caller
    // that advanced its cursor past a tombstone it failed to store would never
    // be told about that delete again.
    assert.match(mod, /\} catch \{\s*\n\s*return false;\s*\n\s*\}/);
  });

  it("getTombstones answers null for an unreadable store, never an empty set", () => {
    const mod = read("lib/tombstones.ts");
    assert.match(mod, /\): Promise<string\[\] \| null> \{/);
    // Every caller merges into what it reads and writes the union back, so `[]`
    // for a failed read narrows the persisted set to whatever one pull saw —
    // and the rows whose tombstones were dropped come back on the next hydrate.
    assert.match(mod, /\} catch \{[\s\S]{0,120}return null;/);
    // Two catches, not one: only the STORE's failure is null. Stored garbage is
    // `[]`, or a corrupt blob would be permanently null and a caller holding
    // its cursor on null would hold it forever.
    assert.match(mod, /\} catch \{[\s\S]{0,140}return \[\];/);
  });
});
