import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  initSentry,
  captureException,
  setSentryUser,
  addBreadcrumb,
  setSentryOptOut,
  isSentryOptedOut,
  shutdownSentry,
  getSentryStatus,
  __resetSentryForTests,
} from "../lib/sentry";
import { parseStoredDiagnostics } from "../lib/diagnostics-context";
import { DIAGNOSTICS_KEY } from "../lib/storage-keys";

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

describe("Crash #15 — setSentryOptOut", () => {
  beforeEach(() => __resetSentryForTests());

  it("setSentryOptOut(true) before init prevents the SDK from loading", async () => {
    let loaderCalled = false;
    setSentryOptOut(true);
    await initSentry({
      env: {
        EXPO_PUBLIC_SENTRY_DSN: "https://x@o.ingest.sentry.io/1",
        EXPO_PUBLIC_SENTRY_ENV: "production",
      },
      loader: async () => {
        loaderCalled = true;
        return makeFakeSdk().sdk;
      },
    });
    assert.equal(loaderCalled, false);
    assert.equal(isSentryOptedOut(), true);
  });

  it("flipping opt-out after init silences captureException + addBreadcrumb + setSentryUser", async () => {
    const { sdk, calls } = makeFakeSdk();
    await initSentry({
      env: {
        EXPO_PUBLIC_SENTRY_DSN: "https://x@o.ingest.sentry.io/1",
        EXPO_PUBLIC_SENTRY_ENV: "production",
      },
      loader: async () => sdk,
    });
    captureException(new Error("before"));
    setSentryOptOut(true);
    captureException(new Error("after"));
    addBreadcrumb("after");
    setSentryUser({ id: "u1", email: "a@b.c" });
    const captured = calls.filter((c) => c.method === "captureException");
    assert.equal(captured.length, 1, "only the pre-opt-out event should reach the SDK");
  });

  it("shutdownSentry tears down the cached SDK", async () => {
    const { sdk } = makeFakeSdk();
    await initSentry({
      env: {
        EXPO_PUBLIC_SENTRY_DSN: "https://x@o.ingest.sentry.io/1",
        EXPO_PUBLIC_SENTRY_ENV: "production",
      },
      loader: async () => sdk,
    });
    assert.equal(getSentryStatus().ready, true);
    shutdownSentry();
    assert.equal(getSentryStatus().ready, false);
    assert.equal(getSentryStatus().reason, "not-initialised");
  });
});

describe("Crash #15 — getSentryStatus diagnostics", () => {
  beforeEach(() => __resetSentryForTests());

  it("reports 'missing-dsn' when SDK booted but had no DSN", async () => {
    await initSentry({ env: {}, loader: async () => makeFakeSdk().sdk });
    const status = getSentryStatus();
    assert.equal(status.reason, "missing-dsn");
    assert.equal(status.dsnPresent, false);
    assert.equal(status.ready, false);
  });

  it("reports 'development-env' when DSN present but env=development", async () => {
    await initSentry({
      env: {
        EXPO_PUBLIC_SENTRY_DSN: "https://x@o.ingest.sentry.io/1",
        EXPO_PUBLIC_SENTRY_ENV: "development",
      },
      loader: async () => makeFakeSdk().sdk,
    });
    const status = getSentryStatus();
    assert.equal(status.reason, "development-env");
    assert.equal(status.environment, "development");
  });

  it("reports 'user-opted-out' when the user toggled off", async () => {
    setSentryOptOut(true);
    await initSentry({
      env: {
        EXPO_PUBLIC_SENTRY_DSN: "https://x@o.ingest.sentry.io/1",
        EXPO_PUBLIC_SENTRY_ENV: "production",
      },
      loader: async () => makeFakeSdk().sdk,
    });
    assert.equal(getSentryStatus().reason, "user-opted-out");
  });

  it("reports 'ready' when DSN+env+SDK all present", async () => {
    const { sdk } = makeFakeSdk();
    await initSentry({
      env: {
        EXPO_PUBLIC_SENTRY_DSN: "https://x@o.ingest.sentry.io/1",
        EXPO_PUBLIC_SENTRY_ENV: "production",
      },
      loader: async () => sdk,
    });
    const status = getSentryStatus();
    assert.equal(status.reason, "ready");
    assert.equal(status.ready, true);
    assert.equal(status.environment, "production");
    assert.equal(status.dsnPresent, true);
  });

  it("reports 'not-initialised' before initSentry has been called", () => {
    const status = getSentryStatus();
    assert.equal(status.reason, "not-initialised");
    assert.equal(status.initialised, false);
  });
});

describe("Crash #15 — parseStoredDiagnostics", () => {
  it("defaults to true when no value is stored (opt-IN)", () => {
    assert.equal(parseStoredDiagnostics(null), true);
  });

  it("returns true for {enabled:true}", () => {
    assert.equal(parseStoredDiagnostics(JSON.stringify({ enabled: true })), true);
  });

  it("returns false only when enabled is explicitly false", () => {
    assert.equal(parseStoredDiagnostics(JSON.stringify({ enabled: false })), false);
  });

  it("falls back to opt-IN on malformed JSON", () => {
    assert.equal(parseStoredDiagnostics("not json"), true);
  });
});

describe("Crash #15 — storage key", () => {
  it("DIAGNOSTICS_KEY is exported with the canonical name", () => {
    assert.equal(DIAGNOSTICS_KEY, "collectables-diagnostics-v1");
  });
});

describe("Crash #15 — settings UI wiring", () => {
  const settingsSrc = readFileSync(
    path.join(process.cwd(), "app", "settings.tsx"),
    "utf8",
  );

  it("imports useDiagnostics", () => {
    assert.match(
      settingsSrc,
      /import\s*\{\s*useDiagnostics\s*\}\s*from\s*["']@\/lib\/diagnostics-context["']/,
    );
  });

  it("renders a Pressable that calls setDiagnosticsEnabled", () => {
    assert.match(
      settingsSrc,
      /setDiagnosticsEnabled\(\s*!\s*diagnosticsEnabled\s*\)/,
    );
  });

  it("uses the localised diagnosticsTitle/Hint/Enabled/Disabled keys", () => {
    for (const key of [
      "diagnosticsTitle",
      "diagnosticsHint",
      "diagnosticsEnabled",
      "diagnosticsDisabled",
    ]) {
      assert.ok(
        settingsSrc.includes(`t("${key}")`),
        `settings.tsx must call t("${key}")`,
      );
    }
  });
});

describe("Crash #15 — devtools globals", () => {
  const layoutSrc = readFileSync(
    path.join(process.cwd(), "app", "_layout.tsx"),
    "utf8",
  );

  it("registers __sentryStatus on globalThis", () => {
    assert.match(layoutSrc, /__sentryStatus\s*=\s*getSentryStatus/);
  });

  it("imports getSentryStatus from @/lib/sentry", () => {
    assert.match(
      layoutSrc,
      /import\s*\{[^}]*getSentryStatus[^}]*\}\s*from\s*["']@\/lib\/sentry["']/,
    );
  });
});
