import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural guard for the global test bootstrap shipped in
 * `__tests__/test-globals.ts`.
 *
 * `lib/supabase-realtime.ts` exports `__resetSharedRealtimeClientForTests`
 * but every realtime test today is structural (the module itself can't run
 * under node-tests because it pulls in react-native peers via `@/lib/supabase`).
 * The cached `sharedRealtimeClient` is therefore an in-flight cross-test
 * contamination footgun the moment a future test mocks those peers and
 * constructs the client directly.
 *
 * The fix is a global `beforeEach` preloaded into the test runner via
 * `tsx --import`. The bootstrap can't statically import the reset helper
 * (same react-native issue), so it pulls it via `require.cache` if a
 * downstream test has already loaded the module — silent no-op otherwise.
 *
 * These tests pin the contract:
 *  - `package.json` wires the preload via `tsx --import`.
 *  - `__tests__/test-globals.ts` registers a root-level `beforeEach`.
 *  - The beforeEach uses the cache-lookup pattern (no static import that
 *    would fail at preload time under node-tests).
 */

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("test-globals bootstrap (package.json wiring)", () => {
  const pkg = JSON.parse(read("package.json")) as { scripts: { test: string } };

  it("the test script preloads __tests__/test-globals.ts via --import", () => {
    assert.match(
      pkg.scripts.test,
      /--import\s+\.\/__tests__\/test-globals\.ts/,
      "package.json `test` script must pass --import ./__tests__/test-globals.ts so the global beforeEach runs before every test file",
    );
  });
});

describe("test-globals bootstrap (file contract)", () => {
  const src = read("__tests__/test-globals.ts");

  it("imports beforeEach from node:test", () => {
    assert.match(src, /import\s*\{\s*beforeEach\s*\}\s*from\s*"node:test"/);
  });

  it("registers a root-level beforeEach (not nested inside a describe/test)", () => {
    // A nested beforeEach would only apply to that suite. The preload pattern
    // requires the registration at module top-level so node:test's root
    // context picks it up.
    assert.match(src, /\nbeforeEach\(/);
  });

  it("does NOT statically import the realtime module (would crash under tsx --test)", () => {
    // `@/lib/supabase-realtime` pulls in `@/lib/supabase` which pulls in
    // react-native; a static import here would crash every test file at
    // preload time. The contract is `require.cache` lookup — silent no-op
    // when the module hasn't been loaded by a downstream test.
    assert.doesNotMatch(
      src,
      /import\s*\{[^}]*__resetSharedRealtimeClientForTests[^}]*\}\s*from/,
    );
    assert.doesNotMatch(src, /from\s*"@\/lib\/supabase-realtime"/);
  });

  it("looks up the realtime module via require.cache and invokes the reset when present", () => {
    assert.match(src, /createRequire/);
    assert.match(src, /require\.cache/);
    // The cache key is the resolved absolute path; the bootstrap derives it
    // from process.cwd() so it works in any working directory CI uses.
    assert.match(src, /supabase-realtime\.ts/);
    assert.match(src, /__resetSharedRealtimeClientForTests/);
  });

  it("guards the lookup so a missing cache entry is a silent no-op", () => {
    // The bootstrap must not throw when the realtime module hasn't been
    // imported by any test — otherwise it would break every structural test
    // that doesn't touch realtime.
    assert.match(src, /typeof\s+reset\s*===\s*"function"/);
  });
});
