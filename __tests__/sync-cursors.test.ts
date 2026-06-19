import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { maxUpdatedAt } from "@/lib/sync-cursors";

// --- maxUpdatedAt (pure delta-cursor reducer) ---
describe("maxUpdatedAt", () => {
  it("returns the current cursor unchanged when no rows are given", () => {
    assert.equal(maxUpdatedAt("2026-06-19T00:00:00Z", []), "2026-06-19T00:00:00Z");
    assert.equal(maxUpdatedAt(null, []), null);
  });

  it("picks the newest updated_at across rows when starting from null", () => {
    assert.equal(
      maxUpdatedAt(null, [
        { updated_at: "2026-06-18T10:00:00Z" },
        { updated_at: "2026-06-19T10:00:00Z" },
        { updated_at: "2026-06-17T10:00:00Z" },
      ]),
      "2026-06-19T10:00:00Z",
    );
  });

  it("never goes backwards from the current cursor", () => {
    assert.equal(
      maxUpdatedAt("2026-06-20T00:00:00Z", [
        { updated_at: "2026-06-19T10:00:00Z" },
        { updated_at: "2026-06-18T10:00:00Z" },
      ]),
      "2026-06-20T00:00:00Z",
    );
  });

  it("advances past the current cursor when a row is newer", () => {
    assert.equal(
      maxUpdatedAt("2026-06-19T00:00:00Z", [{ updated_at: "2026-06-19T12:00:00Z" }]),
      "2026-06-19T12:00:00Z",
    );
  });

  it("compares numerically, not lexicographically, across offset formats", () => {
    // "2026-06-19T12:00:00+00:00" sorts before the "+02:00" string
    // lexicographically but is the LATER instant (10:00Z vs 13:00Z) — wait,
    // here the +00:00 row is the later instant, so it must win.
    const result = maxUpdatedAt(null, [
      { updated_at: "2026-06-19T13:00:00+02:00" }, // 11:00Z
      { updated_at: "2026-06-19T12:00:00+00:00" }, // 12:00Z — later instant
    ]);
    assert.equal(result, "2026-06-19T12:00:00+00:00");
  });

  it("skips missing / null / unparseable values", () => {
    assert.equal(
      maxUpdatedAt(null, [
        { updated_at: null },
        { updated_at: undefined },
        { updated_at: "not-a-date" },
        { updated_at: "2026-06-19T10:00:00Z" },
      ]),
      "2026-06-19T10:00:00Z",
    );
    assert.equal(maxUpdatedAt(null, [{ updated_at: "garbage" }]), null);
  });
});

// --- structural: storage key + wiring (file-scan, no AsyncStorage needed) ---
const repoRoot = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(repoRoot, p), "utf8");

describe("sync-cursors storage + context wiring", () => {
  it("keys cursors per entity + user under collectables-sync-cursor-v1", () => {
    const keys = read("lib/storage-keys.ts");
    assert.match(keys, /collectables-sync-cursor-v1-\$\{entity\}-\$\{userId\}/);
    assert.match(keys, /syncCursorKey/);
  });

  it("clears both cursor keys on per-user data reset", () => {
    const keys = read("lib/storage-keys.ts");
    assert.match(keys, /syncCursorKey\("collections", userId\)/);
    assert.match(keys, /syncCursorKey\("items", userId\)/);
  });

  it("the warm refresh path delta-pulls collections + items via cursors", () => {
    const ctx = read("lib/collections-context.tsx");
    assert.match(ctx, /getSyncCursor\("collections", activeUser\.id\)/);
    assert.match(ctx, /fetchOwnCollectionsSince\(activeUser\.id, colCursor\)/);
    assert.match(ctx, /fetchOwnItemsSince\(activeUser\.id, itemCursor\)/);
    assert.match(ctx, /setSyncCursor\("items", activeUser\.id, nextItemCursor, itemCursor\)/);
  });
});
