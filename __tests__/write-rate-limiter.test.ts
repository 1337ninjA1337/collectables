import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// `lib/write-rate-limiter.ts` imports `lib/env.ts`, which imports react-native
// (`Platform`) at module scope, so it can't be imported in the node test runner.
// The limiter mechanics it relies on are covered by behavioural tests
// (`sliding-window-limiter.test.ts`, `sync-engine-rate-limit.test.ts`); this
// file structurally guards the BE-29 wiring, mirroring `env-resolve-numeric` /
// `viewer-profile-ttl`.
function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("BE-29 shared write rate limiter (lib/write-rate-limiter.ts)", () => {
  const src = read("lib/write-rate-limiter.ts");

  it("builds the shared limiter from the extracted factory", () => {
    assert.match(
      src,
      /createSlidingWindowLimiter\(\{[\s\S]*windowMs: WRITE_RATE_LIMIT_WINDOW_MS[\s\S]*max: writeRateLimitPerMinute/,
    );
    assert.match(src, /export const writeRateLimiter/);
  });

  it("defaults to 600 writes per 60s window", () => {
    assert.match(src, /WRITE_RATE_LIMIT_WINDOW_MS = 60_000/);
    assert.match(src, /DEFAULT_WRITE_RATE_LIMIT_PER_MIN = 600/);
  });

  it("reads the cap from a literal EXPO_PUBLIC env via resolveNumericEnv", () => {
    // Metro/babel only inline a *literal* `process.env.X` member access, so the
    // env name must appear verbatim, not via a computed lookup.
    assert.match(
      src,
      /resolveNumericEnv\(\s*process\.env\.EXPO_PUBLIC_WRITE_RATE_LIMIT_PER_MIN,\s*DEFAULT_WRITE_RATE_LIMIT_PER_MIN,?\s*\)/,
    );
  });

  it("exposes a test reset so a saturated window doesn't leak across suites", () => {
    assert.match(
      src,
      /export function __resetWriteRateLimiterForTests\(\): void \{\s*writeRateLimiter\.reset\(\);/,
    );
  });
});

describe("BE-29 write limiter is wired into every mutation flush", () => {
  it("collections/items upserts pass the shared limiter", () => {
    const src = read("lib/collections-context.tsx");
    assert.match(src, /from "@\/lib\/write-rate-limiter"/);
    // Both the collections and items flush calls hand the limiter to the engine.
    const matches = src.match(/writeRateLimiter,/g) ?? [];
    assert.ok(matches.length >= 2, "expected both upsert flushes to be gated");
  });

  it("chat sends pass the shared limiter", () => {
    const src = read("lib/chat-context.tsx");
    assert.match(src, /from "@\/lib\/write-rate-limiter"/);
    assert.match(src, /limiter: writeRateLimiter/);
  });

  it("social writes pass the shared limiter", () => {
    const src = read("lib/social-context.tsx");
    assert.match(src, /from "@\/lib\/write-rate-limiter"/);
    assert.match(src, /flushPendingSocial\([^)]*writeRateLimiter\)/);
  });
});
