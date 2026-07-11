import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  getAnalyticsStatus,
  initAnalytics,
  setAnalyticsOptOut,
  __resetAnalyticsForTests,
} from "../lib/analytics";

const ROOT = path.join(__dirname, "..");

function makeLoader() {
  const sdk = {
    capture: () => {},
    identify: () => {},
    reset: () => {},
  };
  return async () =>
    function (this: unknown) {
      return sdk as unknown as object;
    } as unknown as new (apiKey: string, options?: unknown) => never;
}

const PROD_ENV = {
  EXPO_PUBLIC_POSTHOG_KEY: "phc_test",
  EXPO_PUBLIC_ANALYTICS_ENV: "production",
};

describe("getAnalyticsStatus", () => {
  beforeEach(() => __resetAnalyticsForTests());

  it("reports not-initialised before initAnalytics()", () => {
    const status = getAnalyticsStatus();
    assert.equal(status.ready, false);
    assert.equal(status.initialised, false);
    assert.equal(status.keyPresent, false);
    assert.equal(status.environment, null);
    assert.equal(status.host, null);
    assert.equal(status.reason, "not-initialised");
  });

  it("reports ready with environment + host after a successful init", async () => {
    await initAnalytics({ env: PROD_ENV, loader: makeLoader() });
    const status = getAnalyticsStatus();
    assert.equal(status.ready, true);
    assert.equal(status.initialised, true);
    assert.equal(status.keyPresent, true);
    assert.equal(status.environment, "production");
    assert.equal(status.host, "https://eu.posthog.com");
    assert.equal(status.reason, "ready");
  });

  it("reports user-opted-out when the diagnostics toggle is off", async () => {
    setAnalyticsOptOut(true);
    await initAnalytics({ env: PROD_ENV, loader: makeLoader() });
    assert.equal(getAnalyticsStatus().reason, "user-opted-out");
    assert.equal(getAnalyticsStatus().optedOut, true);
  });

  it("reports missing-key when no PostHog key was inlined", async () => {
    await initAnalytics({ env: {}, loader: makeLoader() });
    const status = getAnalyticsStatus();
    assert.equal(status.keyPresent, false);
    assert.equal(status.reason, "missing-key");
  });

  it("reports development-env when the environment gate blocked init", async () => {
    await initAnalytics({
      env: { ...PROD_ENV, EXPO_PUBLIC_ANALYTICS_ENV: "development" },
      loader: makeLoader(),
    });
    assert.equal(getAnalyticsStatus().reason, "development-env");
  });

  it("reports kill-switch when EXPO_PUBLIC_ANALYTICS_DISABLED forced analytics off", async () => {
    await initAnalytics({
      env: { ...PROD_ENV, EXPO_PUBLIC_ANALYTICS_DISABLED: "1" },
      loader: makeLoader(),
    });
    assert.equal(getAnalyticsStatus().reason, "kill-switch");
  });

  it("reports init-failed when the SDK loader throws", async () => {
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      await initAnalytics({
        env: PROD_ENV,
        loader: async () => {
          throw new Error("bridge missing");
        },
      });
    } finally {
      console.warn = originalWarn;
    }
    const status = getAnalyticsStatus();
    assert.equal(status.initialised, true);
    assert.equal(status.ready, false);
    assert.equal(status.reason, "init-failed");
  });

  it("is registered as a devtools global in app/_layout.tsx", () => {
    const layoutSrc = readFileSync(path.join(ROOT, "app/_layout.tsx"), "utf8");
    assert.match(layoutSrc, /scope\.__analyticsStatus = getAnalyticsStatus/);
    assert.match(layoutSrc, /import \{[^}]*\bgetAnalyticsStatus\b[^}]*\} from "@\/lib\/analytics"/);
  });
});
