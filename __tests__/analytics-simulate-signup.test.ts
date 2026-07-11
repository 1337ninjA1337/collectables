import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  initAnalytics,
  setAnalyticsOptOut,
  simulateSignupEvent,
  __resetAnalyticsForTests,
} from "../lib/analytics";
import { ANALYTICS_EVENTS } from "../lib/analytics-events";

async function initWithFakeSdk() {
  const calls: { method: string; args: unknown[] }[] = [];
  const sdk = {
    capture: (...args: unknown[]) => void calls.push({ method: "capture", args }),
    identify: (...args: unknown[]) =>
      void calls.push({ method: "identify", args }),
    reset: (...args: unknown[]) => void calls.push({ method: "reset", args }),
  };
  const Ctor = function () {
    return sdk;
  } as unknown as new (key: string, opts?: unknown) => typeof sdk;
  await initAnalytics({
    env: {
      EXPO_PUBLIC_POSTHOG_KEY: "phc_test",
      EXPO_PUBLIC_ANALYTICS_ENV: "production",
    },
    loader: async () => Ctor as never,
  });
  return calls;
}

describe("simulateSignupEvent — dev smoke test for the PostHog wire", () => {
  beforeEach(() => {
    __resetAnalyticsForTests();
  });

  it("captures signup_completed with method: manual_test and reports ready", async () => {
    const calls = await initWithFakeSdk();
    const status = simulateSignupEvent();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "capture");
    assert.deepEqual(calls[0].args, [
      "signup_completed",
      { method: "manual_test" },
    ]);
    assert.equal(status.ready, true);
    assert.equal(status.reason, "ready");
  });

  it("uses only prop keys the signup_completed registry entry allows", () => {
    // If "method" ever left the registry, assertValidProps would strip it in
    // production and the synthetic event would silently lose its marker.
    assert.ok(ANALYTICS_EVENTS.signup_completed.props.includes("method"));
  });

  it("still honours the opt-out gate — no capture, status says why", async () => {
    const calls = await initWithFakeSdk();
    setAnalyticsOptOut(true);
    const status = simulateSignupEvent();
    assert.equal(calls.length, 0);
    assert.equal(status.ready, false);
    assert.equal(status.reason, "user-opted-out");
  });

  it("no-ops safely before init and reports not-initialised", () => {
    const status = simulateSignupEvent();
    assert.equal(status.ready, false);
    assert.equal(status.reason, "not-initialised");
  });
});

describe("app/_layout.tsx ↔ simulateSignupEvent wiring", () => {
  const layoutSrc = readFileSync(
    path.join(process.cwd(), "app", "_layout.tsx"),
    "utf8",
  );

  it("imports simulateSignupEvent from @/lib/analytics", () => {
    assert.match(
      layoutSrc,
      /import\s*\{[^}]*\bsimulateSignupEvent\b[^}]*\}\s*from\s*["']@\/lib\/analytics["']/,
      "must consume the helper through lib/analytics, not re-roll trackEvent inline",
    );
  });

  it("registers it as a { label, run } dev-menu action (dev-gated global)", () => {
    // The registerDevMenu actions map attaches globalThis.__simulateSignupEvent
    // for free, and the surrounding effect early-returns unless
    // isDevEnvironment() — that guard is pinned by dev-menu-wiring.test.ts.
    assert.match(
      layoutSrc,
      /simulateSignupEvent\s*:\s*\{\s*label\s*:\s*"Simulate signup event"[\s\S]*?run\s*:\s*simulateSignupEvent\s*,?\s*\}/,
      "actions map must include the simulateSignupEvent action",
    );
  });

  it("does NOT attach the global unconditionally beside __sentryStatus", () => {
    // The always-on devtools effect registers __sendSentryTestError /
    // __sentryStatus / __analyticsStatus; the signup simulator must NOT join
    // them — it fires a real event, so it stays behind the __DEV__ gate.
    const alwaysOnEffect = layoutSrc.slice(
      layoutSrc.indexOf("scope.__sendSentryTestError"),
      layoutSrc.indexOf("isDevEnvironment()"),
    );
    assert.ok(alwaysOnEffect.length > 0, "expected both effects in the layout");
    assert.ok(
      !alwaysOnEffect.includes("simulateSignupEvent"),
      "simulateSignupEvent must only be registered via the dev-gated registerDevMenu call",
    );
  });
});
