import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  seedProfiles,
  seedSocialCollections,
  seedSocialItems,
} from "@/data/social-seed";

describe("social-seed", () => {
  it("profiles have unique ids", () => {
    const ids = seedProfiles.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("profiles have unique usernames", () => {
    const names = seedProfiles.map((p) => p.username.toLowerCase());
    assert.equal(new Set(names).size, names.length);
  });

  it("profiles have unique publicIds", () => {
    const slugs = seedProfiles.map((p) => p.publicId);
    assert.equal(new Set(slugs).size, slugs.length);
  });

  it("every profile has the expected fields", () => {
    for (const p of seedProfiles) {
      assert.ok(p.id);
      assert.ok(p.email.includes("@"), `invalid email: ${p.email}`);
      assert.ok(p.displayName);
      assert.ok(p.username);
      assert.ok(p.publicId);
      assert.ok(typeof p.bio === "string");
      assert.ok(p.avatar.startsWith("http"));
    }
  });

  it("social collections have unique ids and owner matches a seed profile", () => {
    const ids = seedSocialCollections.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);

    const profileIds = new Set(seedProfiles.map((p) => p.id));
    for (const c of seedSocialCollections) {
      assert.ok(
        profileIds.has(c.ownerUserId),
        `collection ${c.id} owned by unknown user ${c.ownerUserId}`,
      );
      assert.equal(c.role, "viewer");
    }
  });

  it("every social item belongs to an existing social collection", () => {
    const collectionIds = new Set(seedSocialCollections.map((c) => c.id));
    for (const item of seedSocialItems) {
      assert.ok(
        collectionIds.has(item.collectionId),
        `item ${item.id} references unknown collection ${item.collectionId}`,
      );
    }
  });

  it("every social item has non-empty photos", () => {
    for (const item of seedSocialItems) {
      assert.ok(item.photos.length > 0, `item ${item.id} has no photos`);
      for (const url of item.photos) {
        assert.ok(url.startsWith("http"), `invalid photo url: ${url}`);
      }
    }
  });

  it("every social item createdAt is a valid ISO date", () => {
    for (const item of seedSocialItems) {
      const parsed = Date.parse(item.createdAt);
      assert.ok(!Number.isNaN(parsed), `invalid createdAt: ${item.createdAt}`);
    }
  });
});
