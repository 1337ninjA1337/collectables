import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { ANALYTICS_EVENTS } from "../lib/analytics-events";
import { findPiiPropKeys } from "../lib/analytics-pii";
import { classifyRequestRemoval } from "../lib/social-helpers";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("lib/social-helpers.ts — classifyRequestRemoval", () => {
  it("outgoing-only removal is a cancelled request (the churn arm)", () => {
    assert.equal(classifyRequestRemoval(true, false), "cancelled_request");
  });

  it("incoming-only removal is a decline, not a cancel", () => {
    assert.equal(classifyRequestRemoval(false, true), "declined_request");
  });

  it("mutual removal is an unfriend, not a cancel", () => {
    assert.equal(classifyRequestRemoval(true, true), "unfriended");
  });

  it("removing nothing is a stale-UI no-op", () => {
    assert.equal(classifyRequestRemoval(false, false), "none");
  });
});

describe("friend_request_cancelled — taxonomy parity", () => {
  it("is registered with the funnel join key", () => {
    assert.deepStrictEqual(
      [...ANALYTICS_EVENTS.friend_request_cancelled.props],
      ["targetUserId"],
    );
  });

  it("all three funnel arms share targetUserId so they slice together", () => {
    for (const name of [
      "friend_requested",
      "friend_request_accepted",
      "friend_request_cancelled",
    ] as const) {
      assert.ok(
        ANALYTICS_EVENTS[name].props.includes("targetUserId"),
        `${name} must carry targetUserId — it is the funnel join key`,
      );
    }
  });

  it("props pass the PII rule", () => {
    assert.deepStrictEqual(
      findPiiPropKeys(ANALYTICS_EVENTS.friend_request_cancelled.props),
      [],
    );
  });
});

describe("lib/social-context.tsx — friend_request_cancelled wiring", () => {
  const src = read("lib/social-context.tsx");
  const removeFriendIdx = src.indexOf("removeFriend: async");
  const body = src.slice(removeFriendIdx, src.indexOf("followProfile: async", removeFriendIdx));

  it("imports classifyRequestRemoval from @/lib/social-helpers", () => {
    assert.match(
      src,
      /import\s*\{[^}]*\bclassifyRequestRemoval\b[^}]*\}\s*from\s*["']@\/lib\/social-helpers["']/,
      "social-context must delegate the removal classification to the pure helper",
    );
  });

  it("classifies BEFORE mutating friendRequests (the snapshot must be pre-removal)", () => {
    const classifyIdx = body.indexOf("classifyRequestRemoval(");
    const mutateIdx = body.indexOf("setFriendRequests(");
    assert.ok(classifyIdx >= 0, "removeFriend must call classifyRequestRemoval");
    assert.ok(mutateIdx >= 0, "removeFriend must still mutate friendRequests");
    assert.ok(
      classifyIdx < mutateIdx,
      "classification must read the pre-removal snapshot — after setFriendRequests both directions are gone",
    );
  });

  it("classifies from both hasRequest directions (mine, theirs)", () => {
    assert.match(
      body,
      /classifyRequestRemoval\(\s*hasRequest\(friendRequests,\s*user\.id,\s*profileId\)\s*,\s*hasRequest\(friendRequests,\s*profileId,\s*user\.id\)\s*,?\s*\)/,
      "the classifier's args must be (hadOutgoing, hadIncoming) in that order",
    );
  });

  it("fires only for cancelled_request — declines and unfriends stay silent", () => {
    assert.match(
      body,
      /if\s*\(\s*removal\s*===\s*["']cancelled_request["']\s*\)\s*\{[\s\S]*?trackEvent\(\s*["']friend_request_cancelled["']/,
      "the event must be gated on the cancelled_request classification",
    );
  });

  it("fires with { targetUserId } per the taxonomy", () => {
    assert.match(
      body,
      /trackEvent\(\s*["']friend_request_cancelled["']\s*,\s*\{[^}]*targetUserId:\s*profileId[^}]*\}\s*\)/,
      "friend_request_cancelled must carry targetUserId",
    );
  });
});
