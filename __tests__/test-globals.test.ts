import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { initSentry, isSentryReady } from "../lib/sentry";

/**
 * Guards the global test bootstrap (`__tests__/test-globals.ts`, preloaded via
 * `--import` in `package.json`'s `test` script) that resets `lib/sentry.ts`'s
 * module-scope cache before every test. The Sentry suites no longer carry their
 * own `beforeEach(() => __resetSentryForTests())`; they rely entirely on this
 * global hook, so the wiring below is what keeps them isolated.
 */

const BOOT_OPTIONS = {
  env: {
    EXPO_PUBLIC_SENTRY_DSN: "https://x@o.ingest.sentry.io/1",
    EXPO_PUBLIC_SENTRY_ENV: "production" as const,
  },
  loader: async () => ({
    init: () => undefined,
    captureException: () => undefined,
    addBreadcrumb: () => undefined,
    setUser: () => undefined,
  }),
};

describe("test-globals — Sentry reset wiring (structural)", () => {
  const source = readFileSync(
    path.join(process.cwd(), "__tests__", "test-globals.ts"),
    "utf8",
  );

  it("statically imports the Sentry reset helper", () => {
    assert.match(
      source,
      /import\s*\{\s*__resetSentryForTests\s*\}\s*from\s*"\.\.\/lib\/sentry"/,
    );
  });

  it("invokes __resetSentryForTests inside a global beforeEach", () => {
    const hook = source.slice(source.indexOf("beforeEach("));
    assert.ok(
      hook.includes("__resetSentryForTests()"),
      "the global beforeEach must call __resetSentryForTests()",
    );
  });
});

describe("test-globals — Sentry state does not leak between tests", () => {
  // No local beforeEach: these tests depend solely on the global bootstrap.
  it("boots the SDK to a ready state", async () => {
    await initSentry(BOOT_OPTIONS);
    assert.equal(isSentryReady(), true);
  });

  it("starts the next test with a fresh (not-ready) SDK", () => {
    // If the global beforeEach did not run __resetSentryForTests(), the SDK
    // booted by the previous test would still be cached and this would fail.
    assert.equal(isSentryReady(), false);
  });
});
