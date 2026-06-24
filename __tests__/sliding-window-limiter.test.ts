import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createSlidingWindowLimiter } from "@/lib/sliding-window-limiter";

describe("BE-29 createSlidingWindowLimiter", () => {
  it("allows up to `max` events inside the window, then denies", () => {
    const limiter = createSlidingWindowLimiter({ windowMs: 1000, max: 3 });
    assert.equal(limiter.allow(0), true);
    assert.equal(limiter.allow(0), true);
    assert.equal(limiter.allow(0), true);
    // 4th within the same window is denied.
    assert.equal(limiter.allow(0), false);
  });

  it("does not record an event when it denies (count stays at max)", () => {
    const limiter = createSlidingWindowLimiter({ windowMs: 1000, max: 2 });
    limiter.allow(0);
    limiter.allow(0);
    assert.equal(limiter.count(0), 2);
    limiter.allow(0); // denied
    limiter.allow(0); // denied
    assert.equal(limiter.count(0), 2);
  });

  it("frees capacity as old events age past windowMs", () => {
    const limiter = createSlidingWindowLimiter({ windowMs: 1000, max: 1 });
    assert.equal(limiter.allow(0), true);
    assert.equal(limiter.allow(500), false); // still inside the window
    assert.equal(limiter.allow(999), false); // still inside the window
    // The cutoff is `now - windowMs`, kept strictly (`ts > cutoff`), so the
    // event at t=0 is pruned the instant `now` reaches t=1000.
    assert.equal(limiter.allow(1000), true);
  });

  it("slides continuously rather than resetting on fixed buckets", () => {
    const limiter = createSlidingWindowLimiter({ windowMs: 1000, max: 2 });
    assert.equal(limiter.allow(0), true);
    assert.equal(limiter.allow(900), true);
    assert.equal(limiter.allow(950), false); // window holds t=0 and t=900
    // Once t=0 ages out, one slot frees even though t=900 is still live.
    assert.equal(limiter.allow(1001), true);
    assert.equal(limiter.allow(1001), false); // now holds t=900 and t=1001
  });

  it("count() prunes expired timestamps as a side effect", () => {
    const limiter = createSlidingWindowLimiter({ windowMs: 1000, max: 5 });
    limiter.allow(0);
    limiter.allow(100);
    assert.equal(limiter.count(100), 2);
    assert.equal(limiter.count(2000), 0);
  });

  it("reset() clears the window", () => {
    const limiter = createSlidingWindowLimiter({ windowMs: 1000, max: 1 });
    assert.equal(limiter.allow(0), true);
    assert.equal(limiter.allow(0), false);
    limiter.reset();
    assert.equal(limiter.allow(0), true);
  });

  it("max <= 0 denies everything", () => {
    const limiter = createSlidingWindowLimiter({ windowMs: 1000, max: 0 });
    assert.equal(limiter.allow(0), false);
    assert.equal(limiter.count(0), 0);
  });
});
