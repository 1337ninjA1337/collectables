import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, beforeEach } from "node:test";

import {
  initAnalytics,
  trackEvent,
  identifyUser,
  resetUser,
  isAnalyticsReady,
  __resetAnalyticsForTests,
  type AnalyticsEventName,
} from "../lib/analytics";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

type Call = { method: string; args: unknown[] };

function makeFakeSdk() {
  const calls: Call[] = [];
  const sdk = {
    capture: (event: string, properties?: Record<string, unknown>) => {
      calls.push({ method: "capture", args: [event, properties] });
    },
    identify: (distinctId: string, traits?: Record<string, unknown>) => {
      calls.push({ method: "identify", args: [distinctId, traits] });
    },
    reset: () => {
      calls.push({ method: "reset", args: [] });
    },
  };
  return { sdk, calls };
}

describe("lib/analytics — disabled paths", () => {
  beforeEach(() => __resetAnalyticsForTests());

  it("trackEvent is a no-op before initAnalytics()", () => {
    trackEvent("signup_completed");
    assert.equal(isAnalyticsReady(), false);
  });

  it("identifyUser is a no-op before initAnalytics()", () => {
    identifyUser("user-1", { language: "en" });
    assert.equal(isAnalyticsReady(), false);
  });

  it("resetUser is a no-op before initAnalytics()", () => {
    resetUser();
    assert.equal(isAnalyticsReady(), false);
  });

  it("does not load the SDK when PostHog key is missing", async () => {
    let loaderCalls = 0;
    await initAnalytics({
      env: {},
      loader: async () => {
        loaderCalls += 1;
        return makeFakeSdk().sdk;
      },
    });
    assert.equal(loaderCalls, 0);
    assert.equal(isAnalyticsReady(), false);
  });

  it("does not load the SDK in development environment", async () => {
    let loaderCalls = 0;
    await initAnalytics({
      env: {
        EXPO_PUBLIC_POSTHOG_KEY: "phc_dev",
        EXPO_PUBLIC_ANALYTICS_ENV: "development",
      },
      loader: async () => {
        loaderCalls += 1;
        return makeFakeSdk().sdk;
      },
    });
    assert.equal(loaderCalls, 0);
    assert.equal(isAnalyticsReady(), false);
  });
});

describe("lib/analytics — enabled paths", () => {
  beforeEach(() => __resetAnalyticsForTests());

  it("initAnalytics() loads the SDK when key is present + env is production", async () => {
    const { sdk } = makeFakeSdk();
    let loaderCalls = 0;
    await initAnalytics({
      env: {
        EXPO_PUBLIC_POSTHOG_KEY: "phc_prod",
        EXPO_PUBLIC_ANALYTICS_ENV: "production",
      },
      loader: async () => {
        loaderCalls += 1;
        return sdk;
      },
    });
    assert.equal(loaderCalls, 1);
    assert.equal(isAnalyticsReady(), true);
  });

  it("trackEvent forwards event name + props to the SDK", async () => {
    const { sdk, calls } = makeFakeSdk();
    await initAnalytics({
      env: {
        EXPO_PUBLIC_POSTHOG_KEY: "phc_prod",
        EXPO_PUBLIC_ANALYTICS_ENV: "production",
      },
      loader: async () => sdk,
    });
    trackEvent("collection_created", { visibility: "public", isPremium: false });
    const last = calls[calls.length - 1];
    assert.equal(last.method, "capture");
    assert.equal(last.args[0], "collection_created");
    assert.deepEqual(last.args[1], { visibility: "public", isPremium: false });
  });

  it("identifyUser forwards user id + traits to the SDK", async () => {
    const { sdk, calls } = makeFakeSdk();
    await initAnalytics({
      env: {
        EXPO_PUBLIC_POSTHOG_KEY: "phc_prod",
        EXPO_PUBLIC_ANALYTICS_ENV: "production",
      },
      loader: async () => sdk,
    });
    identifyUser("user-42", { language: "en", isPremium: true });
    const last = calls[calls.length - 1];
    assert.equal(last.method, "identify");
    assert.equal(last.args[0], "user-42");
    assert.deepEqual(last.args[1], { language: "en", isPremium: true });
  });

  it("resetUser delegates to SDK.reset()", async () => {
    const { sdk, calls } = makeFakeSdk();
    await initAnalytics({
      env: {
        EXPO_PUBLIC_POSTHOG_KEY: "phc_prod",
        EXPO_PUBLIC_ANALYTICS_ENV: "production",
      },
      loader: async () => sdk,
    });
    resetUser();
    const last = calls[calls.length - 1];
    assert.equal(last.method, "reset");
  });

  it("survives a loader rejection by staying disabled", async () => {
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      await initAnalytics({
        env: {
          EXPO_PUBLIC_POSTHOG_KEY: "phc_prod",
          EXPO_PUBLIC_ANALYTICS_ENV: "production",
        },
        loader: async () => {
          throw new Error("native bridge missing");
        },
      });
      assert.equal(isAnalyticsReady(), false);
      // wrappers must still be safe no-ops
      trackEvent("signup_completed");
      identifyUser("u", { x: 1 });
      resetUser();
    } finally {
      console.warn = originalWarn;
    }
  });

  it("ignores duplicate initAnalytics() calls", async () => {
    let loaderCalls = 0;
    const { sdk } = makeFakeSdk();
    await initAnalytics({
      env: {
        EXPO_PUBLIC_POSTHOG_KEY: "phc_prod",
        EXPO_PUBLIC_ANALYTICS_ENV: "production",
      },
      loader: async () => {
        loaderCalls += 1;
        return sdk;
      },
    });
    await initAnalytics({
      env: {
        EXPO_PUBLIC_POSTHOG_KEY: "phc_prod",
        EXPO_PUBLIC_ANALYTICS_ENV: "production",
      },
      loader: async () => {
        loaderCalls += 1;
        return sdk;
      },
    });
    assert.equal(loaderCalls, 1);
  });

  it("trackEvent swallows SDK exceptions instead of rethrowing", async () => {
    const sdk: ReturnType<typeof makeFakeSdk>["sdk"] = {
      capture: () => {
        throw new Error("posthog crashed");
      },
      identify: () => {
        throw new Error("posthog crashed");
      },
      reset: () => {
        throw new Error("posthog crashed");
      },
    };
    await initAnalytics({
      env: {
        EXPO_PUBLIC_POSTHOG_KEY: "phc_prod",
        EXPO_PUBLIC_ANALYTICS_ENV: "production",
      },
      loader: async () => sdk,
    });
    assert.doesNotThrow(() => trackEvent("signup_completed"));
    assert.doesNotThrow(() => identifyUser("u"));
    assert.doesNotThrow(() => resetUser());
  });
});

describe("lib/analytics — typed event union", () => {
  it("AnalyticsEventName covers the 10 canonical events from the platform doc", () => {
    // Compile-time gate: each literal must satisfy AnalyticsEventName. If a
    // future refactor narrows the union, this assignment fails to type-check.
    const expected: AnalyticsEventName[] = [
      "signup_completed",
      "collection_created",
      "item_added",
      "item_photo_attached",
      "listing_created",
      "listing_claimed",
      "chat_opened",
      "friend_requested",
      "premium_activated",
      "language_switched",
    ];
    assert.equal(expected.length, 10);
    // Runtime sanity — each call site receives an AnalyticsEventName, so
    // verify the source declares all 10 names literally.
    const src = read("lib/analytics.ts");
    for (const name of expected) {
      assert.match(
        src,
        new RegExp(`"${name}"`),
        `lib/analytics.ts must declare "${name}" in the AnalyticsEventName union`,
      );
    }
  });
});

describe("lib/analytics — module shape", () => {
  it("does not import posthog-react-native at the top level", () => {
    const src = read("lib/analytics.ts");
    // Top-level static import would look like: import ... from "posthog-react-native";
    assert.doesNotMatch(
      src,
      /^\s*import[^;]*from\s+["']posthog-react-native["']/m,
      "lib/analytics.ts must lazy-import the SDK so test/dev bundles do not pay the cost",
    );
    // The dynamic `await import("posthog-react-native")` must still be present.
    assert.match(
      src,
      /import\(\s*["']posthog-react-native["']\s*\)/,
      "lib/analytics.ts must dynamically import the SDK inside the loader",
    );
  });

  it("does not import posthog-js at the top level either", () => {
    const src = read("lib/analytics.ts");
    assert.doesNotMatch(
      src,
      /^\s*import[^;]*from\s+["']posthog-js["']/m,
      "lib/analytics.ts must lazy-import any posthog SDK",
    );
  });

  it("guards every wrapper with both sdk and enabled checks", () => {
    const src = read("lib/analytics.ts");
    const guardCount = (src.match(/!sdk\s*\|\|\s*!activeConfig\?\.enabled/g) ?? [])
      .length;
    assert.ok(
      guardCount >= 3,
      "trackEvent + identifyUser + resetUser must each gate on (sdk && enabled)",
    );
  });

  it("exports the four required wrapper functions", () => {
    assert.equal(typeof initAnalytics, "function");
    assert.equal(typeof trackEvent, "function");
    assert.equal(typeof identifyUser, "function");
    assert.equal(typeof resetUser, "function");
  });
});
