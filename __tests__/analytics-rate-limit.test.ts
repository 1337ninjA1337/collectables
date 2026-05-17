import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  __resetAnalyticsForTests,
  __resetAnalyticsRateLimitForTests,
  initAnalytics,
  trackEvent,
} from "../lib/analytics";

/**
 * Analytics #17 — trackEvent rate limiter. Mirrors the Sentry limiter
 * (Crash #11, `__tests__/sentry-rate-limit.test.ts`) with the higher
 * 200-events/min cap appropriate for product analytics.
 */

function makeFakeCtor() {
  const calls: { event: string; props?: unknown }[] = [];
  class FakePostHog {
    constructor(_apiKey: string, _opts?: unknown) {}
    capture(event: string, props?: unknown) {
      calls.push({ event, props });
    }
    identify() {}
    reset() {}
    shutdown() {}
  }
  return { Ctor: FakePostHog, calls };
}

async function bootEnabled() {
  __resetAnalyticsForTests();
  const fake = makeFakeCtor();
  await initAnalytics({
    env: {
      EXPO_PUBLIC_POSTHOG_KEY: "phc_test_key",
      EXPO_PUBLIC_ANALYTICS_ENV: "production",
    },
    loader: async () => fake.Ctor as never,
  });
  return fake;
}

describe("Analytics #17 — trackEvent rate limiter", () => {
  beforeEach(() => __resetAnalyticsRateLimitForTests());

  it("forwards the first event", async () => {
    const { calls } = await bootEnabled();
    trackEvent("item_added", { collectionId: "c1", hasPhoto: false });
    assert.equal(calls.length, 1);
  });

  it("allows up to 200 events per minute then drops the rest", async () => {
    const { calls } = await bootEnabled();
    for (let i = 0; i < 250; i += 1) {
      trackEvent("item_added", { collectionId: `c${i}`, hasPhoto: false });
    }
    assert.equal(calls.length, 200, "rate limiter should cap at 200/min");
  });

  it("__resetAnalyticsRateLimitForTests clears the window", async () => {
    const { calls } = await bootEnabled();
    for (let i = 0; i < 200; i += 1) {
      trackEvent("item_added", { collectionId: `f${i}`, hasPhoto: false });
    }
    trackEvent("item_added", { collectionId: "dropped", hasPhoto: false });
    assert.equal(calls.length, 200);

    __resetAnalyticsRateLimitForTests();
    trackEvent("item_added", { collectionId: "after-reset", hasPhoto: false });
    assert.equal(calls.length, 201);
  });

  it("__resetAnalyticsForTests also clears the rate-limit window", async () => {
    const first = await bootEnabled();
    for (let i = 0; i < 200; i += 1) {
      trackEvent("item_added", { collectionId: `g${i}`, hasPhoto: false });
    }
    assert.equal(first.calls.length, 200);
    // A full reset (re-boot) must not stay rate-limited from the prior run.
    const second = await bootEnabled();
    trackEvent("item_added", { collectionId: "fresh", hasPhoto: false });
    assert.equal(second.calls.length, 1);
  });
});
