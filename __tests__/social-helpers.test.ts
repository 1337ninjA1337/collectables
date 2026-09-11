import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  diffAcceptedFriendships,
  isFriendRelationship,
  isSelfPair,
  relationshipForAnalytics,
} from "../lib/social-helpers";
import { ANALYTICS_EVENTS } from "../lib/analytics-events";
import { isPiiPropKey } from "../lib/analytics-pii";
import type { ProfileRelationship } from "../lib/types";
import { readRepoFile as read } from "./helpers/repo-file";

const ALL_RELATIONSHIPS: readonly ProfileRelationship[] = [
  "self",
  "friend",
  "following",
  "request_sent",
  "request_received",
  "none",
];

describe("relationshipForAnalytics — canonical 3-way bucket", () => {
  it("buckets every ProfileRelationship (total function, no fall-through surprises)", () => {
    const expected: Record<ProfileRelationship, string> = {
      friend: "friend",
      following: "following",
      self: "stranger",
      request_sent: "stranger",
      request_received: "stranger",
      none: "stranger",
    };
    for (const rel of ALL_RELATIONSHIPS) {
      assert.equal(
        relationshipForAnalytics(rel),
        expected[rel],
        `relationshipForAnalytics("${rel}")`,
      );
    }
  });

  it("pending requests are strangers — the handshake hasn't completed", () => {
    assert.equal(relationshipForAnalytics("request_sent"), "stranger");
    assert.equal(relationshipForAnalytics("request_received"), "stranger");
  });

  it("isFriendRelationship is the boolean arm of the same bucket", () => {
    for (const rel of ALL_RELATIONSHIPS) {
      assert.equal(
        isFriendRelationship(rel),
        relationshipForAnalytics(rel) === "friend",
        `isFriendRelationship("${rel}") must agree with the bucket`,
      );
    }
  });
});

describe("relationshipForAnalytics — taxonomy + PII fit", () => {
  it("listing_claimed registers the sellerRelationship prop", () => {
    assert.ok(
      ANALYTICS_EVENTS.listing_claimed.props.includes("sellerRelationship"),
      "sellerRelationship must be a registered listing_claimed prop",
    );
  });

  it("sellerRelationship passes the PII key rule", () => {
    assert.equal(isPiiPropKey("sellerRelationship"), false);
  });
});

describe("relationshipForAnalytics — adoption (one bucket, no re-rolls)", () => {
  it("chat_opened.withFriend delegates to isFriendRelationship", () => {
    const src = read("app/chat/[id].tsx");
    assert.match(
      src,
      /withFriend:\s*isFriendRelationship\(\s*getRelationship\([^)]+\)\s*\)/,
    );
    assert.doesNotMatch(
      src,
      /getRelationship\([^)]+\)\s*===\s*["']friend["']/,
      "the inline === 'friend' re-roll must be gone from chat/[id].tsx",
    );
  });

  it("listing_claimed derives both props from one relationshipForAnalytics call", () => {
    const src = read("app/listing/[id].tsx");
    assert.match(
      src,
      /const\s+sellerRelationship\s*=\s*relationshipForAnalytics\(/,
    );
    assert.match(src, /sellerWasFriend:\s*sellerRelationship\s*===\s*["']friend["']/);
    assert.doesNotMatch(
      src,
      /getRelationship\([^)]+\)\s*===\s*["']friend["']/,
      "the inline === 'friend' re-roll must be gone from listing/[id].tsx",
    );
  });
});

describe("isSelfPair — the rule that was written three times before it was named", () => {
  it("is true for a pair naming one person on both sides", () => {
    assert.equal(isSelfPair({ fromUserId: "u1", toUserId: "u1" }), true);
  });

  it("is false for a real direction, either way round", () => {
    assert.equal(isSelfPair({ fromUserId: "u1", toUserId: "u2" }), false);
    assert.equal(isSelfPair({ fromUserId: "u2", toUserId: "u1" }), false);
  });

  it("compares the ids and nothing else", () => {
    // Not `!fromUserId` and not a case-insensitive match: two ids that differ
    // only in case are two rows the DB considers different people.
    assert.equal(isSelfPair({ fromUserId: "U1", toUserId: "u1" }), false);
  });

  it("is what the accepted-friendship diff skips", () => {
    // `collectHandshakes` carried the rule as a `&&` on each arm before it had
    // a name. A self-pair must not register a direction, so a list holding one
    // and nothing else is no transition at all.
    assert.deepEqual(
      diffAcceptedFriendships([], [{ fromUserId: "u1", toUserId: "u1" }], "u1"),
      [],
    );
  });
});

describe("the request-list door drops a self-pair before it is state", () => {
  const SRC = read("lib/social-context.tsx");

  it("maps the cloud's rows in one place", () => {
    // The hydrate and the realtime refetch each had their own copy of the
    // same `map`, which is how the two entry points came to enforce different
    // rules about what a row may say.
    assert.equal((SRC.match(/setFriendRequests\(toFriendRequests\(remoteRequests\)\)/g) ?? []).length, 2);
    assert.doesNotMatch(SRC, /setFriendRequests\(\s*remoteRequests\.map/);
  });

  it("filters there rather than in the derivation that reads it", () => {
    assert.match(SRC, /\.filter\(\(request\) => !isSelfPair\(request\)\)/);
    // The memo used to allocate a filtered copy of the list on every change,
    // for a rule now enforced upstream of its input.
    assert.doesNotMatch(SRC, /friendRequests\.filter\(\(request\) => request\.fromUserId !== request\.toUserId\)/);
  });
});
