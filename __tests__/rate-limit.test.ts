import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { createSlidingWindowLimiter } from "@/lib/rate-limit";

describe("createSlidingWindowLimiter", () => {
  it("admits calls up to the cap within the window", () => {
    const limiter = createSlidingWindowLimiter(3, 1000);
    assert.equal(limiter.allow(0), true);
    assert.equal(limiter.allow(100), true);
    assert.equal(limiter.allow(200), true);
    // 4th call inside the window is rejected.
    assert.equal(limiter.allow(300), false);
  });

  it("drops a burst past the cap client-side (integration shape)", () => {
    const limiter = createSlidingWindowLimiter(240, 60_000);
    let admitted = 0;
    let rejected = 0;
    // 500 writes fired in the same millisecond — a hot loop / script abuse.
    for (let i = 0; i < 500; i++) {
      if (limiter.allow(0)) admitted++;
      else rejected++;
    }
    assert.equal(admitted, 240);
    assert.equal(rejected, 260);
  });

  it("slides: an old call ages out and frees a slot", () => {
    const limiter = createSlidingWindowLimiter(2, 1000);
    assert.equal(limiter.allow(0), true);
    assert.equal(limiter.allow(500), true);
    assert.equal(limiter.allow(900), false); // window full (0 and 500 still inside)
    // At t=1100 the t=0 call is older than the 1000ms window → pruned.
    assert.equal(limiter.allow(1100), true);
  });

  it("a rejected call never extends the window (records nothing)", () => {
    const limiter = createSlidingWindowLimiter(1, 1000);
    assert.equal(limiter.allow(0), true);
    assert.equal(limiter.allow(100), false); // rejected, not recorded
    assert.equal(limiter.allow(200), false); // rejected, not recorded
    // Only the t=0 call counts; once it ages out the next call is admitted.
    assert.equal(limiter.allow(1001), true);
  });

  it("treats the cutoff as exclusive (a call exactly windowMs old is pruned)", () => {
    const limiter = createSlidingWindowLimiter(1, 1000);
    assert.equal(limiter.allow(0), true);
    // t=1000 is exactly windowMs after t=0 → t=0 is at the cutoff, pruned.
    assert.equal(limiter.allow(1000), true);
  });

  it("count() reports the live window size without recording a call", () => {
    const limiter = createSlidingWindowLimiter(5, 1000);
    limiter.allow(0);
    limiter.allow(100);
    assert.equal(limiter.count(200), 2);
    assert.equal(limiter.count(200), 2); // idempotent — count() never records
    assert.equal(limiter.count(1050), 1); // t=0 aged out (cutoff=50), t=100 kept
  });

  it("reset() forgets every recorded timestamp", () => {
    const limiter = createSlidingWindowLimiter(2, 1000);
    limiter.allow(0);
    limiter.allow(1);
    assert.equal(limiter.allow(2), false);
    limiter.reset();
    assert.equal(limiter.allow(3), true);
    assert.equal(limiter.count(3), 1);
  });

  it("defaults `now` to the real clock when omitted", () => {
    const limiter = createSlidingWindowLimiter(1, 60_000);
    assert.equal(limiter.allow(), true);
    assert.equal(limiter.allow(), false);
  });
});

describe("BE-29 dedup: sentry/analytics reuse the shared limiter", () => {
  const read = (rel: string) =>
    readFileSync(path.join(process.cwd(), rel), "utf8");

  it("sentry.ts imports and uses createSlidingWindowLimiter (no inline window array)", () => {
    const src = read("lib/sentry.ts");
    assert.match(src, /createSlidingWindowLimiter/);
    assert.match(src, /rateLimiter\.allow/);
    assert.match(src, /rateLimiter\.reset\(\)/);
    // The old hand-rolled `recentEvents` array is gone.
    assert.doesNotMatch(src, /let recentEvents/);
  });

  it("analytics.ts imports and uses createSlidingWindowLimiter (no inline window array)", () => {
    const src = read("lib/analytics.ts");
    assert.match(src, /createSlidingWindowLimiter/);
    assert.match(src, /rateLimiter\.allow/);
    assert.match(src, /rateLimiter\.reset\(\)/);
    assert.doesNotMatch(src, /let recentEvents/);
  });
});

describe("BE-29 mutation path: supabase-profiles write throttle", () => {
  const src = readFileSync(
    path.join(process.cwd(), "lib/supabase-profiles.ts"),
    "utf8",
  );

  it("creates a write limiter from the shared factory", () => {
    assert.match(src, /import \{ createSlidingWindowLimiter \}/);
    assert.match(src, /writeRateLimiter = createSlidingWindowLimiter\(/);
  });

  it("throttles only write methods in supabaseRest, throwing RateLimitError", () => {
    assert.match(
      src,
      /WRITE_METHODS = new Set\(\["POST", "PATCH", "PUT", "DELETE"\]\)/,
    );
    assert.match(
      src,
      /if \(WRITE_METHODS\.has\(method\) && !writeRateLimiter\.allow\(\)\) \{\s*throw new RateLimitError\(\);/,
    );
    // The check runs before the network call so a throttled write never hits fetch.
    const guardIdx = src.indexOf("throw new RateLimitError()");
    const fetchIdx = src.indexOf("return fetchWithRetry(url");
    assert.ok(guardIdx > 0 && fetchIdx > guardIdx);
  });

  it("exports RateLimitError and a test reset hook", () => {
    assert.match(src, /export class RateLimitError extends Error/);
    assert.match(src, /export function __resetWriteRateLimitForTests/);
  });
});
