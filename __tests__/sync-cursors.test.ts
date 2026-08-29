import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { SYNC_OVERLAP_MS, maxUpdatedAt, overlapCursor } from "@/lib/sync-cursors";

import { readRepoFile } from "./helpers/repo-file";

// --- maxUpdatedAt (pure delta-cursor reducer) ---
describe("maxUpdatedAt", () => {
  it("returns the current cursor unchanged when no rows are given", () => {
    assert.equal(maxUpdatedAt("2026-06-19T00:00:00Z", []), "2026-06-19T00:00:00Z");
    assert.equal(maxUpdatedAt(null, []), null);
  });

  it("picks the newest updated_at across rows when starting from null", () => {
    assert.equal(
      maxUpdatedAt(null, [
        { updated_at: "2026-06-18T10:00:00Z" },
        { updated_at: "2026-06-19T10:00:00Z" },
        { updated_at: "2026-06-17T10:00:00Z" },
      ]),
      "2026-06-19T10:00:00Z",
    );
  });

  it("never goes backwards from the current cursor", () => {
    assert.equal(
      maxUpdatedAt("2026-06-20T00:00:00Z", [
        { updated_at: "2026-06-19T10:00:00Z" },
        { updated_at: "2026-06-18T10:00:00Z" },
      ]),
      "2026-06-20T00:00:00Z",
    );
  });

  it("advances past the current cursor when a row is newer", () => {
    assert.equal(
      maxUpdatedAt("2026-06-19T00:00:00Z", [{ updated_at: "2026-06-19T12:00:00Z" }]),
      "2026-06-19T12:00:00Z",
    );
  });

  it("compares numerically, not lexicographically, across offset formats", () => {
    // "2026-06-19T12:00:00+00:00" sorts before the "+02:00" string
    // lexicographically but is the LATER instant (10:00Z vs 13:00Z) — wait,
    // here the +00:00 row is the later instant, so it must win.
    const result = maxUpdatedAt(null, [
      { updated_at: "2026-06-19T13:00:00+02:00" }, // 11:00Z
      { updated_at: "2026-06-19T12:00:00+00:00" }, // 12:00Z — later instant
    ]);
    assert.equal(result, "2026-06-19T12:00:00+00:00");
  });

  it("picks the true maximum inside one millisecond, whatever order the rows arrive in", () => {
    // `updated_at` is a timestamptz — Postgres keeps microseconds and
    // `Date.parse` keeps milliseconds, so these three parse to one number and
    // the pre-2026-08-29 reducer returned whichever came first. The batch is
    // the ordinary case rather than a contrived one: `moddatetime` stamps every
    // row of one statement with the same `now()`.
    const rows = [
      { updated_at: "2026-06-19T12:00:00.123100+00:00" },
      { updated_at: "2026-06-19T12:00:00.123900+00:00" },
      { updated_at: "2026-06-19T12:00:00.123500+00:00" },
    ];
    const highest = "2026-06-19T12:00:00.123900+00:00";
    assert.equal(maxUpdatedAt(null, rows), highest);
    assert.equal(maxUpdatedAt(null, [...rows].reverse()), highest);
    assert.equal(maxUpdatedAt(null, [rows[1], rows[0], rows[2]]), highest);
  });

  it("does not go backwards from a current cursor sharing the batch's millisecond", () => {
    // The half that makes the tiebreak safe to add: it may raise the cursor
    // inside a millisecond and must never lower it, or the next pull re-reads
    // rows this one already applied.
    const current = "2026-06-19T12:00:00.123900+00:00";
    assert.equal(
      maxUpdatedAt(current, [{ updated_at: "2026-06-19T12:00:00.123100+00:00" }]),
      current,
    );
  });

  it("still lets a later millisecond outrank a longer string in an earlier one", () => {
    // The tiebreak is consulted only between equal milliseconds, so it cannot
    // outrank the numeric comparison — which is the rule a plain lexicographic
    // max would break here (".0999" sorts above ".100").
    assert.equal(
      maxUpdatedAt(null, [
        { updated_at: "2026-06-19T12:00:00.099999+00:00" },
        { updated_at: "2026-06-19T12:00:00.100000+00:00" },
      ]),
      "2026-06-19T12:00:00.100000+00:00",
    );
  });

  it("skips missing / null / unparseable values", () => {
    assert.equal(
      maxUpdatedAt(null, [
        { updated_at: null },
        { updated_at: undefined },
        { updated_at: "not-a-date" },
        { updated_at: "2026-06-19T10:00:00Z" },
      ]),
      "2026-06-19T10:00:00Z",
    );
    assert.equal(maxUpdatedAt(null, [{ updated_at: "garbage" }]), null);
  });
});

// --- overlapCursor (what actually gets persisted) ---
describe("overlapCursor", () => {
  it("persists a cursor a margin behind the batch maximum", () => {
    // The race it covers: `moddatetime` writes `now()`, which is the
    // transaction's START time, while the row becomes readable at COMMIT. A
    // write straddling this pull's snapshot is absent from the batch and
    // carries a timestamp at or below its maximum, so a cursor set to that
    // maximum steps over it — permanently, since no tombstone covers an edit
    // and nothing else asks for a row that is not new.
    assert.equal(
      overlapCursor("2026-06-19T12:00:30.000Z", null),
      "2026-06-19T12:00:20.000Z",
    );
    assert.equal(SYNC_OVERLAP_MS, 10_000);
  });

  it("never walks the cursor backwards into rows already applied", () => {
    // A short batch whose maximum is barely above the stored cursor would
    // otherwise rewind past it and re-read everything the last pull merged.
    const previous = "2026-06-19T12:00:25.000Z";
    assert.equal(overlapCursor("2026-06-19T12:00:30.000Z", previous), previous);
  });

  it("leaves the cursor alone when there is nothing to advance to", () => {
    assert.equal(overlapCursor(null, "2026-06-19T12:00:00.000Z"), "2026-06-19T12:00:00.000Z");
    assert.equal(overlapCursor(null, null), null);
    // An unparseable maximum is not a reason to move: the alternative is
    // NaN arithmetic producing an invalid date and a cursor nothing matches.
    assert.equal(overlapCursor("garbage", "2026-06-19T12:00:00.000Z"), "2026-06-19T12:00:00.000Z");
  });

  it("takes the margin as a parameter so the window is one number, not a scattered constant", () => {
    assert.equal(
      overlapCursor("2026-06-19T12:00:30.000Z", null, 1_000),
      "2026-06-19T12:00:29.000Z",
    );
  });
});

// --- structural: storage key + wiring (file-scan, no AsyncStorage needed) ---
const read = (p: string) => readRepoFile(p);

describe("sync-cursors storage + context wiring", () => {
  it("keys cursors per entity + user under collectables-sync-cursor-v1", () => {
    const keys = read("lib/storage-keys.ts");
    assert.match(keys, /collectables-sync-cursor-v1-\$\{entity\}-\$\{userId\}/);
    assert.match(keys, /syncCursorKey/);
  });

  it("clears both cursor keys on per-user data reset", () => {
    const keys = read("lib/storage-keys.ts");
    assert.match(keys, /syncCursorKey\("collections", userId\)/);
    assert.match(keys, /syncCursorKey\("items", userId\)/);
  });

  it("the warm refresh path delta-pulls collections + items via cursors", () => {
    const ctx = read("lib/collections-context.tsx");
    assert.match(ctx, /getSyncCursor\("collections", activeUser\.id\)/);
    assert.match(ctx, /fetchOwnCollectionsSince\(activeUser\.id, colCursor\)/);
    assert.match(ctx, /fetchOwnItemsSince\(activeUser\.id, itemCursor\)/);
    assert.match(ctx, /overlapCursor\(nextItemCursor, itemCursor\)/);
  });

  it("persists BOTH cursors through overlapCursor, not the raw batch maximum", () => {
    // The adoption case. The whole point of the margin is that it is applied at
    // every persist site — one call site left writing `nextCursor` directly
    // keeps that entity's edits losable, and nothing else in the pull would say
    // so.
    const ctx = read("lib/collections-context.tsx");
    assert.match(ctx, /overlapCursor\(nextColCursor, colCursor\)/);
    assert.match(ctx, /overlapCursor\(nextItemCursor, itemCursor\)/);
    assert.doesNotMatch(ctx, /setSyncCursor\(\s*"\w+",\s*activeUser\.id,\s*next\w+Cursor,/);
  });
});
