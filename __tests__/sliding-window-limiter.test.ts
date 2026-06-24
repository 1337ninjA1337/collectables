import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSlidingWindowLimiter } from "../lib/sliding-window-limiter";

describe("BE-29 — createSlidingWindowLimiter", () => {
  it("admits up to maxEvents then denies within the window", () => {
    const limiter = createSlidingWindowLimiter(3, 1000);
    assert.equal(limiter.allow(0), true);
    assert.equal(limiter.allow(0), true);
    assert.equal(limiter.allow(0), true);
    assert.equal(limiter.allow(0), false, "4th in-window event is denied");
  });

  it("re-admits once old events fall out of the trailing window", () => {
    const limiter = createSlidingWindowLimiter(2, 1000);
    assert.equal(limiter.allow(0), true);
    assert.equal(limiter.allow(500), true);
    assert.equal(limiter.allow(900), false, "window still full at 900");
    // The event at t=0 is now older than 1000ms, so one slot frees up.
    assert.equal(limiter.allow(1001), true);
    // The event at t=500 is still in-window (>1001-1000=1), so full again.
    assert.equal(limiter.allow(1001), false);
  });

  it("prunes an event exactly at the window edge (cutoff is exclusive)", () => {
    const limiter = createSlidingWindowLimiter(1, 1000);
    assert.equal(limiter.allow(0), true);
    // cutoff = 999 - 1000 = -1; t=0 > -1 → still in window, full.
    assert.equal(limiter.allow(999), false);
    // cutoff = 1000 - 1000 = 0; t=0 is NOT > 0 → pruned, admitted.
    assert.equal(limiter.allow(1000), true);
  });

  it("reset() clears the window", () => {
    const limiter = createSlidingWindowLimiter(1, 1000);
    assert.equal(limiter.allow(0), true);
    assert.equal(limiter.allow(0), false);
    limiter.reset();
    assert.equal(limiter.allow(0), true, "fresh window after reset");
  });

  it("defaults now to wall-clock when omitted", () => {
    const limiter = createSlidingWindowLimiter(1, 60_000);
    assert.equal(limiter.allow(), true);
    assert.equal(limiter.allow(), false);
  });
});
