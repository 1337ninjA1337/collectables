import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactElement } from "react";

import type { Reaction, ReactionEmoji, ReactionTargetType } from "@/lib/types";

import { settle } from "./helpers/mount-provider";
import { autoUnmount, installNativeModuleStubs, mockModule, render } from "./helpers/render";

/**
 * `useReactions` — the five emoji under a collection, and what a failed write
 * used to leave on the screen.
 *
 * ## Why it had no suite
 *
 * The last hook on `suite-named-modules.test.ts`'s exemption list, and the
 * fourth of six to close. Its comment said "a hook over the cloud reads; needs
 * both" — a harness and mocked reads — and both were already here: a probe
 * component that calls the hook and renders `null` is the harness, and
 * `mockModule` stands in for `@/lib/auth-context` and
 * `@/lib/supabase-profiles`.
 *
 * ## What it was hiding
 *
 * The hook is optimistic: a tap adds a reaction to local state and THEN tells
 * the cloud. Both writes ended `.catch(() => {})`, so a rejected insert left
 * the reaction on screen, counted, and marked `mine` — a UI stating a fact the
 * server had refused, with nothing to correct it until the screen was
 * remounted. The removal direction lost one the same way. Both roll back now,
 * and the catch is where the rollback lives rather than where the failure was
 * dropped.
 *
 * The second one is smaller and older: an empty `targetId` returned from the
 * effect before `setLoading(false)`, so a reaction bar rendered for a target
 * that has no id yet — the first pass of a detail screen — sat on its spinner
 * for the life of the mount. `reaction-bar.tsx` renders nothing else while
 * `loading` is true.
 *
 * ## What is asserted through the state and what through the mocks
 *
 * The counts, the `mine` flag and `loading` are read off the value the hook
 * returned, because that is what `components/reaction-bar.tsx` renders from.
 * The calls are read off the mocks, because "optimistic" is a claim about
 * ORDER — the state has to change before the promise settles — and only the
 * mock can hold the promise open long enough to look.
 */

/** The signed-in user, or `null`; reassigned per case. */
let currentUser: { id: string } | null = { id: "me" };

/** What `fetchReactions` answers, and whether it rejects. */
let stored: Reaction[] = [];
let fetchError: Error | null = null;
let writeError: Error | null = null;

/** Every cloud call, in order. */
const fetchCalls: { targetType: string; targetId: string }[] = [];
const addCalls: { userId: string; targetId: string; emoji: string }[] = [];
const removeCalls: { userId: string; targetId: string; emoji: string }[] = [];

/** Held open by a case that wants to look at the state before a write lands. */
let releaseWrite: (() => void) | null = null;

mockModule("@/lib/auth-context", {
  useAuth: () => ({ user: currentUser }),
});

mockModule("@/lib/supabase-profiles", {
  fetchReactions: async (targetType: string, targetId: string) => {
    fetchCalls.push({ targetType, targetId });
    if (fetchError) throw fetchError;
    return stored;
  },
  addReaction: async (userId: string, _type: string, targetId: string, emoji: string) => {
    addCalls.push({ userId, targetId, emoji });
    if (releaseWrite) await new Promise<void>((resolve) => (releaseWrite = resolve));
    if (writeError) throw writeError;
  },
  removeReaction: async (userId: string, _type: string, targetId: string, emoji: string) => {
    removeCalls.push({ userId, targetId, emoji });
    if (releaseWrite) await new Promise<void>((resolve) => (releaseWrite = resolve));
    if (writeError) throw writeError;
  },
});

installNativeModuleStubs();
autoUnmount();

type ReactionsModule = typeof import("../lib/use-reactions");
type ReactionsValue = ReturnType<ReactionsModule["useReactions"]>;

let hookModule: ReactionsModule | null = null;
let seen: ReactionsValue | null = null;

const TARGET: ReactionTargetType = "collection";

function reaction(id: string, userId: string, emoji: ReactionEmoji): Reaction {
  return {
    id,
    userId,
    targetType: TARGET,
    targetId: "c1",
    emoji,
    createdAt: "2026-09-06T00:00:00.000Z",
  };
}

/** Renders the hook and drains the fetch it starts. */
async function mount(targetId = "c1") {
  hookModule ??= await import("../lib/use-reactions");
  const useReactions = hookModule.useReactions;
  function Probe() {
    seen = useReactions(TARGET, targetId);
    return null;
  }
  const tree = render(createElement(Probe) as ReactElement);
  await settle();
  tree.rerender();
  return tree;
}

/** The last value the probe saw, asserted non-null. */
function value(): ReactionsValue {
  assert.ok(seen, "no render has happened yet");
  return seen;
}

function countOf(emoji: ReactionEmoji): number {
  return value().counts.find((entry) => entry.key === emoji)!.count;
}

function mineOn(emoji: ReactionEmoji): boolean {
  return value().counts.find((entry) => entry.key === emoji)!.mine;
}

beforeEach(() => {
  currentUser = { id: "me" };
  stored = [];
  fetchError = null;
  writeError = null;
  releaseWrite = null;
  seen = null;
  fetchCalls.length = 0;
  addCalls.length = 0;
  removeCalls.length = 0;
});

describe("useReactions — reading what is already there", () => {
  it("fetches the target's reactions once and stops loading", async () => {
    stored = [reaction("r1", "someone", "fire")];

    await mount();

    assert.deepEqual(fetchCalls, [{ targetType: "collection", targetId: "c1" }]);
    assert.equal(value().loading, false);
    assert.equal(countOf("fire"), 1);
  });

  it("counts per emoji and marks only the signed-in user's own", async () => {
    stored = [
      reaction("r1", "someone", "fire"),
      reaction("r2", "me", "fire"),
      reaction("r3", "someone-else", "heart"),
    ];

    await mount();

    assert.equal(countOf("fire"), 2);
    assert.equal(mineOn("fire"), true);
    assert.equal(countOf("heart"), 1);
    assert.equal(mineOn("heart"), false, "somebody else's heart is not mine");
    assert.equal(value().totalCount, 3, "the total counts everyone's, not mine");
  });

  it("offers all five emoji even for a target nobody has reacted to", async () => {
    // `reaction-bar.tsx` renders one button per entry, so an empty target has
    // to come back with five zeroes rather than an empty list.
    await mount();

    assert.deepEqual(
      value().counts.map((entry) => entry.key),
      ["heart", "fire", "eyes", "star", "clap"],
    );
    assert.deepEqual(
      value().counts.map((entry) => entry.count),
      [0, 0, 0, 0, 0],
    );
  });

  it("marks nothing as mine when nobody is signed in", async () => {
    currentUser = null;
    stored = [reaction("r1", "me", "fire")];

    await mount();

    assert.equal(countOf("fire"), 1);
    assert.equal(mineOn("fire"), false);
  });

  it("shows an empty bar rather than a stuck spinner when the read fails", async () => {
    fetchError = new Error("offline");

    await mount();

    assert.equal(value().loading, false);
    assert.equal(value().totalCount, 0);
  });

  it("does not spin forever for a target with no id yet", async () => {
    // The first pass of a detail screen, before the route param resolves. The
    // effect returned early and left `loading` true, and the bar renders
    // nothing else while it is.
    await mount("");

    assert.deepEqual(fetchCalls, [], "there is nothing to fetch");
    assert.equal(value().loading, false);
  });
});

describe("useReactions — toggling", () => {
  it("shows the reaction before the write lands, then keeps it", async () => {
    const tree = await mount();
    releaseWrite = () => {};

    const pending = value().toggle("star");
    tree.rerender();

    assert.equal(countOf("star"), 1, "the tap must show immediately");
    assert.equal(mineOn("star"), true);
    releaseWrite?.();
    await pending;
    tree.rerender();

    assert.deepEqual(addCalls, [{ userId: "me", targetId: "c1", emoji: "star" }]);
    assert.equal(countOf("star"), 1);
  });

  it("takes back the reaction the server refused", async () => {
    const tree = await mount();
    writeError = new Error("rls");

    await value().toggle("star");
    tree.rerender();

    assert.equal(countOf("star"), 0, "a refused insert must not stay on screen");
    assert.equal(mineOn("star"), false);
  });

  it("removes my own reaction and tells the cloud", async () => {
    stored = [reaction("r1", "me", "heart")];
    const tree = await mount();
    assert.equal(countOf("heart"), 1);

    await value().toggle("heart");
    tree.rerender();

    assert.deepEqual(removeCalls, [{ userId: "me", targetId: "c1", emoji: "heart" }]);
    assert.deepEqual(addCalls, [], "a reaction I already left is a removal");
    assert.equal(countOf("heart"), 0);
  });

  it("puts back the reaction the server would not delete", async () => {
    stored = [reaction("r1", "me", "heart")];
    const tree = await mount();
    writeError = new Error("offline");

    await value().toggle("heart");
    tree.rerender();

    assert.equal(countOf("heart"), 1, "a failed delete must not look like a delete");
    assert.equal(mineOn("heart"), true);
  });

  it("leaves somebody else's reaction alone and adds my own", async () => {
    stored = [reaction("r1", "someone", "eyes")];
    const tree = await mount();

    await value().toggle("eyes");
    tree.rerender();

    assert.equal(countOf("eyes"), 2);
    assert.deepEqual(addCalls, [{ userId: "me", targetId: "c1", emoji: "eyes" }]);
    assert.deepEqual(removeCalls, []);
  });

  it("does nothing at all when nobody is signed in", async () => {
    currentUser = null;
    const tree = await mount();

    await value().toggle("clap");
    tree.rerender();

    assert.deepEqual(addCalls, []);
    assert.deepEqual(removeCalls, []);
    assert.equal(countOf("clap"), 0);
  });
});

describe("useReactions — two taps before a re-render", () => {
  /**
   * The gesture, not a contrived one: the five emoji are 44 points apart and a
   * double tap on one of them is a single thing a finger does. Both handlers
   * run against whatever the hook knew at the last render, and there is no
   * render between them.
   */
  it("reads the second tap against the first, rather than adding twice", async () => {
    const tree = await mount();

    await Promise.all([value().toggle("star"), value().toggle("star")]);
    tree.rerender();

    // On then off. Before the rows moved into a ref, both taps found no row of
    // their own and both inserted: two hearts on screen, two INSERTs sent to a
    // table that allows one per (user, target, emoji).
    assert.equal(countOf("star"), 0, "the second tap must undo the first");
    assert.equal(mineOn("star"), false);
    assert.deepEqual(addCalls, [{ userId: "me", targetId: "c1", emoji: "star" }]);
    assert.deepEqual(removeCalls, [{ userId: "me", targetId: "c1", emoji: "star" }]);
  });

  it("takes three taps back to one reaction, not to three", async () => {
    const tree = await mount();

    await Promise.all([
      value().toggle("fire"),
      value().toggle("fire"),
      value().toggle("fire"),
    ]);
    tree.rerender();

    assert.equal(countOf("fire"), 1);
    assert.equal(addCalls.length, 2);
    assert.equal(removeCalls.length, 1);
  });

  it("keeps two different emoji apart when both are tapped in one pass", async () => {
    const tree = await mount();

    await Promise.all([value().toggle("heart"), value().toggle("clap")]);
    tree.rerender();

    // The second tap reading the first's list must not mean it overwrites it:
    // a ref that replaced the list rather than extending it would leave one.
    assert.equal(countOf("heart"), 1);
    assert.equal(countOf("clap"), 1);
    assert.equal(value().totalCount, 2);
  });

  it("gives each optimistic row its own id", async () => {
    // `tmp-${Date.now()}` gave two taps in one millisecond the same id, and a
    // rollback of either then removed both. Two rows added in one pass is the
    // cheapest way to ask whether the ids can collide.
    const tree = await mount();

    await Promise.all([value().toggle("heart"), value().toggle("clap")]);
    tree.rerender();

    assert.equal(value().totalCount, 2, "two rows with one id would count as one removal later");

    writeError = new Error("rls");
    await value().toggle("eyes");
    tree.rerender();

    assert.equal(countOf("heart"), 1, "a refused third tap must not take the first two down");
    assert.equal(countOf("clap"), 1);
    assert.equal(countOf("eyes"), 0);
  });

  it("keeps one handler identity across taps, so a memoized bar does not re-render per reaction", async () => {
    // The handler closed over `reactions` before this, so every tap minted a
    // new `toggle` — which is both the staleness above and a new prop for
    // `components/reaction-bar.tsx` on every count change.
    const tree = await mount();
    const first = value().toggle;

    await value().toggle("star");
    tree.rerender();

    assert.equal(value().toggle, first);
  });
});
