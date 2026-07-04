import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";

import {
  __resetClarityForTests,
  addClarityCustomTag,
  detectBrowserRuntime,
  initClarity,
  isClarityOptedOut,
  isClarityReady,
  setClarityOptOut,
  shouldLoadClarity,
  shutdownClarity,
  type ClarityRuntime,
} from "../lib/clarity";
import { __resetSentryForTests, initSentry } from "../lib/sentry";
import { setupFakeDom } from "./helpers/fake-dom";

const ROOT = path.join(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const enabledRuntime = (overrides?: Partial<ClarityRuntime>): ClarityRuntime => ({
  isBrowser: true,
  doNotTrack: false,
  clarityId: "abc123",
  enabled: true,
  ...overrides,
});


describe("lib/clarity — shouldLoadClarity gates", () => {
  beforeEach(() => __resetClarityForTests());

  it("returns true when all gates pass (browser, no DNT, enabled, clarityId set)", () => {
    assert.equal(shouldLoadClarity(enabledRuntime()), true);
  });

  it("returns false when isBrowser is false (native runtime)", () => {
    assert.equal(shouldLoadClarity(enabledRuntime({ isBrowser: false })), false);
  });

  it("returns false when doNotTrack is true", () => {
    assert.equal(shouldLoadClarity(enabledRuntime({ doNotTrack: true })), false);
  });

  it("returns false when analytics is not enabled", () => {
    assert.equal(shouldLoadClarity(enabledRuntime({ enabled: false })), false);
  });

  it("returns false when clarityId is empty / whitespace", () => {
    assert.equal(shouldLoadClarity(enabledRuntime({ clarityId: "" })), false);
    assert.equal(shouldLoadClarity(enabledRuntime({ clarityId: "   " })), false);
  });

  it("returns false when the user has opted out of diagnostics", () => {
    setClarityOptOut(true);
    assert.equal(shouldLoadClarity(enabledRuntime()), false);
    setClarityOptOut(false);
    assert.equal(shouldLoadClarity(enabledRuntime()), true);
  });
});

describe("lib/clarity — detectBrowserRuntime", () => {
  beforeEach(() => __resetClarityForTests());

  it("reports isBrowser=false in a node-only environment (no fake DOM)", () => {
    // Sanity guard — node:test runs without window/document by default.
    const g = globalThis as unknown as { window?: unknown; document?: unknown };
    const hasWindow = typeof g.window !== "undefined";
    const hasDocument = typeof g.document !== "undefined";
    if (!hasWindow && !hasDocument) {
      const result = detectBrowserRuntime();
      assert.equal(result.isBrowser, false);
      assert.equal(result.doNotTrack, false);
    }
  });

  it("reads navigator.doNotTrack === '1' as opt-out", () => {
    const fake = setupFakeDom({ doNotTrack: "1" });
    try {
      const result = detectBrowserRuntime();
      assert.equal(result.isBrowser, true);
      assert.equal(result.doNotTrack, true);
    } finally {
      fake.restore();
    }
  });

  it("treats navigator.doNotTrack === '0' / unset as not opted out", () => {
    const fake = setupFakeDom({ doNotTrack: "0" });
    try {
      const result = detectBrowserRuntime();
      assert.equal(result.doNotTrack, false);
    } finally {
      fake.restore();
    }
  });

  it("honours the legacy 'yes' / boolean true variants", () => {
    const a = setupFakeDom({ doNotTrack: "yes" });
    try {
      assert.equal(detectBrowserRuntime().doNotTrack, true);
    } finally {
      a.restore();
    }
    const b = setupFakeDom({ doNotTrack: true });
    try {
      assert.equal(detectBrowserRuntime().doNotTrack, true);
    } finally {
      b.restore();
    }
  });
});

describe("lib/clarity — initClarity injection behaviour", () => {
  let fake: ReturnType<typeof setupFakeDom> | null = null;

  beforeEach(() => {
    __resetClarityForTests();
  });

  afterEach(() => {
    if (fake) {
      fake.restore();
      fake = null;
    }
  });

  it("injects a script tag with the correct src and id when gates pass", () => {
    fake = setupFakeDom();
    const ok = initClarity({ runtime: enabledRuntime({ clarityId: "proj-7" }) });
    assert.equal(ok, true);
    assert.equal(isClarityReady(), true);
    assert.equal(fake.created.length, 1);
    const node = fake.created[0] as {
      id?: string;
      src?: string;
      async?: boolean;
    };
    assert.equal(node.id, "ms-clarity-tag");
    assert.equal(node.async, true);
    assert.match(node.src ?? "", /^https:\/\/www\.clarity\.ms\/tag\/proj-7$/);
    assert.equal(fake.head.inserted.length, 1);
  });

  it("URL-encodes the project ID to neutralise injection attempts", () => {
    fake = setupFakeDom();
    initClarity({ runtime: enabledRuntime({ clarityId: "weird/id?x" }) });
    const node = fake.created[0] as { src?: string };
    assert.match(node.src ?? "", /tag\/weird%2Fid%3Fx/);
  });

  it("is idempotent — a second initClarity() call does not inject twice", () => {
    fake = setupFakeDom();
    const first = initClarity({ runtime: enabledRuntime() });
    const second = initClarity({ runtime: enabledRuntime() });
    assert.equal(first, true);
    assert.equal(second, true);
    assert.equal(fake.created.length, 1);
  });

  it("returns false and does NOT inject when DNT is on", () => {
    fake = setupFakeDom();
    const ok = initClarity({ runtime: enabledRuntime({ doNotTrack: true }) });
    assert.equal(ok, false);
    assert.equal(isClarityReady(), false);
    assert.equal(fake.created.length, 0);
  });

  it("returns false and does NOT inject when not in a browser", () => {
    // No fake DOM — runtime detection sees no window/document.
    const ok = initClarity({ runtime: enabledRuntime({ isBrowser: false }) });
    assert.equal(ok, false);
    assert.equal(isClarityReady(), false);
  });

  it("returns false when clarityId is missing", () => {
    fake = setupFakeDom();
    const ok = initClarity({ runtime: enabledRuntime({ clarityId: "" }) });
    assert.equal(ok, false);
    assert.equal(fake.created.length, 0);
  });

  it("appends to <head> when there is no existing <script>", () => {
    fake = setupFakeDom({ hasFirstScript: false });
    const ok = initClarity({ runtime: enabledRuntime() });
    assert.equal(ok, true);
    assert.equal(fake.head.appended.length, 1);
  });

  it("seeds window.clarity queue stub before injection", () => {
    fake = setupFakeDom();
    initClarity({ runtime: enabledRuntime() });
    const stub = (fake.fakeWindow as { clarity?: { (...args: unknown[]): void; q?: unknown[][] } }).clarity;
    assert.equal(typeof stub, "function");
    stub!("track", "evt");
    assert.deepEqual(stub!.q?.[0], ["track", "evt"]);
  });
});

describe("lib/clarity — 'clarity loaded' Sentry breadcrumb", () => {
  let fake: ReturnType<typeof setupFakeDom> | null = null;
  let sentryCalls: { method: string; args: unknown[] }[] = [];

  beforeEach(async () => {
    __resetClarityForTests();
    __resetSentryForTests();
    sentryCalls = [];
    await initSentry({
      env: {
        EXPO_PUBLIC_SENTRY_DSN: "https://abc@o0.ingest.sentry.io/42",
        EXPO_PUBLIC_SENTRY_ENV: "production",
      },
      loader: async () => ({
        init: (...args: unknown[]) => {
          sentryCalls.push({ method: "init", args });
        },
        captureException: (...args: unknown[]) => {
          sentryCalls.push({ method: "captureException", args });
        },
        addBreadcrumb: (...args: unknown[]) => {
          sentryCalls.push({ method: "addBreadcrumb", args });
        },
      }),
    });
  });

  afterEach(() => {
    __resetSentryForTests();
    if (fake) {
      fake.restore();
      fake = null;
    }
  });

  const breadcrumbs = () =>
    sentryCalls.filter((c) => c.method === "addBreadcrumb");

  it("records a breadcrumb with clarityId + doNotTrack on first successful init", () => {
    fake = setupFakeDom();
    const ok = initClarity({ runtime: enabledRuntime({ clarityId: "proj-9" }) });
    assert.equal(ok, true);
    assert.equal(breadcrumbs().length, 1);
    const crumb = breadcrumbs()[0].args[0] as {
      message?: string;
      data?: Record<string, unknown>;
    };
    assert.equal(crumb.message, "clarity loaded");
    assert.deepEqual(crumb.data, { clarityId: "proj-9", doNotTrack: false });
  });

  it("does not record a second breadcrumb on repeat init calls", () => {
    fake = setupFakeDom();
    initClarity({ runtime: enabledRuntime() });
    initClarity({ runtime: enabledRuntime() });
    assert.equal(breadcrumbs().length, 1);
  });

  it("records nothing when the gates block injection", () => {
    fake = setupFakeDom();
    initClarity({ runtime: enabledRuntime({ enabled: false }) });
    initClarity({ runtime: enabledRuntime({ doNotTrack: true }) });
    initClarity({ runtime: enabledRuntime({ clarityId: " " }) });
    assert.equal(breadcrumbs().length, 0);
  });

  it("still succeeds when Sentry never initialised (breadcrumb is a no-op)", () => {
    __resetSentryForTests(); // sdk gone — addBreadcrumb must silently no-op
    fake = setupFakeDom();
    const ok = initClarity({ runtime: enabledRuntime() });
    assert.equal(ok, true);
    assert.equal(isClarityReady(), true);
  });
});

describe("lib/clarity — disabled-with-clarityId one-time warning", () => {
  let warnings: unknown[][] = [];
  const originalWarn = console.warn;

  beforeEach(() => {
    __resetClarityForTests();
    warnings = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
  });

  afterEach(() => {
    console.warn = originalWarn;
  });

  it("warns once when clarityId is set but analytics is disabled", () => {
    const ok = initClarity({ runtime: enabledRuntime({ enabled: false }) });
    assert.equal(ok, false);
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0][0]), /clarityId is set but analytics is disabled/);
  });

  it("does not repeat the warning on subsequent init calls", () => {
    initClarity({ runtime: enabledRuntime({ enabled: false }) });
    initClarity({ runtime: enabledRuntime({ enabled: false }) });
    initClarity({ runtime: enabledRuntime({ enabled: false }) });
    assert.equal(warnings.length, 1);
  });

  it("stays silent when clarityId is empty or whitespace", () => {
    initClarity({ runtime: enabledRuntime({ enabled: false, clarityId: "" }) });
    initClarity({ runtime: enabledRuntime({ enabled: false, clarityId: "  " }) });
    assert.equal(warnings.length, 0);
  });

  it("stays silent when analytics is enabled (whatever the other gates say)", () => {
    initClarity({ runtime: enabledRuntime({ doNotTrack: true }) });
    initClarity({ runtime: enabledRuntime({ isBrowser: false }) });
    assert.equal(warnings.length, 0);
  });

  it("__resetClarityForTests re-arms the warning", () => {
    initClarity({ runtime: enabledRuntime({ enabled: false }) });
    __resetClarityForTests();
    initClarity({ runtime: enabledRuntime({ enabled: false }) });
    assert.equal(warnings.length, 2);
  });
});

describe("lib/clarity — opt-out + shutdown", () => {
  let fake: ReturnType<typeof setupFakeDom> | null = null;

  beforeEach(() => __resetClarityForTests());
  afterEach(() => {
    if (fake) {
      fake.restore();
      fake = null;
    }
  });

  it("setClarityOptOut(true) tears down an existing injection", () => {
    fake = setupFakeDom();
    initClarity({ runtime: enabledRuntime() });
    assert.equal(isClarityReady(), true);
    setClarityOptOut(true);
    assert.equal(isClarityOptedOut(), true);
    assert.equal(isClarityReady(), false);
    assert.equal(fake.head.removed.length, 1);
  });

  it("shutdownClarity removes the script tag and clears the global stub", () => {
    fake = setupFakeDom();
    initClarity({ runtime: enabledRuntime() });
    shutdownClarity();
    assert.equal(isClarityReady(), false);
    assert.equal(fake.head.removed.length, 1);
    const stub = (fake.fakeWindow as { clarity?: unknown }).clarity;
    assert.equal(stub, undefined);
  });

  it("post-opt-out re-init no-ops until the user opts back in", () => {
    fake = setupFakeDom();
    setClarityOptOut(true);
    const ok = initClarity({ runtime: enabledRuntime() });
    assert.equal(ok, false);
    setClarityOptOut(false);
    const okAfter = initClarity({ runtime: enabledRuntime() });
    assert.equal(okAfter, true);
  });
});

describe("lib/clarity — purity / module-shape guards", () => {
  it("does NOT statically import react-native (would break native bundle / node tests)", () => {
    const src = read("lib/clarity.ts");
    assert.doesNotMatch(
      src,
      /from\s+["']react-native["']/,
      "lib/clarity.ts must stay framework-pure so the test suite runs in node",
    );
  });

  it("uses typeof window/document guards instead of relying on Platform.OS", () => {
    const src = read("lib/clarity.ts");
    assert.match(
      src,
      /typeof\s+window\s*!==\s*["']undefined["']/,
      "lib/clarity.ts must runtime-guard via typeof window so it cannot crash on native",
    );
    assert.match(
      src,
      /typeof\s+document\s*!==\s*["']undefined["']/,
      "lib/clarity.ts must runtime-guard via typeof document",
    );
  });

  it("references the canonical Clarity tag URL", () => {
    const src = read("lib/clarity.ts");
    assert.match(
      src,
      /https:\/\/www\.clarity\.ms\/tag\//,
      "lib/clarity.ts must reference the official Microsoft Clarity tag endpoint",
    );
  });
});

describe("DiagnosticsProvider — Clarity wiring", () => {
  const src = read("lib/diagnostics-context.tsx");

  it("imports initClarity, setClarityOptOut, shutdownClarity from @/lib/clarity", () => {
    assert.match(
      src,
      /from\s+["']@\/lib\/clarity["']/,
      "DiagnosticsProvider must import the Clarity wrapper",
    );
    for (const symbol of ["initClarity", "setClarityOptOut", "shutdownClarity"]) {
      assert.match(
        src,
        new RegExp(`\\b${symbol}\\b`),
        `DiagnosticsProvider must reference ${symbol}`,
      );
    }
  });

  it("calls initClarity() on the diagnostics-enabled hydration branch", () => {
    const initSentryIdx = src.indexOf("initSentry()");
    const initClarityIdx = src.indexOf("initClarity()");
    assert.ok(initClarityIdx >= 0, "initClarity() call missing");
    assert.ok(
      initClarityIdx > initSentryIdx,
      "initClarity() should follow initSentry() in the hydration order",
    );
  });

  it("invokes shutdownClarity alongside the other shutdown calls on opt-out", () => {
    assert.match(
      src,
      /shutdownAnalytics\(\);[\s\S]{0,80}shutdownClarity\(\)/,
      "shutdownClarity must be invoked on the diagnostics-disabled branch",
    );
  });

  it("flips setClarityOptOut alongside setSentryOptOut + setAnalyticsOptOut", () => {
    const sentryFlips = (src.match(/setSentryOptOut\(/g) ?? []).length;
    const clarityFlips = (src.match(/setClarityOptOut\(/g) ?? []).length;
    assert.equal(
      clarityFlips,
      sentryFlips,
      "setClarityOptOut must be called everywhere setSentryOptOut is",
    );
  });
});

describe("docs/analytics-platform.md — Clarity implementation note", () => {
  const doc = read("docs/analytics-platform.md");

  it("documents the lib/clarity.ts loader location", () => {
    assert.match(
      doc,
      /lib\/clarity\.ts/,
      "Doc must point at lib/clarity.ts so future engineers can audit the gating",
    );
  });

  it("documents the doNotTrack honouring requirement", () => {
    assert.match(
      doc,
      /doNotTrack/i,
      "Doc must call out DNT honouring as a hard requirement",
    );
  });

  it("documents the clarityId env var EXPO_PUBLIC_CLARITY_PROJECT_ID", () => {
    assert.match(
      doc,
      /EXPO_PUBLIC_CLARITY_PROJECT_ID/,
      "Doc must name the env var so secret-rotation runbooks can find it",
    );
  });
});

describe("lib/clarity — addClarityCustomTag", () => {
  let fake: ReturnType<typeof setupFakeDom> | null = null;

  beforeEach(() => __resetClarityForTests());
  afterEach(() => {
    if (fake) {
      fake.restore();
      fake = null;
    }
  });

  const clarityStub = () =>
    (fake!.fakeWindow as {
      clarity?: { (...args: unknown[]): void; q?: unknown[][] };
    }).clarity;

  it("forwards ('set', key, value) into the queue shim after init", () => {
    fake = setupFakeDom();
    initClarity({ runtime: enabledRuntime() });
    const ok = addClarityCustomTag("isPremium", "true");
    assert.equal(ok, true);
    assert.deepEqual(clarityStub()!.q?.[0], ["set", "isPremium", "true"]);
  });

  it("trims the key and passes the value through untouched", () => {
    fake = setupFakeDom();
    initClarity({ runtime: enabledRuntime() });
    assert.equal(addClarityCustomTag("  language ", "ru"), true);
    assert.deepEqual(clarityStub()!.q?.[0], ["set", "language", "ru"]);
  });

  it("returns false before init — nothing is queued", () => {
    fake = setupFakeDom();
    assert.equal(addClarityCustomTag("isPremium", "true"), false);
    assert.equal(clarityStub(), undefined);
  });

  it("returns false for an empty / whitespace-only key", () => {
    fake = setupFakeDom();
    initClarity({ runtime: enabledRuntime() });
    assert.equal(addClarityCustomTag("", "x"), false);
    assert.equal(addClarityCustomTag("   ", "x"), false);
    assert.equal(clarityStub()!.q?.length, 0);
  });

  it("returns false after opt-out and after shutdown", () => {
    fake = setupFakeDom();
    initClarity({ runtime: enabledRuntime() });
    setClarityOptOut(true);
    assert.equal(addClarityCustomTag("isPremium", "true"), false);
    setClarityOptOut(false);

    initClarity({ runtime: enabledRuntime() });
    shutdownClarity();
    assert.equal(addClarityCustomTag("isPremium", "true"), false);
  });

  it("survives a throwing tracker without propagating", () => {
    fake = setupFakeDom();
    initClarity({ runtime: enabledRuntime() });
    (fake.fakeWindow as { clarity?: unknown }).clarity = () => {
      throw new Error("tracker exploded");
    };
    assert.equal(addClarityCustomTag("isPremium", "true"), false);
  });
});
