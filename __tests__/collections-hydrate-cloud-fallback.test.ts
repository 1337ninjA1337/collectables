import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { Collection } from "../lib/types";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * Pure helper extracted from the structural fix to lib/collections-context.tsx
 * hydrate(): when a Supabase row's ownerUserId matches the signed-in user,
 * promote the role from "viewer" (the default toCollection() produces) to
 * "owner" so the home page's `collection.role === "owner"` filter sees it.
 *
 * The implementation in lib/collections-context.tsx must stay in lockstep
 * with this helper — the structural test below asserts the exact predicate.
 */
function promoteOwnedRole(
  remote: Collection[],
  activeUserId: string,
): Collection[] {
  return remote.map((collection) =>
    collection.ownerUserId === activeUserId
      ? { ...collection, role: "owner" as const }
      : collection,
  );
}

const baseCollection: Omit<Collection, "ownerUserId" | "role"> = {
  id: "c1",
  name: "Stamps",
  description: "",
  coverPhoto: "https://example.com/x.jpg",
  ownerName: "Alice",
  sharedWith: [],
  sharedWithUserIds: [],
  visibility: "private",
};

describe("collections hydrate — owned-role promotion", () => {
  it("promotes role to 'owner' when ownerUserId matches the signed-in user", () => {
    const remote: Collection[] = [
      { ...baseCollection, id: "c1", ownerUserId: "user-1", role: "viewer" },
    ];
    const out = promoteOwnedRole(remote, "user-1");
    assert.equal(out[0].role, "owner");
  });

  it("leaves role untouched when ownerUserId does not match (shared or public collection)", () => {
    const remote: Collection[] = [
      { ...baseCollection, id: "c1", ownerUserId: "user-2", role: "viewer" },
    ];
    const out = promoteOwnedRole(remote, "user-1");
    assert.equal(out[0].role, "viewer");
  });

  it("handles a mix of owned + shared collections in the same payload", () => {
    const remote: Collection[] = [
      { ...baseCollection, id: "owned-1", ownerUserId: "user-1", role: "viewer" },
      { ...baseCollection, id: "shared-1", ownerUserId: "user-2", role: "viewer" },
      { ...baseCollection, id: "owned-2", ownerUserId: "user-1", role: "viewer" },
    ];
    const out = promoteOwnedRole(remote, "user-1");
    const ownedIds = out.filter((c) => c.role === "owner").map((c) => c.id).sort();
    const viewerIds = out.filter((c) => c.role === "viewer").map((c) => c.id).sort();
    assert.deepStrictEqual(ownedIds, ["owned-1", "owned-2"]);
    assert.deepStrictEqual(viewerIds, ["shared-1"]);
  });

  it("returns immutable mapped output (does not mutate input)", () => {
    const remote: Collection[] = [
      { ...baseCollection, id: "c1", ownerUserId: "user-1", role: "viewer" },
    ];
    const before = JSON.stringify(remote);
    promoteOwnedRole(remote, "user-1");
    assert.equal(JSON.stringify(remote), before);
  });
});

describe("collections-context.tsx — structural wiring", () => {
  it("imports fetchCollectionsByUserId so hydrate can fall back to cloud", () => {
    const src = read("lib/collections-context.tsx");
    assert.match(
      src,
      /fetchCollectionsByUserId\b[^}]*from\s+["']@\/lib\/supabase-profiles["']|fetchCollectionsByUserId,?\s*\n[\s\S]*?from\s+["']@\/lib\/supabase-profiles["']/,
      "lib/collections-context.tsx must import fetchCollectionsByUserId from supabase-profiles to hydrate cloud-stored owned collections",
    );
  });

  it("falls back to remote fetch when local visibleCollections is empty", () => {
    const src = read("lib/collections-context.tsx");
    // The fix lives inside hydrate(): when local is empty, call
    // fetchCollectionsByUserId(activeUser.id) and reassign role.
    assert.match(
      src,
      /visibleCollections\.length === 0[\s\S]*?fetchCollectionsByUserId\(\s*activeUser\.id\s*\)/,
      "hydrate() must call fetchCollectionsByUserId when visibleCollections is empty, otherwise fresh sign-in users see no collections on the home page",
    );
  });

  it("promotes role to 'owner' on rows where ownerUserId matches the signed-in user", () => {
    const src = read("lib/collections-context.tsx");
    // toCollection() hardcodes role: "viewer"; hydrate() must override it for
    // owned rows so the home page's `role === "owner"` filter matches them.
    assert.match(
      src,
      /collection\.ownerUserId === activeUser\.id[\s\S]{0,200}role:\s*["']owner["']/,
      "hydrate() must override role to 'owner' for cloud rows whose ownerUserId matches the signed-in user — otherwise home-page filter excludes them",
    );
  });

  it("falls back to remote item fetch when items are empty after collections load", () => {
    const src = read("lib/collections-context.tsx");
    assert.match(
      src,
      /visibleItems\.length === 0[\s\S]*?fetchItemsByCollectionId\(/,
      "hydrate() must pull each collection's items when local items cache is empty so per-collection counts on the home page aren't 0",
    );
  });
});
