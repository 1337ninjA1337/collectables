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
  storageKeyLabel,
  syncCursorKey,
  tombstoneKey,
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

/**
 * The keyspace a crash report may name, given a key that carries an account id.
 *
 * `usePersistedBlob` reports a rejected write — usually a full device store,
 * which loses local edits silently — and every per-user builder above ends in
 * the Supabase auth id. `scrubPII` reads event bodies, not the `extra` a caller
 * assembles, so anything this function leaves in the string is an identifier
 * nobody decided to send.
 */
describe("storageKeyLabel", () => {
  // A UUID with no entropy in it. The first draft used a realistic random one
  // and gitleaks' `generic-api-key` rule flagged it as a secret on the commit —
  // a fixture that is indistinguishable from a key IS one, as far as every
  // scanner is concerned, and turning the scan off for a test file is a worse
  // trade than typing a boring uuid.
  const AUTH_ID = "11111111-2222-4333-8444-555555555555";

  it("replaces a uuid user id and keeps everything around it", () => {
    assert.equal(
      storageKeyLabel(collectionsKey(AUTH_ID)),
      "collectables-collections-v1-{id}",
    );
    assert.equal(storageKeyLabel(itemsKey(AUTH_ID)), "collectables-items-v1-{id}");
  });

  it("keeps the ENTITY of a per-entity key — the part that says which pull broke", () => {
    assert.equal(
      storageKeyLabel(syncCursorKey("items", AUTH_ID)),
      "collectables-sync-cursor-v1-items-{id}",
    );
    assert.equal(
      storageKeyLabel(tombstoneKey("collections", AUTH_ID)),
      "collectables-tombstones-v1-collections-{id}",
    );
  });

  it("truncates at the version when the id is not a uuid, rather than passing it through", () => {
    // The case the second pass exists for: a legacy or test id matches no uuid
    // shape, and returning the key unchanged is exactly the leak this prevents.
    assert.equal(storageKeyLabel(collectionsKey(UID)), "collectables-collections-v1-{id}");
    assert.equal(
      storageKeyLabel(syncCursorKey("items", UID)),
      "collectables-sync-cursor-v1-{id}",
      "the entity is lost with a non-uuid id, which is the safe direction",
    );
  });

  it("leaves a key with no per-user half alone", () => {
    assert.equal(storageKeyLabel(LANGUAGE_KEY), LANGUAGE_KEY);
    assert.equal(storageKeyLabel(SOCIAL_GRAPH_KEY), SOCIAL_GRAPH_KEY);
    assert.equal(storageKeyLabel(MARKETPLACE_KEY), MARKETPLACE_KEY);
  });

  it("is case-insensitive about the uuid, as PostgREST is about the id it returns", () => {
    assert.equal(
      storageKeyLabel(collectionsKey(AUTH_ID.toUpperCase())),
      "collectables-collections-v1-{id}",
    );
  });

  it("never leaves an id in a key produced by any per-user builder", () => {
    const builders = [
      collectionsKey,
      itemsKey,
      followedCollectionsKey,
      chatCacheKey,
      socialCacheKey,
      premiumKey,
    ];
    for (const build of builders) {
      for (const id of [AUTH_ID, UID]) {
        assert.doesNotMatch(
          storageKeyLabel(build(id)),
          new RegExp(id, "i"),
          `${build.name} leaked its id into the label`,
        );
      }
    }
  });
});
