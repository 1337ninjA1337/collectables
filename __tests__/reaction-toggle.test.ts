import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { planReactionToggle, rollbackReactionToggle } from "@/lib/reaction-toggle";
import type { Reaction, ReactionEmoji } from "@/lib/types";

/**
 * One tap on an emoji, as three decisions away from React.
 *
 * `use-reactions.test.ts` mounts the hook and drives it, which is how the
 * optimistic ORDER is asserted — the row has to be on screen before the
 * promise settles, and only a held-open mock can show that. What is here is
 * the part a mount makes expensive to ask: the sequences. A tap against a list
 * a previous tap already changed, a rollback landing after a re-read has
 * already corrected the row, a rollback arriving after the user moved on to
 * another emoji.
 *
 * The rollbacks in particular are written against "the list as it is when the
 * write fails", not "the list as it was when the tap happened", and that is a
 * property no single-tap case can distinguish.
 */

const TARGET = { targetType: "collection" as const, targetId: "c1" };

function reaction(id: string, userId: string, emoji: ReactionEmoji): Reaction {
  return { id, userId, ...TARGET, emoji, createdAt: "2026-09-11T00:00:00.000Z" };
}

/** A tap by "me", with the id and timestamp a caller would have minted. */
function tap(rows: readonly Reaction[], emoji: ReactionEmoji, id = "new-1") {
  return planReactionToggle({
    rows,
    userId: "me",
    ...TARGET,
    emoji,
    id,
    createdAt: "2026-09-11T00:00:01.000Z",
  });
}

describe("planReactionToggle", () => {
  it("adds when I have not reacted with that emoji", () => {
    const plan = tap([], "star");

    assert.equal(plan.kind, "add");
    assert.equal(plan.rows.length, 1);
    assert.equal(plan.rows[0], plan.row);
    assert.deepEqual(plan.row, {
      id: "new-1",
      userId: "me",
      ...TARGET,
      emoji: "star",
      createdAt: "2026-09-11T00:00:01.000Z",
    });
  });

  it("removes when I have", () => {
    const mine = reaction("r1", "me", "star");
    const plan = tap([mine], "star");

    assert.equal(plan.kind, "remove");
    assert.equal(plan.row, mine);
    assert.deepEqual(plan.rows, []);
  });

  it("is mine by (user, emoji) — somebody else's identical reaction is not a row of mine", () => {
    const theirs = reaction("r1", "someone", "star");
    const plan = tap([theirs], "star");

    assert.equal(plan.kind, "add");
    assert.deepEqual(plan.rows, [theirs, plan.row]);
  });

  it("leaves my other emoji alone", () => {
    const heart = reaction("r1", "me", "heart");
    const plan = tap([heart], "star");

    assert.equal(plan.kind, "add");
    assert.deepEqual(plan.rows, [heart, plan.row]);
  });

  it("adds to the end, so the order a re-read produced is not reshuffled", () => {
    const rows = [reaction("r1", "someone", "fire"), reaction("r2", "other", "eyes")];
    const plan = tap(rows, "star");

    assert.deepEqual(plan.rows.slice(0, 2), rows);
  });

  it("never returns the caller's array", () => {
    const rows = [reaction("r1", "someone", "fire")];

    assert.notEqual(tap(rows, "star").rows, rows);
    assert.notEqual(tap([reaction("r1", "me", "star")], "star").rows, rows);
  });

  it("drains a duplicate pair one tap at a time", () => {
    // Two rows for the same (user, emoji) should not exist — the cloud has a
    // unique constraint and the hook now mints unique ids — and if one ever
    // does, removing the first is the only behaviour that can get rid of it.
    const rows = [reaction("r1", "me", "star"), reaction("r2", "me", "star")];
    const first = tap(rows, "star");

    assert.equal(first.kind, "remove");
    assert.deepEqual(
      first.rows.map((row) => row.id),
      ["r2"],
    );
    assert.equal(tap(first.rows, "star").kind, "remove");
  });
});

describe("planReactionToggle over a sequence with no re-render between", () => {
  it("reads the second tap against the first tap's list", () => {
    // The failure the ref in `use-reactions.ts` exists for: two handlers in one
    // pass. Against the SAME list both are adds; against the running one the
    // second is the undo the user expects.
    const first = tap([], "star");
    const second = tap(first.rows, "star", "new-2");

    assert.equal(first.kind, "add");
    assert.equal(second.kind, "remove");
    assert.deepEqual(second.rows, []);
  });

  it("alternates for as long as the taps keep coming", () => {
    let rows: Reaction[] = [];
    const kinds: string[] = [];
    for (let n = 0; n < 5; n += 1) {
      const plan = tap(rows, "fire", `new-${n}`);
      kinds.push(plan.kind);
      rows = plan.rows;
    }

    assert.deepEqual(kinds, ["add", "remove", "add", "remove", "add"]);
    assert.equal(rows.length, 1);
  });

  it("keeps two emoji tapped in one pass apart", () => {
    const heart = tap([], "heart", "new-1");
    const clap = tap(heart.rows, "clap", "new-2");

    assert.equal(clap.kind, "add");
    assert.equal(clap.rows.length, 2);
  });
});

describe("rollbackReactionToggle", () => {
  it("takes the optimistic row back out after a refused insert", () => {
    const plan = tap([], "star");

    assert.deepEqual(rollbackReactionToggle(plan.rows, plan), []);
  });

  it("puts the row back after a refused delete", () => {
    const mine = reaction("r1", "me", "star");
    const plan = tap([mine], "star");

    assert.deepEqual(rollbackReactionToggle(plan.rows, plan), [mine]);
  });

  it("leaves everything that happened while the write was in flight", () => {
    // The reason this takes the CURRENT rows rather than a snapshot: between
    // the optimistic write and the rejection the user tapped a second emoji
    // and a re-read landed. Restoring the pre-tap list would take both away.
    const plan = tap([], "star");
    const later = [...plan.rows, reaction("r9", "someone", "eyes")];

    assert.deepEqual(
      rollbackReactionToggle(later, plan).map((row) => row.id),
      ["r9"],
    );
  });

  it("is idempotent in both directions, because a re-read can get there first", () => {
    const added = tap([], "star");
    const once = rollbackReactionToggle(added.rows, added);
    assert.deepEqual(rollbackReactionToggle(once, added), once);

    const mine = reaction("r1", "me", "star");
    const removed = tap([mine], "star");
    const back = rollbackReactionToggle(removed.rows, removed);
    assert.deepEqual(rollbackReactionToggle(back, removed), back);
  });

  it("does not restore a row the server's own copy already covers", () => {
    // The delete was refused and a re-read brought the row back first. Adding
    // it again would show the reaction twice and count it twice.
    const mine = reaction("r1", "me", "star");
    const plan = tap([mine], "star");

    assert.deepEqual(rollbackReactionToggle([mine], plan), [mine]);
  });

  it("never returns the caller's array", () => {
    const mine = reaction("r1", "me", "star");
    const plan = tap([mine], "star");
    const rows = [mine];

    assert.notEqual(rollbackReactionToggle(rows, plan), rows);
  });
});
