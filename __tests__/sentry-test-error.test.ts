import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  initSentry,
  triggerSentryTestError,
  __resetSentryForTests,
  __resetSentryRateLimitForTests,
} from "../lib/sentry";

type Call = { method: string; args: unknown[] };

function makeFakeSdk() {
  const calls: Call[] = [];
  return {
    sdk: {
      init: () => undefined,
      captureException: (err: unknown, ctx?: unknown) => {
        calls.push({ method: "captureException", args: [err, ctx] });
      },
      addBreadcrumb: () => undefined,
      setUser: () => undefined,
    },
    calls,
  };
}

describe("triggerSentryTestError", () => {
  beforeEach(() => {
    __resetSentryForTests();
    __resetSentryRateLimitForTests();
  });

  it("returns 'not-ready' before initSentry()", () => {
    assert.equal(triggerSentryTestError(), "not-ready");
  });

  it("returns 'not-ready' when SDK is disabled (development env)", async () => {
    const { sdk } = makeFakeSdk();
    await initSentry({
      env: {
        EXPO_PUBLIC_SENTRY_DSN: "https://x@o.ingest.sentry.io/1",
        EXPO_PUBLIC_SENTRY_ENV: "development",
      },
      loader: async () => sdk,
    });
    assert.equal(triggerSentryTestError(), "not-ready");
  });

  it("returns 'captured' and forwards the test error when enabled", async () => {
    const { sdk, calls } = makeFakeSdk();
    await initSentry({
      env: {
        EXPO_PUBLIC_SENTRY_DSN: "https://x@o.ingest.sentry.io/1",
        EXPO_PUBLIC_SENTRY_ENV: "production",
      },
      loader: async () => sdk,
    });
    const result = triggerSentryTestError("custom probe");
    assert.equal(result, "captured");
    const last = calls[calls.length - 1];
    assert.equal(last.method, "captureException");
    const [err, ctx] = last.args as [Error, { extra?: Record<string, unknown> }];
    assert.equal(err.message, "custom probe");
    assert.equal(ctx?.extra?.context, "sentry.smokeTest");
    assert.match(String(ctx?.extra?.triggeredAt), /\d{4}-\d{2}-\d{2}T/);
  });

  it("uses 'Sentry smoke test' as the default message", async () => {
    const { sdk, calls } = makeFakeSdk();
    await initSentry({
      env: {
        EXPO_PUBLIC_SENTRY_DSN: "https://x@o.ingest.sentry.io/1",
        EXPO_PUBLIC_SENTRY_ENV: "production",
      },
      loader: async () => sdk,
    });
    triggerSentryTestError();
    const last = calls[calls.length - 1];
    assert.equal((last.args[0] as Error).message, "Sentry smoke test");
  });

  it("returns 'rate-limited' when the per-minute cap is exhausted", async () => {
    const { sdk } = makeFakeSdk();
    await initSentry({
      env: {
        EXPO_PUBLIC_SENTRY_DSN: "https://x@o.ingest.sentry.io/1",
        EXPO_PUBLIC_SENTRY_ENV: "production",
      },
      loader: async () => sdk,
    });
    for (let i = 0; i < 50; i += 1) triggerSentryTestError(`burst ${i}`);
    assert.equal(triggerSentryTestError("dropped"), "rate-limited");
  });
});

describe("Crash #11/#12 — _layout.tsx exposes the test helper globally", () => {
  const layoutSrc = readFileSync(
    path.join(process.cwd(), "app", "_layout.tsx"),
    "utf8",
  );

  it("imports triggerSentryTestError", () => {
    assert.match(
      layoutSrc,
      /import\s*\{\s*initSentry,\s*triggerSentryTestError\s*\}/,
    );
  });

  it("registers __sendSentryTestError on globalThis", () => {
    assert.match(
      layoutSrc,
      /__sendSentryTestError\s*=\s*triggerSentryTestError/,
    );
  });
});
