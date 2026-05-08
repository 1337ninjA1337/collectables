import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  initAnalytics,
  trackEvent,
  identifyUser,
  resetUser,
  isAnalyticsReady,
  setAnalyticsOptOut,
  isAnalyticsOptedOut,
  shutdownAnalytics,
  __resetAnalyticsForTests,
  type AnalyticsEventName,
} from "../lib/analytics";

type Call = { method: string; args: unknown[] };

function makeFakeSdk() {
  const calls: Call[] = [];
  const sdk = {
    capture: (event: string, properties?: Record<string, unknown>) => {
      calls.push({ method: "capture", args: [event, properties] });
    },
    identify: (userId: string, traits?: Record<string, unknown>) => {
      calls.push({ method: "identify", args: [userId, traits] });
    },
    reset: () => {
      calls.push({ method: "reset", args: [] });
    },
    shutdown: () => {
      calls.push({ method: "shutdown", args: [] });
    },
  };
  return { sdk, calls };
}

function makeFakeCtor(sdkRef: ReturnType<typeof makeFakeSdk>) {
  const ctorCalls: { apiKey: string; options: unknown }[] = [];
  const Ctor = function (this: unknown, apiKey: string, options?: unknown) {
    ctorCalls.push({ apiKey, options });
    return sdkRef.sdk as unknown as object;
  } as unknown as new (apiKey: string, options?: unknown) => unknown;
  return { Ctor, ctorCalls };
}

const ROOT = path.join(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("lib/analytics — disabled paths", () => {
  beforeEach(() => __resetAnalyticsForTests());

  it("trackEvent is a no-op before initAnalytics()", () => {
    trackEvent("signup_completed");
    assert.equal(isAnalyticsReady(), false);
  });

  it("identifyUser / resetUser are no-ops before initAnalytics()", () => {
    identifyUser("user-1", { language: "en" });
    resetUser();
    assert.equal(isAnalyticsReady(), false);
  });

  it("does not load the SDK when PostHog key is missing", async () => {
    let loaderCalls = 0;
    await initAnalytics({
      env: {},
      loader: async () => {
        loaderCalls += 1;
        const fake = makeFakeSdk();
        return makeFakeCtor(fake).Ctor as never;
      },
    });
    assert.equal(loaderCalls, 0);
    assert.equal(isAnalyticsReady(), false);
  });

  it("does not load the SDK when ANALYTICS_ENV is development", async () => {
    let loaderCalls = 0;
    await initAnalytics({
      env: {
        EXPO_PUBLIC_POSTHOG_KEY: "phc_dev",
        EXPO_PUBLIC_ANALYTICS_ENV: "development",
      },
      loader: async () => {
        loaderCalls += 1;
        const fake = makeFakeSdk();
        return makeFakeCtor(fake).Ctor as never;
      },
    });
    assert.equal(loaderCalls, 0);
    assert.equal(isAnalyticsReady(), false);
  });

  it("respects the user opt-out flag", async () => {
    setAnalyticsOptOut(true);
    assert.equal(isAnalyticsOptedOut(), true);
    let loaderCalls = 0;
    await initAnalytics({
      env: {
        EXPO_PUBLIC_POSTHOG_KEY: "phc_prod",
        EXPO_PUBLIC_ANALYTICS_ENV: "production",
      },
      loader: async () => {
        loaderCalls += 1;
        const fake = makeFakeSdk();
        return makeFakeCtor(fake).Ctor as never;
      },
    });
    assert.equal(loaderCalls, 0);
    assert.equal(isAnalyticsReady(), false);
  });
});

describe("lib/analytics — enabled paths", () => {
  beforeEach(() => __resetAnalyticsForTests());

  it("initAnalytics() instantiates the SDK with the resolved config", async () => {
    const fake = makeFakeSdk();
    const { Ctor, ctorCalls } = makeFakeCtor(fake);
    await initAnalytics({
      env: {
        EXPO_PUBLIC_POSTHOG_KEY: "phc_abc",
        EXPO_PUBLIC_ANALYTICS_ENV: "production",
        EXPO_PUBLIC_POSTHOG_HOST: "https://eu.posthog.com",
      },
      loader: async () => Ctor as never,
    });
    assert.equal(isAnalyticsReady(), true);
    assert.equal(ctorCalls.length, 1);
    assert.equal(ctorCalls[0].apiKey, "phc_abc");
    const opts = ctorCalls[0].options as Record<string, unknown>;
    assert.equal(opts.host, "https://eu.posthog.com");
  });

  it("trackEvent forwards name + props to capture()", async () => {
    const fake = makeFakeSdk();
    const { Ctor } = makeFakeCtor(fake);
    await initAnalytics({
      env: {
        EXPO_PUBLIC_POSTHOG_KEY: "phc",
        EXPO_PUBLIC_ANALYTICS_ENV: "production",
      },
      loader: async () => Ctor as never,
    });
    trackEvent("collection_created", { visibility: "public", isPremium: false });
    const last = fake.calls[fake.calls.length - 1];
    assert.equal(last.method, "capture");
    assert.equal(last.args[0], "collection_created");
    assert.deepEqual(last.args[1], { visibility: "public", isPremium: false });
  });

  it("trackEvent without props forwards undefined", async () => {
    const fake = makeFakeSdk();
    const { Ctor } = makeFakeCtor(fake);
    await initAnalytics({
      env: {
        EXPO_PUBLIC_POSTHOG_KEY: "phc",
        EXPO_PUBLIC_ANALYTICS_ENV: "production",
      },
      loader: async () => Ctor as never,
    });
    trackEvent("signup_completed");
    const last = fake.calls[fake.calls.length - 1];
    assert.equal(last.method, "capture");
    assert.equal(last.args[0], "signup_completed");
    assert.equal(last.args[1], undefined);
  });

  it("identifyUser forwards userId + traits", async () => {
    const fake = makeFakeSdk();
    const { Ctor } = makeFakeCtor(fake);
    await initAnalytics({
      env: {
        EXPO_PUBLIC_POSTHOG_KEY: "phc",
        EXPO_PUBLIC_ANALYTICS_ENV: "production",
      },
      loader: async () => Ctor as never,
    });
    identifyUser("user-42", { language: "ru", isPremium: true });
    const last = fake.calls[fake.calls.length - 1];
    assert.equal(last.method, "identify");
    assert.equal(last.args[0], "user-42");
    assert.deepEqual(last.args[1], { language: "ru", isPremium: true });
  });

  it("resetUser triggers reset() on the SDK", async () => {
    const fake = makeFakeSdk();
    const { Ctor } = makeFakeCtor(fake);
    await initAnalytics({
      env: {
        EXPO_PUBLIC_POSTHOG_KEY: "phc",
        EXPO_PUBLIC_ANALYTICS_ENV: "production",
      },
      loader: async () => Ctor as never,
    });
    resetUser();
    const last = fake.calls[fake.calls.length - 1];
    assert.equal(last.method, "reset");
  });

  it("survives a loader rejection by staying disabled", async () => {
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      await initAnalytics({
        env: {
          EXPO_PUBLIC_POSTHOG_KEY: "phc",
          EXPO_PUBLIC_ANALYTICS_ENV: "production",
        },
        loader: async () => {
          throw new Error("native bridge missing");
        },
      });
      assert.equal(isAnalyticsReady(), false);
      // wrappers must still be safe no-ops
      trackEvent("signup_completed");
      identifyUser("user-1");
      resetUser();
    } finally {
      console.warn = originalWarn;
    }
  });

  it("ignores duplicate initAnalytics() calls", async () => {
    const fake = makeFakeSdk();
    const { Ctor, ctorCalls } = makeFakeCtor(fake);
    await initAnalytics({
      env: {
        EXPO_PUBLIC_POSTHOG_KEY: "phc",
        EXPO_PUBLIC_ANALYTICS_ENV: "production",
      },
      loader: async () => Ctor as never,
    });
    await initAnalytics({
      env: {
        EXPO_PUBLIC_POSTHOG_KEY: "phc",
        EXPO_PUBLIC_ANALYTICS_ENV: "production",
      },
      loader: async () => Ctor as never,
    });
    assert.equal(ctorCalls.length, 1);
  });

  it("trackEvent swallows SDK exceptions instead of rethrowing", async () => {
    const Ctor = function () {
      return {
        capture: () => {
          throw new Error("sdk crashed");
        },
        identify: () => undefined,
        reset: () => undefined,
      };
    } as unknown as new () => unknown;
    await initAnalytics({
      env: {
        EXPO_PUBLIC_POSTHOG_KEY: "phc",
        EXPO_PUBLIC_ANALYTICS_ENV: "production",
      },
      loader: async () => Ctor as never,
    });
    assert.doesNotThrow(() => trackEvent("signup_completed"));
    assert.doesNotThrow(() => identifyUser("u"));
    assert.doesNotThrow(() => resetUser());
  });

  it("shutdownAnalytics calls SDK shutdown and clears state", async () => {
    const fake = makeFakeSdk();
    const { Ctor } = makeFakeCtor(fake);
    await initAnalytics({
      env: {
        EXPO_PUBLIC_POSTHOG_KEY: "phc",
        EXPO_PUBLIC_ANALYTICS_ENV: "production",
      },
      loader: async () => Ctor as never,
    });
    assert.equal(isAnalyticsReady(), true);
    shutdownAnalytics();
    assert.equal(isAnalyticsReady(), false);
    const last = fake.calls[fake.calls.length - 1];
    assert.equal(last.method, "shutdown");
  });
});

describe("lib/analytics — module shape", () => {
  it("does not import posthog-react-native at the top level", () => {
    const src = read("lib/analytics.ts");
    assert.doesNotMatch(
      src,
      /^\s*import[^;]*from\s+["']posthog-react-native["']/m,
      "lib/analytics.ts must lazy-import the SDK so test/dev bundles do not pay the cost",
    );
    assert.match(
      src,
      /import\(\s*["']posthog-react-native["']\s*\)/,
      "lib/analytics.ts must dynamically import the SDK inside initAnalytics()",
    );
  });

  it("guards every wrapper with both sdk and enabled checks", () => {
    const src = read("lib/analytics.ts");
    const guardCount = (
      src.match(/!sdk\s*\|\|\s*!activeConfig\?\.enabled/g) ?? []
    ).length;
    assert.ok(
      guardCount >= 3,
      "trackEvent + identifyUser + resetUser must each gate on (sdk && enabled)",
    );
  });

  it("uses readAnalyticsEnvFromProcess (not process.env whole) so Metro inlines values", () => {
    const src = read("lib/analytics.ts");
    assert.match(
      src,
      /readAnalyticsEnvFromProcess\(\)/,
      "initAnalytics must read env via readAnalyticsEnvFromProcess()",
    );
    assert.doesNotMatch(
      src,
      /resolveAnalyticsConfig\(\s*process\.env\b/,
      "Do not pass process.env whole — values won't be inlined by babel",
    );
  });

  it("AnalyticsEventName covers the taxonomy required by Analytics #4..#10", () => {
    const required: AnalyticsEventName[] = [
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
    const src = read("lib/analytics.ts");
    for (const name of required) {
      assert.match(
        src,
        new RegExp(`["']${name}["']`),
        `AnalyticsEventName must include "${name}"`,
      );
    }
  });

  it("trackEvent signature rejects unknown event names at compile time", () => {
    const src = read("lib/analytics.ts");
    assert.match(
      src,
      /name:\s*AnalyticsEventName/,
      "trackEvent must accept the typed AnalyticsEventName union",
    );
  });
});
