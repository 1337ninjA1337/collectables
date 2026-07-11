import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  isFriendRelationship,
  relationshipForAnalytics,
} from "../lib/social-helpers";
import { ANALYTICS_EVENTS } from "../lib/analytics-events";
import { isPiiPropKey } from "../lib/analytics-pii";
import type { ProfileRelationship } from "../lib/types";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

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
