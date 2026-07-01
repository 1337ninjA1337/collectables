import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * Runtime proof that the preloaded global bootstrap
 * (`__tests__/test-globals.ts`, wired via `tsx --import` in package.json)
 * invokes `__resetSentryForTests` on the cached `lib/sentry.ts` module before
 * EVERY test — the behaviour that lets the sentry suites drop their per-file
 * `beforeEach(() => __resetSentryForTests())` duplicates without reintroducing
 * cross-suite cache leaks.
 *
 * The real `lib/sentry.ts` can't be imported here (it resolves
 * `@/lib/sentry-config`, unavailable under node-tests), so — exactly as the
 * bootstrap does — we operate on `require.cache` directly: seed a stand-in
 * module at the exact resolved path the bootstrap peeks and assert the reset
 * spy fires. `require.cache` is the process-global `Module._cache`, shared with
 * the bootstrap's own `createRequire`, and node:test isolates each file in its
 * own process, so this seed never leaks into another suite.
 */
const require = createRequire(import.meta.url);
const SENTRY_PATH = path.join(process.cwd(), "lib", "sentry.ts");

let resetCalls = 0;

// Executed at import time — before node:test runs any test in this file, and
// therefore before the root-scope global `beforeEach` fires for the first test.
require.cache[SENTRY_PATH] = {
  exports: {
    __resetSentryForTests: () => {
      resetCalls += 1;
    },
  },
} as unknown as NodeJS.Require["cache"][string];

describe("global bootstrap resets the cached sentry module", () => {
  it("fires __resetSentryForTests before the first test via the root beforeEach", () => {
    assert.ok(
      resetCalls >= 1,
      "the preloaded global beforeEach must invoke __resetSentryForTests when lib/sentry.ts is cached",
    );
  });

  it("fires again before the next test (reset runs before every test, not once)", () => {
    assert.ok(
      resetCalls >= 2,
      "the global beforeEach must reset the sentry cache before every test, not just the first",
    );
  });
});
