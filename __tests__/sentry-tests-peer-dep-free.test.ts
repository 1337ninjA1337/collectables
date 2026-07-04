import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * Crash #16 test-coverage guarantees the sentry test suite never depends on
 * `@sentry/react-native` being installed. Direct unit tests of `lib/sentry.ts`
 * inject a fake `loader: async () => sdk` instead of importing the real SDK,
 * so removing the dependency from `node_modules` does not break CI.
 *
 * This regression guard asserts that no `__tests__/sentry-*.test.ts` file
 * contains a static `import ... from "@sentry/react-native"` line. The
 * structural test of `lib/sentry.ts` (sentry-init.test.ts) already enforces
 * the same invariant on the source module.
 */

// Fail-closed glob: every __tests__/sentry-*.test.ts file is guarded
// automatically, so a new Sentry test can't be forgotten off a hand list.
const SENTRY_TEST_FILES = readdirSync(join(ROOT, "__tests__"))
  .filter((name) => /^sentry-.*\.test\.ts$/.test(name))
  .sort()
  .map((name) => `__tests__/${name}`);

describe("lint:peer-dep-free wiring", () => {
  it("package.json exposes a script that runs ONLY this test file", () => {
    const pkg = JSON.parse(read("package.json"));
    assert.equal(
      pkg.scripts["lint:peer-dep-free"],
      "tsx --test __tests__/sentry-tests-peer-dep-free.test.ts",
      "lint:peer-dep-free must run only this file so a pre-push hook can verify the SDK-isolation invariant in well under a second",
    );
  });
});

describe("SENTRY_TEST_FILES glob", () => {
  it("discovers the full sentry test surface (no hand-maintained list to forget)", () => {
    // 21 files at promotion time (2026-07-04) — the old hand list had 16,
    // silently leaving breadcrumb-level/doctor/lazy-import/report unguarded.
    assert.ok(
      SENTRY_TEST_FILES.length >= 21,
      `glob found only ${SENTRY_TEST_FILES.length} sentry test files — expected at least 21`,
    );
    for (const previouslyUnguarded of [
      "__tests__/sentry-breadcrumb-level.test.ts",
      "__tests__/sentry-doctor.test.ts",
      "__tests__/sentry-lazy-import.test.ts",
      "__tests__/sentry-report.test.ts",
    ]) {
      assert.ok(
        SENTRY_TEST_FILES.includes(previouslyUnguarded),
        `${previouslyUnguarded} must be picked up by the glob`,
      );
    }
  });
});

describe("Sentry test suite stays peer-dep free", () => {
  for (const rel of SENTRY_TEST_FILES) {
    it(`${rel} does not statically import @sentry/react-native`, () => {
      const src = read(rel);
      assert.doesNotMatch(
        src,
        /^\s*import[^;]*from\s+["']@sentry\/react-native["']/m,
        `${rel} must not statically import "@sentry/react-native" — use the loader-injection pattern from sentry-init.test.ts (or string-match on source files) so the test suite runs without the SDK installed`,
      );
    });
  }
});
