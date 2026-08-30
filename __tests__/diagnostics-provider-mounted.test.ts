import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";

import { installNativeModuleStubs, mockModule, render } from "./helpers/render";

/**
 * `DiagnosticsProvider`, mounted.
 *
 * Every case this provider had asserted its SOURCE — `assert.match(catchArm,
 * /resolveDiagnosticsEnabled\(null, readDoNotTrack\(\)\)/)` and a
 * `doesNotMatch` for the three initialisers — under a comment saying mounting
 * was impossible because it would start the real SDKs. That is the coverage
 * shape this tree has spent a week distrusting, and it was standing in for the
 * one question the provider exists to answer: whether a device that cannot
 * read its stored consent leaves the SDKs off IN FACT, rather than in a regex
 * over a block of code that could be rewritten around it.
 *
 * The SDKs are module-level imports, so `mockModule` IS the injection — no
 * production seam is needed and no real Sentry/PostHog/Clarity boots. The
 * mocks record calls IN ORDER, which is the half a source scan can never do:
 * `setSentryOptOut(false)` landing after `initSentry()` reads fine and boots an
 * SDK against the previous session's answer, because `runInit` checks the flag
 * it holds at the moment it runs.
 *
 * ## Nothing under `lib/` may be imported at module scope
 *
 * `mockModule` only replaces a specifier that has not been evaluated yet, and
 * `lib/storage-keys.ts` imports AsyncStorage on its first line. Importing
 * `DIAGNOSTICS_KEY` from it at the top of this file was enough to load the
 * REAL `@react-native-async-storage/async-storage`, whose web build then threw
 * `ReferenceError: window is not defined` inside the hydrate — so the suite
 * spent its first run testing the provider's failure arm five times over while
 * looking like it was testing everything. Every repo import here is lazy.
 */

installNativeModuleStubs();

/** Every SDK call and storage write this render made, in order. */
const calls: string[] = [];
/** Keys the provider actually read and wrote, in order. */
const reads: string[] = [];
const writes: { key: string; value: string }[] = [];
const captured: { error: unknown; context: { scope?: string } }[] = [];
/** What the device holds — `null` is "nothing stored yet". */
let stored: string | null = null;
let readError: Error | null = null;
let writeError: Error | null = null;

mockModule("@react-native-async-storage/async-storage", {
  default: {
    getItem: async (key: string) => {
      reads.push(key);
      if (readError) throw readError;
      return stored;
    },
    setItem: async (key: string, value: string) => {
      if (writeError) throw writeError;
      writes.push({ key, value });
      stored = value;
      calls.push(`setItem:${value}`);
    },
  },
});

mockModule("@/lib/sentry", {
  captureException: (error: unknown, context: { scope?: string }) =>
    captured.push({ error, context }),
  initSentry: async () => {
    calls.push("initSentry");
  },
  setSentryOptOut: (optOut: boolean) => calls.push(`setSentryOptOut:${optOut}`),
  shutdownSentry: () => calls.push("shutdownSentry"),
});

mockModule("@/lib/analytics", {
  initAnalytics: async () => {
    calls.push("initAnalytics");
  },
  setAnalyticsOptOut: (optOut: boolean) => calls.push(`setAnalyticsOptOut:${optOut}`),
  shutdownAnalytics: () => calls.push("shutdownAnalytics"),
});

mockModule("@/lib/clarity", {
  initClarity: () => {
    calls.push("initClarity");
    return true;
  },
  setClarityOptOut: (optOut: boolean) => calls.push(`setClarityOptOut:${optOut}`),
  shutdownClarity: () => calls.push("shutdownClarity"),
});

// ---------------------------------------------------------------------------
// Do-Not-Track, the browser half of the decision
// ---------------------------------------------------------------------------

type MutableGlobal = { navigator?: { doNotTrack?: string | null } };
const g = globalThis as MutableGlobal;
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

function setDoNotTrack(signal: string | null): void {
  Object.defineProperty(globalThis, "navigator", {
    value: { doNotTrack: signal },
    configurable: true,
    writable: true,
  });
}

function restoreNavigator(): void {
  if (originalNavigator) {
    Object.defineProperty(globalThis, "navigator", originalNavigator);
  } else {
    delete g.navigator;
  }
}

// ---------------------------------------------------------------------------
// Mounting
// ---------------------------------------------------------------------------

type DiagnosticsModule = typeof import("../lib/diagnostics-context");
type ContextValue = ReturnType<DiagnosticsModule["useDiagnostics"]>;

let diagnostics: DiagnosticsModule | null = null;
let seen: ContextValue | null = null;

function Probe() {
  seen = diagnostics!.useDiagnostics();
  return createElement("View", null);
}

/** Lets the hydrate's `getItem` promise chain settle before the tree is re-read. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function mount() {
  diagnostics ??= await import("../lib/diagnostics-context");
  (await import("../lib/report-storage-failure")).__resetStorageFailureReportsForTests();
  const tree = render(
    createElement(diagnostics.DiagnosticsProvider, null, createElement(Probe)),
  );
  await settle();
  tree.rerender();
  return tree;
}

/** The SDK calls only — storage writes filtered out. */
function sdkCalls(): string[] {
  return calls.filter((call) => !call.startsWith("setItem:"));
}

function started(): string[] {
  return calls.filter((call) => call.startsWith("init"));
}

const OPT_IN = JSON.stringify({ enabled: true });
const OPT_OUT = JSON.stringify({ enabled: false });

beforeEach(() => {
  calls.length = 0;
  reads.length = 0;
  writes.length = 0;
  captured.length = 0;
  stored = null;
  readError = null;
  writeError = null;
  seen = null;
  // Node's own `navigator` has no `doNotTrack`, which is the "signal absent"
  // case — every DNT-sensitive case sets the one it means.
  restoreNavigator();
});

describe("DiagnosticsProvider — a store it can read", () => {
  it("hydrates from the diagnostics key and nothing else", async () => {
    const { DIAGNOSTICS_KEY } = await import("../lib/storage-keys");
    await mount();

    assert.deepEqual(reads, [DIAGNOSTICS_KEY]);
  });

  it("an explicit opt-out leaves every SDK off and the toggle off", async () => {
    stored = OPT_OUT;
    await mount();

    assert.equal(seen?.diagnosticsEnabled, false);
    assert.equal(seen?.ready, true);
    assert.deepEqual(started(), [], "an opt-out must not boot an SDK");
    assert.deepEqual(sdkCalls(), [
      "setSentryOptOut:true",
      "setAnalyticsOptOut:true",
      "setClarityOptOut:true",
    ]);
  });

  it("an explicit opt-in starts all three, and clears the opt-out flag FIRST", async () => {
    stored = OPT_IN;
    await mount();

    assert.equal(seen?.diagnosticsEnabled, true);
    // Order, not membership: each SDK's `runInit` reads the opt-out flag it
    // holds at the moment it runs, so an init that landed before its own
    // `setXOptOut(false)` would boot against the previous session's answer.
    assert.deepEqual(sdkCalls(), [
      "setSentryOptOut:false",
      "setAnalyticsOptOut:false",
      "setClarityOptOut:false",
      "initSentry",
      "initAnalytics",
      "initClarity",
    ]);
  });

  it("hydrating writes nothing back — the store already says this", async () => {
    stored = OPT_IN;
    await mount();

    assert.deepEqual(writes, [], "a read must not turn into a write");
  });

  it("nothing stored + Do-Not-Track on → opted out, nothing booted", async () => {
    setDoNotTrack("1");
    await mount();

    assert.equal(seen?.diagnosticsEnabled, false);
    assert.deepEqual(started(), []);
  });

  it("nothing stored + no Do-Not-Track → opted in", async () => {
    setDoNotTrack("unspecified");
    await mount();

    assert.equal(seen?.diagnosticsEnabled, true);
    assert.deepEqual(started(), ["initSentry", "initAnalytics", "initClarity"]);
  });

  it("an explicit opt-in beats Do-Not-Track, because it is real consent", async () => {
    setDoNotTrack("1");
    stored = OPT_IN;
    await mount();

    assert.equal(seen?.diagnosticsEnabled, true);
    assert.deepEqual(started(), ["initSentry", "initAnalytics", "initClarity"]);
  });
});

describe("DiagnosticsProvider — a store it cannot read", () => {
  beforeEach(() => {
    readError = new Error("SecurityError: localStorage is not available");
  });

  it("falls back to Do-Not-Track rather than to the component's useState(true)", async () => {
    setDoNotTrack("1");
    await mount();

    assert.equal(
      seen?.diagnosticsEnabled,
      false,
      "the toggle must not read 'on' for a browser that says do not track",
    );
    assert.equal(seen?.ready, true, "the app must still finish starting");
  });

  it("starts NO SDK even when the fallback resolves to opt-in", async () => {
    setDoNotTrack("unspecified");
    await mount();

    // `diagnosticsEnabled` decides what the toggle shows and what a later flip
    // will do. An unknown consent state must not produce telemetry nobody
    // agreed to; the next launch that can read the store starts them.
    assert.equal(seen?.diagnosticsEnabled, true);
    assert.deepEqual(started(), [], "a failed read must not start collection");
  });

  it("still applies the resolved opt-out to all three SDKs", async () => {
    setDoNotTrack("1");
    await mount();

    assert.deepEqual(sdkCalls(), [
      "setSentryOptOut:true",
      "setAnalyticsOptOut:true",
      "setClarityOptOut:true",
    ]);
  });

  it("reports, because nothing else would mention an unreadable preference", async () => {
    await mount();

    assert.equal(captured.length, 1);
    assert.equal(captured[0].context.scope, "diagnostics-context.getItem");
  });

  it("does not overwrite the choice it failed to read", async () => {
    await mount();

    assert.deepEqual(writes, [], "an unreadable store is not a reason to rewrite it");
  });

  it("a user who then opts in gets the SDKs started and the choice written", async () => {
    setDoNotTrack("1");
    await mount();
    calls.length = 0;

    seen!.setDiagnosticsEnabled(true);
    await settle();

    // `setItem` is the CALL, not the completion — the provider fires the write
    // and boots without waiting for the disk, so a slow store never delays the
    // choice taking effect.
    assert.deepEqual(calls, [
      "setSentryOptOut:false",
      "setAnalyticsOptOut:false",
      "setClarityOptOut:false",
      `setItem:${OPT_IN}`,
      "initSentry",
      "initAnalytics",
      "initClarity",
    ]);
    assert.equal(stored, OPT_IN);
  });
});

describe("DiagnosticsProvider — flipping the toggle", () => {
  it("opting out shuts every SDK down and persists the choice", async () => {
    stored = OPT_IN;
    const tree = await mount();
    calls.length = 0;

    seen!.setDiagnosticsEnabled(false);
    await settle();
    tree.rerender();

    assert.deepEqual(calls, [
      "setSentryOptOut:true",
      "setAnalyticsOptOut:true",
      "setClarityOptOut:true",
      `setItem:${OPT_OUT}`,
      "shutdownSentry",
      "shutdownAnalytics",
      "shutdownClarity",
    ]);
    assert.equal(seen?.diagnosticsEnabled, false);
  });

  it("writes the choice under the diagnostics key", async () => {
    const { DIAGNOSTICS_KEY } = await import("../lib/storage-keys");
    await mount();

    seen!.setDiagnosticsEnabled(false);
    await settle();

    assert.deepEqual(writes, [{ key: DIAGNOSTICS_KEY, value: OPT_OUT }]);
  });

  it("a write that fails is reported and does NOT undo the in-session choice", async () => {
    stored = OPT_IN;
    const tree = await mount();
    calls.length = 0;
    writeError = new Error("QuotaExceededError");

    seen!.setDiagnosticsEnabled(false);
    await settle();
    tree.rerender();

    // The SDKs are down for this session whatever the disk did — the opposite
    // order (persist, then act on it) would keep collecting from a user who
    // just said stop, because their store was full.
    assert.deepEqual(started(), []);
    assert.equal(seen?.diagnosticsEnabled, false);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].context.scope, "diagnostics-context.setItem");
  });
});
