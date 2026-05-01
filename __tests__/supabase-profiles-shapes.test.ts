import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  collectionByIdUrl,
  collectionsUrl,
  collectionsByUserUrl,
  friendRequestsInsertUrl,
  friendRequestsUrl,
  profileByIdUrl,
  profilesPageRangeHeader,
  profilesPageUrl,
  profilesUrl,
  publicCollectionsByUserUrl,
  removeFriendRequestUrl,
  sendFriendRequestBody,
  upsertCollectionBody,
  upsertProfileBody,
} from "@/lib/supabase-profiles-shapes";
import { Collection, UserProfile } from "@/lib/types";

const BASE = "https://demo.supabase.co";

// --- profilesUrl ---
describe("profilesUrl", () => {
  it("targets /rest/v1/profiles", () => {
    assert.equal(profilesUrl(BASE), `${BASE}/rest/v1/profiles`);
  });
});

// --- profileByIdUrl ---
describe("profileByIdUrl", () => {
  it("filters by id and selects all", () => {
    assert.equal(
      profileByIdUrl(BASE, "user-1"),
      `${BASE}/rest/v1/profiles?id=eq.user-1&select=*`,
    );
  });

  it("URI-encodes the id", () => {
    const url = profileByIdUrl(BASE, "user&evil=1");
    assert.ok(url.includes("id=eq.user%26evil%3D1"));
    assert.ok(!url.includes("&evil=1"));
  });
});

// --- profilesPageUrl ---
describe("profilesPageUrl", () => {
  it("builds the correct URL for page 1", () => {
    const url = profilesPageUrl(BASE, 1, 20);
    assert.ok(url.includes("offset=0"));
    assert.ok(url.includes("limit=20"));
    assert.ok(url.includes("order=created_at.desc"));
  });

  it("calculates offset correctly for page 2", () => {
    const url = profilesPageUrl(BASE, 2, 20);
    assert.ok(url.includes("offset=20"));
    assert.ok(url.includes("limit=20"));
  });
});

// --- profilesPageRangeHeader ---
describe("profilesPageRangeHeader", () => {
  it("returns 0-19 for page 1, size 20", () => {
    assert.equal(profilesPageRangeHeader(1, 20), "0-19");
  });

  it("returns 20-39 for page 2, size 20", () => {
    assert.equal(profilesPageRangeHeader(2, 20), "20-39");
  });
});

// --- upsertProfileBody ---
describe("upsertProfileBody", () => {
  it("snake-cases all fields", () => {
    const profile: UserProfile = {
      id: "u1",
      email: "a@b.com",
      displayName: "Alice",
      username: "alice",
      publicId: "alice-slug",
      bio: "collector",
      avatar: "https://img.example.com/a.jpg",
    };
    const body = upsertProfileBody(profile);
    assert.equal(body.id, "u1");
    assert.equal(body.email, "a@b.com");
    assert.equal(body.display_name, "Alice");
    assert.equal(body.username, "alice");
    assert.equal(body.public_id, "alice-slug");
    assert.equal(body.bio, "collector");
    assert.equal(body.avatar, "https://img.example.com/a.jpg");
  });
});

// --- collectionsUrl ---
describe("collectionsUrl", () => {
  it("targets /rest/v1/collections", () => {
    assert.equal(collectionsUrl(BASE), `${BASE}/rest/v1/collections`);
  });
});

// --- collectionByIdUrl ---
describe("collectionByIdUrl", () => {
  it("filters by id", () => {
    const url = collectionByIdUrl(BASE, "col-1");
    assert.ok(url.includes("id=eq.col-1"));
    assert.ok(url.includes("select=*"));
  });

  it("URI-encodes the collection id", () => {
    const url = collectionByIdUrl(BASE, "col&evil=1");
    assert.ok(url.includes("col%26evil%3D1"));
  });
});

// --- collectionsByUserUrl ---
describe("collectionsByUserUrl", () => {
  it("filters by owner_user_id and excludes wishlist", () => {
    const url = collectionsByUserUrl(BASE, "user-1");
    assert.ok(url.includes("owner_user_id=eq.user-1"));
    assert.ok(url.includes("name=neq.__wishlist__"));
    assert.ok(url.includes("order=created_at.desc"));
  });
});

// --- publicCollectionsByUserUrl ---
describe("publicCollectionsByUserUrl", () => {
  it("filters for public visibility", () => {
    const url = publicCollectionsByUserUrl(BASE, "user-1");
    assert.ok(url.includes("owner_user_id=eq.user-1"));
    assert.ok(url.includes("visibility=eq.public"));
    assert.ok(url.includes("name=neq.__wishlist__"));
  });
});

// --- upsertCollectionBody ---
describe("upsertCollectionBody", () => {
  it("snake-cases all required fields", () => {
    const col: Collection = {
      id: "c1",
      name: "Stamps",
      coverPhoto: "https://img.example.com/cover.jpg",
      description: "My stamps",
      ownerName: "Alice",
      ownerUserId: "u1",
      sharedWith: [],
      sharedWithUserIds: [],
      role: "owner",
      sortOrder: 3,
      visibility: "public",
    };
    const body = upsertCollectionBody(col);
    assert.equal(body.id, "c1");
    assert.equal(body.name, "Stamps");
    assert.equal(body.cover_photo, "https://img.example.com/cover.jpg");
    assert.equal(body.owner_name, "Alice");
    assert.equal(body.owner_user_id, "u1");
    assert.equal(body.sort_order, 3);
    assert.equal(body.visibility, "public");
    assert.deepEqual(body.shared_with_user_ids, []);
  });

  it("falls back to 'private' visibility when visibility is null-ish", () => {
    const col = {
      id: "c2",
      name: "Test",
      coverPhoto: "",
      description: "",
      ownerName: "Bob",
      ownerUserId: "u2",
      sharedWith: [],
      sharedWithUserIds: [],
      role: "owner",
      visibility: null,
    } as unknown as Collection;
    const body = upsertCollectionBody(col);
    assert.equal(body.visibility, "private");
  });
});

// --- friendRequestsUrl ---
describe("friendRequestsUrl", () => {
  it("builds an OR filter for from_user_id and to_user_id", () => {
    const url = friendRequestsUrl(BASE, "user-1");
    assert.ok(url.includes("from_user_id.eq.user-1"));
    assert.ok(url.includes("to_user_id.eq.user-1"));
    assert.ok(url.includes("select=from_user_id,to_user_id"));
  });
});

// --- friendRequestsInsertUrl ---
describe("friendRequestsInsertUrl", () => {
  it("targets /rest/v1/friend_requests", () => {
    assert.equal(
      friendRequestsInsertUrl(BASE),
      `${BASE}/rest/v1/friend_requests`,
    );
  });
});

// --- sendFriendRequestBody ---
describe("sendFriendRequestBody", () => {
  it("snake-cases from/to user ids", () => {
    const body = sendFriendRequestBody("alice", "bob");
    assert.equal(body.from_user_id, "alice");
    assert.equal(body.to_user_id, "bob");
  });
});

// --- removeFriendRequestUrl ---
describe("removeFriendRequestUrl", () => {
  it("builds a bidirectional OR filter", () => {
    const url = removeFriendRequestUrl(BASE, "alice", "bob");
    assert.ok(url.includes("from_user_id.eq.alice"));
    assert.ok(url.includes("to_user_id.eq.bob"));
    assert.ok(url.includes("from_user_id.eq.bob"));
    assert.ok(url.includes("to_user_id.eq.alice"));
  });

  it("URI-encodes special characters in user ids", () => {
    const url = removeFriendRequestUrl(BASE, "a&b", "c=d");
    assert.ok(!url.includes("a&b"));
    assert.ok(!url.includes("c=d"));
    assert.ok(url.includes("a%26b"));
    assert.ok(url.includes("c%3Dd"));
  });
});

// --- Wiring: supabase-profiles.ts uses the shape helpers ---
describe("supabase-profiles.ts wiring", () => {
  const SOURCE = readFileSync(
    path.join(process.cwd(), "lib", "supabase-profiles.ts"),
    "utf8",
  );

  it("imports the shape helpers from supabase-profiles-shapes", () => {
    assert.match(SOURCE, /from "@\/lib\/supabase-profiles-shapes"/);
  });

  const helpers = [
    "profilesUrl",
    "profileByIdUrl",
    "profilesPageUrl",
    "profilesPageRangeHeader",
    "upsertProfileBody",
    "collectionsUrl",
    "collectionByIdUrl",
    "collectionsByUserUrl",
    "publicCollectionsByUserUrl",
    "upsertCollectionBody",
    "friendRequestsUrl",
    "friendRequestsInsertUrl",
    "sendFriendRequestBody",
    "removeFriendRequestUrl",
  ];

  for (const helper of helpers) {
    it(`uses the ${helper} shape helper`, () => {
      assert.match(
        SOURCE,
        new RegExp(`\\b${helper}\\b`),
        `expected supabase-profiles.ts to use ${helper}`,
      );
    });
  }
});
