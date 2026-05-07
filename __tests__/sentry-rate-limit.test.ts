import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  initSentry,
  captureException,
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

async function bootEnabled() {
  __resetSentryForTests();
  const fake = makeFakeSdk();
  await initSentry({
    env: {
      EXPO_PUBLIC_SENTRY_DSN: "https://x@o.ingest.sentry.io/1",
      EXPO_PUBLIC_SENTRY_ENV: "production",
    },
    loader: async () => fake.sdk,
  });
  return fake;
}

describe("Crash #11 — captureException rate limiter", () => {
  beforeEach(() => __resetSentryRateLimitForTests());

  it("forwards the first event", async () => {
    const { calls } = await bootEnabled();
    captureException(new Error("first"));
    assert.equal(calls.length, 1);
  });

  it("allows up to 50 events per minute then drops the rest", async () => {
    const { calls } = await bootEnabled();
    for (let i = 0; i < 60; i += 1) {
      captureException(new Error(`burst ${i}`));
    }
    assert.equal(calls.length, 50, "rate limiter should cap at 50/min");
  });

  it("__resetSentryRateLimitForTests clears the window", async () => {
    const { calls } = await bootEnabled();
    for (let i = 0; i < 50; i += 1) captureException(new Error(`fill ${i}`));
    captureException(new Error("dropped"));
    assert.equal(calls.length, 50);

    __resetSentryRateLimitForTests();
    captureException(new Error("after reset"));
    assert.equal(calls.length, 51);
  });
});
