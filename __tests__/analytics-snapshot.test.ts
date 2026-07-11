import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  getAnalyticsSnapshot,
  identifyUser,
  initAnalytics,
  resetUser,
  setAnalyticsOptOut,
  __resetAnalyticsForTests,
} from "../lib/analytics";

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

describe("getAnalyticsSnapshot — last identify bookkeeping", () => {
  beforeEach(() => {
    __resetAnalyticsForTests();
  });

  it("starts empty", () => {
    assert.deepEqual(getAnalyticsSnapshot(), {
      lastIdentifyAt: null,
      lastIdentifyTraits: null,
    });
  });

  it("records timestamp + traits on a successful identify", async () => {
    await initWithFakeSdk();
    const before = Date.now();
    identifyUser("user-1", { language: "ru", isPremium: false });
    const snap = getAnalyticsSnapshot();
    assert.ok(snap.lastIdentifyAt !== null && snap.lastIdentifyAt >= before);
    assert.ok(snap.lastIdentifyAt! <= Date.now());
    assert.deepEqual(snap.lastIdentifyTraits, {
      language: "ru",
      isPremium: false,
    });
  });

  it("records null traits when identify is called without traits", async () => {
    await initWithFakeSdk();
    identifyUser("user-1");
    const snap = getAnalyticsSnapshot();
    assert.ok(snap.lastIdentifyAt !== null);
    assert.equal(snap.lastIdentifyTraits, null);
  });

  it("does NOT record a gated identify (SDK never reached)", () => {
    // No initAnalytics — sdk is null, the identify no-ops.
    identifyUser("user-1", { language: "en", isPremium: true });
    assert.deepEqual(getAnalyticsSnapshot(), {
      lastIdentifyAt: null,
      lastIdentifyTraits: null,
    });
  });

  it("does NOT record an identify blocked by opt-out", async () => {
    await initWithFakeSdk();
    setAnalyticsOptOut(true);
    identifyUser("user-1", { language: "en", isPremium: true });
    assert.equal(getAnalyticsSnapshot().lastIdentifyAt, null);
  });

  it("clears the snapshot on resetUser so traits never outlive sign-out", async () => {
    await initWithFakeSdk();
    identifyUser("user-1", { language: "ru", isPremium: true });
    assert.ok(getAnalyticsSnapshot().lastIdentifyAt !== null);
    resetUser();
    assert.deepEqual(getAnalyticsSnapshot(), {
      lastIdentifyAt: null,
      lastIdentifyTraits: null,
    });
  });

  it("returns defensive copies — mutating the snapshot cannot corrupt state", async () => {
    await initWithFakeSdk();
    identifyUser("user-1", { language: "ru", isPremium: false });
    const snap = getAnalyticsSnapshot();
    snap.lastIdentifyTraits!.language = "hacked";
    assert.equal(getAnalyticsSnapshot().lastIdentifyTraits!.language, "ru");
  });

  it("keeps the caller's traits object un-aliased (stores its own copy)", async () => {
    await initWithFakeSdk();
    const traits = { language: "ru", isPremium: false };
    identifyUser("user-1", traits);
    traits.language = "mutated-after-call";
    assert.equal(getAnalyticsSnapshot().lastIdentifyTraits!.language, "ru");
  });
});
