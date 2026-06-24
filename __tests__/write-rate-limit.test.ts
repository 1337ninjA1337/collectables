import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  appWriteLimiter,
  createRateLimitedDeliver,
  __resetWriteRateLimitForTests,
} from "../lib/write-rate-limit";
import { createSlidingWindowLimiter } from "../lib/sliding-window-limiter";

describe("BE-29 — createRateLimitedDeliver", () => {
  beforeEach(() => __resetWriteRateLimitForTests());

  it("forwards delivery while the limiter has headroom", async () => {
    const calls: string[] = [];
    const limiter = createSlidingWindowLimiter(10, 1000);
    const deliver = createRateLimitedDeliver<string>(async (e, outId) => {
      calls.push(`${e}:${outId}`);
      return true;
    }, limiter);
    assert.equal(await deliver("a", "id-a"), true);
    assert.deepEqual(calls, ["a:id-a"]);
  });

  it("returns false WITHOUT calling deliver once the window is full", async () => {
    let attempts = 0;
    const limiter = createSlidingWindowLimiter(2, 1000);
    const deliver = createRateLimitedDeliver<string>(async () => {
      attempts += 1;
      return true;
    }, limiter);
    assert.equal(await deliver("a", "1"), true);
    assert.equal(await deliver("b", "2"), true);
    assert.equal(await deliver("c", "3"), false, "throttled write defers");
    assert.equal(attempts, 2, "the throttled write never hit the network");
  });

  it("propagates a genuine delivery failure as false", async () => {
    const limiter = createSlidingWindowLimiter(10, 1000);
    const deliver = createRateLimitedDeliver<string>(async () => false, limiter);
    assert.equal(await deliver("a", "1"), false);
  });

  it("defaults to the shared appWriteLimiter", async () => {
    // Exhaust the shared limiter on the real clock (the wrapper calls allow()
    // with no arg → Date.now()), then a default-limiter deliver must be
    // throttled — proving the wrapper shares one app-wide budget.
    for (let i = 0; i < 120; i += 1) appWriteLimiter.allow();
    const deliver = createRateLimitedDeliver<string>(async () => true);
    assert.equal(await deliver("x", "1"), false);
  });

  it("__resetWriteRateLimitForTests restores headroom", async () => {
    for (let i = 0; i < 120; i += 1) appWriteLimiter.allow();
    __resetWriteRateLimitForTests();
    const deliver = createRateLimitedDeliver<string>(async () => true);
    assert.equal(await deliver("x", "1"), true);
  });
});
