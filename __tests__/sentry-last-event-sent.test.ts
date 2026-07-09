import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  initSentry,
  captureException,
  getSentryStatus,
  setSentryOptOut,
  triggerSentryTestError,
  __resetSentryForTests,
} from "../lib/sentry";

function makeFakeSdk(opts: { throwOnCapture?: boolean } = {}) {
  const calls: string[] = [];
  return {
    sdk: {
      init: () => calls.push("init"),
      captureException: () => {
        calls.push("captureException");
        if (opts.throwOnCapture) throw new Error("sdk boom");
      },
      addBreadcrumb: () => calls.push("addBreadcrumb"),
      setUser: () => calls.push("setUser"),
    },
    calls,
  };
}

async function boot(opts: { throwOnCapture?: boolean } = {}) {
  const { sdk, calls } = makeFakeSdk(opts);
  await initSentry({
    env: {
      EXPO_PUBLIC_SENTRY_DSN: "https://x@o.ingest.sentry.io/1",
      EXPO_PUBLIC_SENTRY_ENV: "production",
    },
    loader: async () => sdk,
  });
  return calls;
}

describe("getSentryStatus().lastEventSentAt", () => {
  it("is null before any event is sent", async () => {
    await boot();
    assert.equal(getSentryStatus().lastEventSentAt, null);
  });

  it("is stamped with a parseable ISO timestamp after captureException", async () => {
    await boot();
    const before = Date.now();
    captureException(new Error("boom"));
    const stamp = getSentryStatus().lastEventSentAt;
    assert.ok(stamp, "captureException must stamp lastEventSentAt");
    const parsed = Date.parse(stamp!);
    assert.ok(Number.isFinite(parsed), "stamp must be a valid ISO string");
    assert.ok(parsed >= before && parsed <= Date.now() + 1000);
  });

  it("is stamped after a captured smoke test", async () => {
    await boot();
    assert.equal(triggerSentryTestError(), "captured");
    assert.ok(getSentryStatus().lastEventSentAt);
  });

  it("stays null when the capture is dropped by the opt-out gate", async () => {
    await boot();
    setSentryOptOut(true);
    captureException(new Error("dropped"));
    assert.equal(getSentryStatus().lastEventSentAt, null);
  });

  it("stays null when the capture never initialised (no SDK)", () => {
    captureException(new Error("no sdk"));
    assert.equal(getSentryStatus().lastEventSentAt, null);
  });

  it("stays null when the SDK capture throws", async () => {
    await boot({ throwOnCapture: true });
    captureException(new Error("boom"));
    assert.equal(getSentryStatus().lastEventSentAt, null);
  });

  it("is cleared by __resetSentryForTests (session-scoped, never persisted)", async () => {
    await boot();
    captureException(new Error("boom"));
    assert.ok(getSentryStatus().lastEventSentAt);
    __resetSentryForTests();
    assert.equal(getSentryStatus().lastEventSentAt, null);
  });
});
