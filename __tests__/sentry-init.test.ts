import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  initSentry,
  captureException,
  addBreadcrumb,
  isSentryReady,
  __resetSentryForTests,
} from "../lib/sentry";

type Call = { method: string; args: unknown[] };

function makeFakeSdk() {
  const calls: Call[] = [];
  const sdk = {
    init: (options: Record<string, unknown>) => {
      calls.push({ method: "init", args: [options] });
    },
    captureException: (
      error: unknown,
      context?: Record<string, unknown>,
    ) => {
      calls.push({ method: "captureException", args: [error, context] });
    },
    addBreadcrumb: (breadcrumb: Record<string, unknown>) => {
      calls.push({ method: "addBreadcrumb", args: [breadcrumb] });
    },
  };
  return { sdk, calls };
}

describe("lib/sentry — disabled paths", () => {
  beforeEach(() => __resetSentryForTests());

  it("captureException is a no-op before initSentry()", () => {
    const { sdk, calls } = makeFakeSdk();
    sdk.captureException(new Error("guard"));
    calls.length = 0; // reset; we only care that the wrapper does not delegate
    captureException(new Error("ignored"));
    assert.equal(calls.length, 0);
    assert.equal(isSentryReady(), false);
  });

  it("addBreadcrumb is a no-op before initSentry()", () => {
    addBreadcrumb("ignored", { foo: "bar" });
    assert.equal(isSentryReady(), false);
  });

  it("does not load the SDK when DSN is missing", async () => {
    let loaderCalls = 0;
    await initSentry({
      env: {},
      loader: async () => {
        loaderCalls += 1;
        return makeFakeSdk().sdk;
      },
    });
    assert.equal(loaderCalls, 0);
    assert.equal(isSentryReady(), false);
  });

  it("does not load the SDK when SENTRY_ENV is development", async () => {
    let loaderCalls = 0;
    await initSentry({
      env: {
        EXPO_PUBLIC_SENTRY_DSN: "https://x@o.ingest.sentry.io/1",
        EXPO_PUBLIC_SENTRY_ENV: "development",
      },
      loader: async () => {
        loaderCalls += 1;
        return makeFakeSdk().sdk;
      },
    });
    assert.equal(loaderCalls, 0);
    assert.equal(isSentryReady(), false);
  });
});

describe("lib/sentry — enabled paths", () => {
  beforeEach(() => __resetSentryForTests());

  it("initSentry() loads the SDK and calls init() with resolved config", async () => {
    const { sdk, calls } = makeFakeSdk();
    await initSentry({
      env: {
        EXPO_PUBLIC_SENTRY_DSN: "https://abc@o0.ingest.sentry.io/42",
        EXPO_PUBLIC_SENTRY_ENV: "production",
        EXPO_PUBLIC_APP_VERSION: "1.2.3",
      },
      loader: async () => sdk,
    });
    assert.equal(isSentryReady(), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "init");
    const initOptions = calls[0].args[0] as Record<string, unknown>;
    assert.equal(initOptions.dsn, "https://abc@o0.ingest.sentry.io/42");
    assert.equal(initOptions.environment, "production");
    assert.equal(initOptions.release, "collectables@1.2.3");
    assert.equal(initOptions.tracesSampleRate, 0.1);
    assert.equal(initOptions.enableNative, true);
  });

  it("captureException delegates and packs context under 'extra'", async () => {
    const { sdk, calls } = makeFakeSdk();
    await initSentry({
      env: {
        EXPO_PUBLIC_SENTRY_DSN: "https://abc@o0.ingest.sentry.io/42",
        EXPO_PUBLIC_SENTRY_ENV: "production",
      },
      loader: async () => sdk,
    });
    captureException(new Error("boom"), { route: "/listing/42" });
    const last = calls[calls.length - 1];
    assert.equal(last.method, "captureException");
    assert.deepEqual(last.args[1], { extra: { route: "/listing/42" } });
  });

  it("captureException without context omits the extra wrapper", async () => {
    const { sdk, calls } = makeFakeSdk();
    await initSentry({
      env: {
        EXPO_PUBLIC_SENTRY_DSN: "https://abc@o0.ingest.sentry.io/42",
        EXPO_PUBLIC_SENTRY_ENV: "production",
      },
      loader: async () => sdk,
    });
    captureException(new Error("boom"));
    const last = calls[calls.length - 1];
    assert.equal(last.method, "captureException");
    assert.equal(last.args[1], undefined);
  });

  it("addBreadcrumb forwards message + data + level=info", async () => {
    const { sdk, calls } = makeFakeSdk();
    await initSentry({
      env: {
        EXPO_PUBLIC_SENTRY_DSN: "https://abc@o0.ingest.sentry.io/42",
        EXPO_PUBLIC_SENTRY_ENV: "production",
      },
      loader: async () => sdk,
    });
    addBreadcrumb("user opened listing", { id: "42" });
    const last = calls[calls.length - 1];
    assert.equal(last.method, "addBreadcrumb");
    assert.deepEqual(last.args[0], {
      message: "user opened listing",
      data: { id: "42" },
      level: "info",
    });
  });

  it("survives a loader rejection by staying disabled", async () => {
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      await initSentry({
        env: {
          EXPO_PUBLIC_SENTRY_DSN: "https://abc@o0.ingest.sentry.io/42",
          EXPO_PUBLIC_SENTRY_ENV: "production",
        },
        loader: async () => {
          throw new Error("native bridge missing");
        },
      });
      assert.equal(isSentryReady(), false);
      // wrappers must still be safe no-ops
      captureException(new Error("safe"));
      addBreadcrumb("safe");
    } finally {
      console.warn = originalWarn;
    }
  });

  it("ignores duplicate initSentry() calls", async () => {
    const { sdk, calls } = makeFakeSdk();
    await initSentry({
      env: {
        EXPO_PUBLIC_SENTRY_DSN: "https://abc@o0.ingest.sentry.io/42",
        EXPO_PUBLIC_SENTRY_ENV: "production",
      },
      loader: async () => sdk,
    });
    await initSentry({
      env: {
        EXPO_PUBLIC_SENTRY_DSN: "https://abc@o0.ingest.sentry.io/42",
        EXPO_PUBLIC_SENTRY_ENV: "production",
      },
      loader: async () => sdk,
    });
    const initCalls = calls.filter((c) => c.method === "init");
    assert.equal(initCalls.length, 1);
  });

  it("captureException swallows SDK exceptions instead of rethrowing", async () => {
    const sdk: ReturnType<typeof makeFakeSdk>["sdk"] = {
      init: () => undefined,
      captureException: () => {
        throw new Error("sdk crashed");
      },
      addBreadcrumb: () => undefined,
    };
    await initSentry({
      env: {
        EXPO_PUBLIC_SENTRY_DSN: "https://abc@o0.ingest.sentry.io/42",
        EXPO_PUBLIC_SENTRY_ENV: "production",
      },
      loader: async () => sdk,
    });
    assert.doesNotThrow(() => captureException(new Error("boom")));
    assert.doesNotThrow(() => addBreadcrumb("safe"));
  });
});

describe("lib/sentry — module shape", () => {
  it("does not import @sentry/react-native at the top level", () => {
    const src = readFileSync(
      path.join(process.cwd(), "lib", "sentry.ts"),
      "utf8",
    );
    // Top-level static import would look like: import ... from "@sentry/react-native";
    assert.doesNotMatch(
      src,
      /^\s*import[^;]*from\s+["']@sentry\/react-native["']/m,
      "lib/sentry.ts must lazy-import the SDK so test/dev bundles do not pay the cost",
    );
    // The dynamic `await import("@sentry/react-native")` must still be present.
    assert.match(
      src,
      /import\(\s*["']@sentry\/react-native["']\s*\)/,
      "lib/sentry.ts must dynamically import the SDK inside initSentry()",
    );
  });

  it("guards every wrapper with both sdk and enabled checks", () => {
    const src = readFileSync(
      path.join(process.cwd(), "lib", "sentry.ts"),
      "utf8",
    );
    const guardCount = (src.match(/!sdk\s*\|\|\s*!activeConfig\?\.enabled/g) ?? []).length;
    assert.ok(
      guardCount >= 2,
      "captureException + addBreadcrumb must each gate on (sdk && enabled)",
    );
  });
});
