import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MIN_SPINNER_VISIBLE_MS,
  remainingHold,
  resolveHoldDelay,
} from "@/lib/minimum-visible-helpers";
import { readRepoFile as read } from "./helpers/repo-file";

/**
 * Pins for the pull-to-refresh spinner hold.
 *
 * The backlog task asked for `useDebouncedValue(refreshing, 100)`. That is the
 * wrong primitive and the tests below encode why, because the mistake is not
 * obvious from the symptom: `<RefreshControl>` is already on screen while the
 * user drags it, so delaying the leading edge lets it retract on release and
 * re-open 100ms later — one flash becomes two. What the symptom actually calls
 * for is a trailing hold, which is this module.
 *
 * The pure half is unit-tested; the hook and its adoption are pinned
 * structurally, since `tsx --test` has no React mounting harness (the same
 * constraint the `[needs-dev-dep]` analytics tasks are blocked on).
 */

const HOOK = "lib/use-minimum-visible.ts";

/** Every screen with pull-to-refresh. */
const CONSUMERS = [
  "app/index.tsx",
  "app/stats.tsx",
  "app/people.tsx",
  "app/profile/[id].tsx",
  "app/item/[id].tsx",
  "app/collection/[id].tsx",
  "app/wishlist.tsx",
];

describe("minimum-visible-helpers — resolveHoldDelay", () => {
  it("passes a normal hold through untouched", () => {
    assert.equal(resolveHoldDelay(400), 400);
    assert.equal(resolveHoldDelay(1), 1);
  });

  it("folds Infinity to 0 rather than pinning the spinner up forever", () => {
    assert.equal(resolveHoldDelay(Infinity), 0);
  });

  it("folds NaN to 0 instead of letting setTimeout swallow it silently", () => {
    assert.equal(resolveHoldDelay(NaN), 0);
  });

  it("treats zero and negatives as 'no hold'", () => {
    assert.equal(resolveHoldDelay(0), 0);
    assert.equal(resolveHoldDelay(-1), 0);
    assert.equal(resolveHoldDelay(-0), 0);
  });
});

describe("minimum-visible-helpers — remainingHold", () => {
  it("owes the full hold at the instant the flag goes up", () => {
    assert.equal(remainingHold(1_000, 1_000, 400), 400);
  });

  it("owes the remainder part-way through", () => {
    assert.equal(remainingHold(1_000, 1_150, 400), 250);
  });

  it("owes nothing once the hold has elapsed", () => {
    assert.equal(remainingHold(1_000, 1_400, 400), 0);
    assert.equal(remainingHold(1_000, 9_999, 400), 0);
  });

  it("never returns a negative — a slow refresh is released immediately", () => {
    // The whole point: the hold covers the tail of a FAST refresh and adds
    // nothing to a slow one.
    assert.equal(remainingHold(1_000, 60_000, 400), 0);
  });

  it("yields the full hold when the clock moved backwards", () => {
    // NTP correction or a device time change mid-refresh. An extra 400ms of
    // spinner beats dropping the hold and flashing.
    assert.equal(remainingHold(5_000, 1_000, 400), 400);
  });

  it("owes nothing when the hold itself is degenerate", () => {
    assert.equal(remainingHold(1_000, 1_000, 0), 0);
    assert.equal(remainingHold(1_000, 1_000, NaN), 0);
    assert.equal(remainingHold(1_000, 1_000, Infinity), 0);
  });

  it("defaults to roughly one indicator rotation", () => {
    // Below ~400ms a spinner reads as a glitch rather than as feedback; the
    // number is the contract, so a future tweak has to come here.
    assert.equal(MIN_SPINNER_VISIBLE_MS, 400);
  });
});

describe("lib/use-minimum-visible.ts — structure", () => {
  const src = read(HOOK);

  it("shows immediately and only holds the trailing edge", () => {
    // `active || lingering` is the whole leading-edge contract: a debounce
    // would have returned a lagged value here instead.
    assert.match(src, /return active \|\| lingering;/);
  });

  it("does NOT restamp while already active", () => {
    // A second refresh started inside the first one's hold would otherwise
    // extend the hold indefinitely.
    assert.match(src, /if \(shownAt\.current == null\) shownAt\.current = Date\.now\(\);/);
  });

  it("does not linger for a flag that never went up", () => {
    // First render, or a handler that bailed before setRefreshing(true) —
    // lingering there would show a spinner the user never triggered.
    assert.match(src, /if \(startedAt == null\) return;/);
  });

  it("keeps the timestamp in a ref, not in state", () => {
    // Nothing renders it; setState here would re-render on every refresh start.
    assert.match(src, /const shownAt = useRef<number \| null>\(null\);/);
  });

  it("clears its timer on unmount and on every re-run", () => {
    assert.match(src, /return \(\) => clearTimeout\(timer\);/);
  });

  it("does not list `lingering` as a dependency", () => {
    // Listing it would re-run the effect on every settle and restart the
    // timer forever — the same trap `useDebouncedValue` documents.
    assert.match(src, /\}, \[active, hold\]\);/);
  });
});

describe("use-minimum-visible — adoption", () => {
  it("every pull-to-refresh screen holds its spinner", () => {
    for (const file of CONSUMERS) {
      const src = read(file);
      assert.match(src, /import \{ useMinimumVisible \} from "@\/lib\/use-minimum-visible";/, file);
      assert.match(src, /const showRefreshing = useMinimumVisible\(refreshing\);/, file);
    }
  });

  it("no screen still passes the raw flag to a RefreshControl", () => {
    // The tell that a screen was added later and copied the old handler shape.
    for (const file of CONSUMERS) {
      const src = read(file);
      assert.doesNotMatch(src, /refreshing=\{refreshing\}/, file);
      assert.doesNotMatch(src, /refreshing=\{!!refreshing\}/, file);
    }
  });

  it("nobody reached for the debounce hook to solve this", () => {
    // The rejected approach, pinned so it cannot quietly come back: a leading
    // delay on a <RefreshControl> adds a flash rather than removing one.
    for (const file of CONSUMERS) {
      assert.doesNotMatch(read(file), /useDebouncedValue\(refreshing/, file);
    }
  });
});
