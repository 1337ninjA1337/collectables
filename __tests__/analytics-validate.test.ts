import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  assertValidProps,
  splitUnknownProps,
  __resetAnalyticsValidateForTests,
} from "../lib/analytics-validate";
import {
  initAnalytics,
  trackEvent,
  __resetAnalyticsForTests,
} from "../lib/analytics";

type DevGlobal = { __DEV__?: boolean };

function withCapturedWarns<T>(fn: () => T): { result: T; warns: string[] } {
  const warns: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warns.push(args.map(String).join(" "));
  };
  try {
    return { result: fn(), warns };
  } finally {
    console.warn = original;
  }
}

describe("splitUnknownProps", () => {
  it("passes an undefined payload straight through", () => {
    const { allowed, unknown } = splitUnknownProps("collection_created", undefined);
    assert.equal(allowed, undefined);
    assert.deepEqual(unknown, []);
  });

  it("returns the same object when every key is declared", () => {
    const payload = { visibility: "public", isPremium: false };
    const { allowed, unknown } = splitUnknownProps("collection_created", payload);
    assert.equal(allowed, payload);
    assert.deepEqual(unknown, []);
  });

  it("partitions unknown keys out, sorted", () => {
    const { allowed, unknown } = splitUnknownProps("collection_created", {
      visibility: "public",
      zTypo: 1,
      aTypo: 2,
    });
    assert.deepEqual(allowed, { visibility: "public" });
    assert.deepEqual(unknown, ["aTypo", "zTypo"]);
  });

  it("treats every key as unknown for a name missing from the registry", () => {
    const { allowed, unknown } = splitUnknownProps(
      "not_a_real_event" as never,
      { anything: 1 },
    );
    assert.deepEqual(allowed, {});
    assert.deepEqual(unknown, ["anything"]);
  });
});

describe("assertValidProps", () => {
  beforeEach(() => __resetAnalyticsValidateForTests());

  it("returns a fully-declared payload unchanged without warning", () => {
    const payload = { mode: "sale", hasPrice: true };
    const { result, warns } = withCapturedWarns(() =>
      assertValidProps("listing_created", payload),
    );
    assert.equal(result, payload);
    assert.deepEqual(warns, []);
  });

  it("throws on unknown keys when failFast is set", () => {
    assert.throws(
      () =>
        assertValidProps(
          "listing_created",
          { mode: "sale", pirce: 10 },
          { failFast: true },
        ),
      /listing_created.*pirce/s,
    );
  });

  it("defaults failFast to the __DEV__ global", () => {
    const g = globalThis as DevGlobal;
    g.__DEV__ = true;
    try {
      assert.throws(() =>
        assertValidProps("listing_created", { pirce: 10 }),
      );
    } finally {
      delete g.__DEV__;
    }
  });

  it("warns once and strips unknown keys outside dev", () => {
    const { result: first, warns } = withCapturedWarns(() =>
      assertValidProps("listing_created", { mode: "sale", pirce: 10 }),
    );
    assert.deepEqual(first, { mode: "sale" });
    assert.equal(warns.length, 1);
    assert.match(warns[0], /pirce/);
    assert.match(warns[0], /allowed: mode, hasPrice/);

    // Same event+keys again — deduped, no second warning.
    const { warns: repeatWarns } = withCapturedWarns(() =>
      assertValidProps("listing_created", { mode: "sale", pirce: 11 }),
    );
    assert.deepEqual(repeatWarns, []);
  });
});

describe("trackEvent wiring", () => {
  beforeEach(() => {
    __resetAnalyticsForTests();
    __resetAnalyticsValidateForTests();
  });
  afterEach(() => {
    delete (globalThis as DevGlobal).__DEV__;
  });

  async function initWithFakeSdk() {
    const captures: { event: string; props: unknown }[] = [];
    const sdk = {
      capture: (event: string, props?: unknown) =>
        void captures.push({ event, props }),
      identify: () => {},
      reset: () => {},
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
    return captures;
  }

  it("captures declared props untouched", async () => {
    const captures = await initWithFakeSdk();
    trackEvent("listing_created", { mode: "sale", hasPrice: true });
    assert.equal(captures.length, 1);
    assert.deepEqual(captures[0].props, { mode: "sale", hasPrice: true });
  });

  it("strips undeclared props before capture in production", async () => {
    const captures = await initWithFakeSdk();
    const { warns } = withCapturedWarns(() =>
      trackEvent("listing_created", { mode: "sale", pirce: 10 }),
    );
    assert.equal(captures.length, 1);
    assert.deepEqual(captures[0].props, { mode: "sale" });
    assert.equal(warns.length, 1);
  });

  it("throws before the enabled gate in dev builds, even when analytics is off", () => {
    (globalThis as DevGlobal).__DEV__ = true;
    // No initAnalytics — sdk is null, but the dev typo must still fail loudly.
    assert.throws(() => trackEvent("listing_created", { pirce: 10 }));
  });
});
