import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { initSentry, addBreadcrumb, setSentryOptOut } from "../lib/sentry";

type Call = { method: string; args: unknown[] };

function makeFakeSdk() {
  const calls: Call[] = [];
  return {
    sdk: {
      init: () => calls.push({ method: "init", args: [] }),
      captureException: (e: unknown) =>
        calls.push({ method: "captureException", args: [e] }),
      addBreadcrumb: (b: unknown) =>
        calls.push({ method: "addBreadcrumb", args: [b] }),
      setUser: (u: unknown) => calls.push({ method: "setUser", args: [u] }),
    },
    calls,
  };
}

async function bootWithFakeSdk() {
  const { sdk, calls } = makeFakeSdk();
  await initSentry({
    env: {
      EXPO_PUBLIC_SENTRY_DSN: "https://x@o.ingest.sentry.io/1",
      EXPO_PUBLIC_SENTRY_ENV: "production",
    },
    loader: async () => sdk,
  });
  return calls;
}

function breadcrumbs(calls: Call[]) {
  return calls
    .filter((c) => c.method === "addBreadcrumb")
    .map((c) => c.args[0] as Record<string, unknown>);
}

describe("addBreadcrumb — level parameter", () => {
  it("defaults to level 'info' when no level is passed", async () => {
    const calls = await bootWithFakeSdk();
    addBreadcrumb("navigated to /home", { pathname: "/home" });
    const [crumb] = breadcrumbs(calls);
    assert.deepEqual(crumb, {
      message: "navigated to /home",
      data: { pathname: "/home" },
      level: "info",
    });
  });

  it("forwards an explicit 'warning' level to the SDK", async () => {
    const calls = await bootWithFakeSdk();
    addBreadcrumb("user denied photo permission", undefined, "warning");
    const [crumb] = breadcrumbs(calls);
    assert.equal(crumb.level, "warning");
    assert.equal(crumb.message, "user denied photo permission");
  });

  it("forwards an explicit 'error' level to the SDK", async () => {
    const calls = await bootWithFakeSdk();
    addBreadcrumb("upload failed", { status: 500 }, "error");
    const [crumb] = breadcrumbs(calls);
    assert.equal(crumb.level, "error");
    assert.deepEqual(crumb.data, { status: 500 });
  });

  it("still respects the opt-out gate regardless of level", async () => {
    const calls = await bootWithFakeSdk();
    setSentryOptOut(true);
    addBreadcrumb("should be dropped", undefined, "error");
    assert.equal(breadcrumbs(calls).length, 0);
  });
});
