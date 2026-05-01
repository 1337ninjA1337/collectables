import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  LANGUAGE_KEY,
  MARKETPLACE_KEY,
  SOCIAL_GRAPH_KEY,
  chatCacheKey,
  collectionsKey,
  followedCollectionsKey,
  itemsKey,
  premiumKey,
  socialCacheKey,
} from "../lib/storage-keys";

const UID = "user-abc";

describe("storage-keys", () => {
  it("static keys have expected values", () => {
    assert.equal(LANGUAGE_KEY, "collectables-language-v1");
    assert.equal(MARKETPLACE_KEY, "collectables-marketplace-v1");
    assert.equal(SOCIAL_GRAPH_KEY, "collectables-social-graph-v1");
  });

  it("per-user key builders include userId suffix", () => {
    assert.equal(chatCacheKey(UID), `collectables-chats-v1-${UID}`);
    assert.equal(socialCacheKey(UID), `collectables-social-v1-${UID}`);
    assert.equal(premiumKey(UID), `collectables-premium-v1-${UID}`);
    assert.equal(collectionsKey(UID), `collectables-collections-v1-${UID}`);
    assert.equal(itemsKey(UID), `collectables-items-v1-${UID}`);
    assert.equal(followedCollectionsKey(UID), `collectables-followed-collections-v1-${UID}`);
  });

  it("per-user key builders produce unique keys per user", () => {
    const uid2 = "user-xyz";
    assert.notEqual(chatCacheKey(UID), chatCacheKey(uid2));
    assert.notEqual(premiumKey(UID), premiumKey(uid2));
  });

  it("premiumKey matches premiumStorageKey template", () => {
    assert.equal(premiumKey(UID), `collectables-premium-v1-${UID}`);
  });
});
