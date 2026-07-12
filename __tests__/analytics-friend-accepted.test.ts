import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { ANALYTICS_EVENTS } from "../lib/analytics-events";
import { findPiiPropKeys } from "../lib/analytics-pii";
import {
  diffAcceptedFriendships,
  type FriendRequestEdge,
} from "../lib/social-helpers";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const ME = "user-me";
const THEM = "user-them";

const edge = (fromUserId: string, toUserId: string): FriendRequestEdge => ({
  fromUserId,
  toUserId,
});

const MUTUAL: FriendRequestEdge[] = [edge(ME, THEM), edge(THEM, ME)];

describe("lib/social-helpers.ts — diffAcceptedFriendships", () => {
  it("incoming-only → mutual fires accepted_by_me (this device tapped accept)", () => {
    assert.deepStrictEqual(diffAcceptedFriendships([edge(THEM, ME)], MUTUAL, ME), [
      { targetUserId: THEM, direction: "accepted_by_me" },
    ]);
  });

  it("outgoing-only → mutual fires accepted_by_them (our request converted remotely)", () => {
    assert.deepStrictEqual(diffAcceptedFriendships([edge(ME, THEM)], MUTUAL, ME), [
      { targetUserId: THEM, direction: "accepted_by_them" },
    ]);
  });

  it("hydration is safe by construction: empty prev → mutual next never fires", () => {
    // The sign-in baseline is [] and the initial fetch delivers already-mutual
    // pairs — no pending handshake in prev means no acceptance happened NOW.
    assert.deepStrictEqual(diffAcceptedFriendships([], MUTUAL, ME), []);
  });

  it("already-mutual pairs don't re-fire on refetch echoes", () => {
    assert.deepStrictEqual(diffAcceptedFriendships(MUTUAL, [...MUTUAL], ME), []);
  });

  it("a fresh outgoing request (none → outgoing) is not an acceptance", () => {
    assert.deepStrictEqual(diffAcceptedFriendships([], [edge(ME, THEM)], ME), []);
  });

  it("unfriending (mutual → none/half) fires nothing", () => {
    assert.deepStrictEqual(diffAcceptedFriendships(MUTUAL, [], ME), []);
    assert.deepStrictEqual(diffAcceptedFriendships(MUTUAL, [edge(THEM, ME)], ME), []);
  });

  it("only handshakes involving userId count; third-party edges are ignored", () => {
    const others = [edge("user-a", "user-b"), edge("user-b", "user-a")];
    assert.deepStrictEqual(diffAcceptedFriendships([], others, ME), []);
    assert.deepStrictEqual(
      diffAcceptedFriendships([edge(THEM, ME), ...others], [...MUTUAL, ...others], ME),
      [{ targetUserId: THEM, direction: "accepted_by_me" }],
    );
  });

  it("multiple acceptances in one transition all surface", () => {
    const other = "user-other";
    const prev = [edge(THEM, ME), edge(ME, other)];
    const next = [...MUTUAL, edge(ME, other), edge(other, ME)];
    const accepted = diffAcceptedFriendships(prev, next, ME);
    assert.deepStrictEqual(
      accepted.sort((a, b) => a.targetUserId.localeCompare(b.targetUserId)),
      [
        { targetUserId: other, direction: "accepted_by_them" },
        { targetUserId: THEM, direction: "accepted_by_me" },
      ].sort((a, b) => a.targetUserId.localeCompare(b.targetUserId)),
    );
  });

  it("self-edges never produce a handshake", () => {
    assert.deepStrictEqual(
      diffAcceptedFriendships([edge(ME, ME)], [edge(ME, ME)], ME),
      [],
    );
  });
});

describe("friend_request_accepted — taxonomy parity", () => {
  it("is registered with the funnel-pairing props", () => {
    assert.deepStrictEqual(
      [...ANALYTICS_EVENTS.friend_request_accepted.props],
      ["targetUserId", "direction"],
    );
  });

  it("targetUserId matches friend_requested's join key so the funnel arms slice together", () => {
    assert.ok(
      ANALYTICS_EVENTS.friend_requested.props.includes("targetUserId"),
      "friend_requested must keep targetUserId — it is the funnel join key",
    );
  });

  it("props pass the PII rule", () => {
    assert.deepStrictEqual(
      findPiiPropKeys(ANALYTICS_EVENTS.friend_request_accepted.props),
      [],
    );
  });

  it("the helper's payload keys are exactly the registered props", () => {
    // Lock-step guard: the effect passes the AcceptedFriendship object straight
    // to trackEvent, so a helper-side key rename would get stripped/thrown by
    // assertValidProps unless the registry moves with it.
    const [accepted] = diffAcceptedFriendships([edge(THEM, ME)], MUTUAL, ME);
    assert.deepStrictEqual(
      Object.keys(accepted).sort(),
      [...ANALYTICS_EVENTS.friend_request_accepted.props].sort(),
    );
  });
});

describe("lib/social-context.tsx — friend_request_accepted wiring", () => {
  const src = read("lib/social-context.tsx");

  it("imports diffAcceptedFriendships from @/lib/social-helpers", () => {
    assert.match(
      src,
      /import\s*\{[^}]*\bdiffAcceptedFriendships\b[^}]*\}\s*from\s*["']@\/lib\/social-helpers["']/,
      "social-context must delegate the acceptance diff to the pure helper",
    );
  });

  it("fires from a friendRequests-transition effect, not from addFriend", () => {
    const effectIdx = src.indexOf("diffAcceptedFriendships(");
    assert.ok(effectIdx >= 0, "diffAcceptedFriendships call site not found");
    const window = src.slice(Math.max(0, effectIdx - 800), effectIdx + 300);
    assert.match(
      window,
      /useEffect\(/,
      "the acceptance diff must live in an effect observing friendRequests",
    );
    assert.match(
      window,
      /trackEvent\(\s*["']friend_request_accepted["']/,
      "the effect must fire friend_request_accepted with the diffed payload",
    );
    // addFriend's isAccept branch must NOT fire the event directly — the
    // transition effect owns it, so remote acceptances count too and local
    // ones can't double-fire.
    const addFriendIdx = src.indexOf("addFriend: async");
    const addFriendBody = src.slice(addFriendIdx, src.indexOf("removeFriend: async", addFriendIdx));
    assert.doesNotMatch(
      addFriendBody,
      /trackEvent\(\s*["']friend_request_accepted["']/,
      "addFriend must not fire friend_request_accepted inline — the diff effect covers both sides",
    );
  });

  it("keeps a per-account baseline ref that resets to [] on account change", () => {
    assert.match(
      src,
      /friendRequestsBaselineRef\s*=\s*useRef<\{\s*userId:\s*string\s*\|\s*null;\s*requests:\s*FriendRequest\[\]\s*\}>/,
      "baseline ref must pair the snapshot with the account it belongs to",
    );
    assert.match(
      src,
      /baseline\.userId\s*===\s*userId\s*\?\s*baseline\.requests\s*:\s*\[\]/,
      "a stale other-account snapshot must never be diffed — reset to [] on account change",
    );
  });

  it("the baseline advances before the signed-out early return so a stale snapshot can't linger", () => {
    const refIdx = src.indexOf("friendRequestsBaselineRef.current = { userId, requests: friendRequests }");
    assert.ok(refIdx >= 0, "baseline advance not found");
    const afterAdvance = src.slice(refIdx, refIdx + 300);
    assert.match(
      afterAdvance,
      /if\s*\(\s*!userId\s*\)\s*\{\s*return;?\s*\}/,
      "the signed-out early return must come AFTER the baseline advance",
    );
  });
});
