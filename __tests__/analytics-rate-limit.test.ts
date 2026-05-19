import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  initAnalytics,
  trackEvent,
  __resetAnalyticsForTests,
  __resetAnalyticsRateLimitForTests,
} from "../lib/analytics";

type Call = { method: string; args: unknown[] };

function makeFakeSdk() {
  const calls: Call[] = [];
  const sdk = {
    capture: (event: string, properties?: Record<string, unknown>) => {
      calls.push({ method: "capture", args: [event, properties] });
    },
    identify: () => undefined,
    reset: () => undefined,
    shutdown: () => undefined,
  };
  return { sdk, calls };
}

function makeFakeCtor(sdkRef: ReturnType<typeof makeFakeSdk>) {
  const Ctor = function (this: unknown) {
    return sdkRef.sdk as unknown as object;
  } as unknown as new (apiKey: string, options?: unknown) => unknown;
  return { Ctor };
}

async function bootEnabled() {
  __resetAnalyticsForTests();
  const fake = makeFakeSdk();
  const { Ctor } = makeFakeCtor(fake);
  await initAnalytics({
    env: {
      EXPO_PUBLIC_POSTHOG_KEY: "phc_prod",
      EXPO_PUBLIC_ANALYTICS_ENV: "production",
    },
    loader: async () => Ctor as never,
  });
  return fake;
}

describe("Analytics #17 — trackEvent rate limiter", () => {
  beforeEach(() => __resetAnalyticsRateLimitForTests());

  it("forwards the first event", async () => {
    const { calls } = await bootEnabled();
    trackEvent("signup_completed");
    assert.equal(calls.length, 1);
  });

  it("allows up to 200 events per minute then drops the rest", async () => {
    const { calls } = await bootEnabled();
    for (let i = 0; i < 250; i += 1) {
      trackEvent("item_added", { i });
    }
    assert.equal(calls.length, 200, "rate limiter should cap at 200/min");
  });

  it("__resetAnalyticsRateLimitForTests clears the window", async () => {
    const { calls } = await bootEnabled();
    for (let i = 0; i < 200; i += 1) trackEvent("item_added", { i });
    trackEvent("item_added", { dropped: true });
    assert.equal(calls.length, 200);

    __resetAnalyticsRateLimitForTests();
    trackEvent("item_added", { afterReset: true });
    assert.equal(calls.length, 201);
  });

  it("__resetAnalyticsForTests also clears the rate-limit window", async () => {
    const first = await bootEnabled();
    for (let i = 0; i < 200; i += 1) trackEvent("item_added", { i });
    assert.equal(first.calls.length, 200);

    // bootEnabled() calls __resetAnalyticsForTests internally, so the next
    // window must start fresh rather than carrying the exhausted counter.
    const second = await bootEnabled();
    trackEvent("signup_completed");
    assert.equal(second.calls.length, 1);
  });
});
