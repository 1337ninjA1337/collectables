import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const SENTRY_TEST_FILES = [
  "__tests__/sentry-init.test.ts",
  "__tests__/sentry-rate-limit.test.ts",
  "__tests__/sentry-scrubber.test.ts",
  "__tests__/sentry-layout-wiring.test.ts",
  "__tests__/sentry-config.test.ts",
  "__tests__/sentry-env-docs.test.ts",
  "__tests__/sentry-env-inlining.test.ts",
  "__tests__/sentry-eas-config.test.ts",
  "__tests__/sentry-deploy-workflow.test.ts",
  "__tests__/sentry-capture-wiring.test.ts",
  "__tests__/sentry-user-context.test.ts",
  "__tests__/sentry-navigation-breadcrumbs.test.ts",
  "__tests__/sentry-fallback-i18n.test.ts",
  "__tests__/sentry-opt-out.test.ts",
  "__tests__/sentry-test-error.test.ts",
  "__tests__/sentry-privacy-policy.test.ts",
];

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
