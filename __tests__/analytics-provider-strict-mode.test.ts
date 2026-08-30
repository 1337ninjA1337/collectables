import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement, StrictMode, type ReactElement } from "react";

import { autoUnmount, installNativeModuleStubs, mockModule, render } from "./helpers/render";

/**
 * The real Strict-Mode mount test for `<AnalyticsProvider>`.
 *
 * This suite was parked for a month as `[needs-dev-dep]` — a real
 * `<React.StrictMode>` mount seemed to need jsdom or react-test-renderer. It
 * does not: `__tests__/helpers/render.ts` mounts components with no new
 * dependency and reproduces StrictMode's double-invoke (each body runs twice
 * per pass; each effect is mounted, cleaned up and mounted again), which is
 * precisely the shape the invariant here is about.
 *
 * The invariant: `identifyUser` fires exactly ONCE per real user change, no
 * matter how many times React mounts the effect. `createIdentifyScheduler`'s
 * 500ms debounce is what collapses the double-mount, and
 * `identify-scheduler.test.ts` already pins that in isolation with mock timers.
 * What could not be checked until now is that the PROVIDER feeds the scheduler
 * in a way that survives a double-mount — a `useRef` that was a `useState`, or
 * a scheduler constructed in the effect instead of the ref, would pass the
 * scheduler's own tests and still double-charge the identify quota.
 *
 * Everything around the provider is mocked: the four sibling contexts it
 * consumes reach supabase and the network, and mounting them for real would
 * make this a test of the whole provider tree.
 */

installNativeModuleStubs();
// Ends every tree a case rendered, including the cases that fail early.
autoUnmount();

type Identity = { id: string } | null;

const identifyCalls: { userId: string; traits: unknown }[] = [];
const resetCalls: number[] = [];
const trackCalls: { name: string; props: unknown }[] = [];

/**
 * Mutable state the mocked hooks read. Reassigned between renders to simulate
 * sign-in / sign-out / a trait change, then re-rendered — the hooks themselves
 * stay the same function identities, which is what `mockModule` requires.
 */
let currentUser: Identity = null;
let currentLanguage = "ru";
let currentIsPremium = false;
let currentDiagnosticsEnabled = true;

mockModule("@/lib/analytics", {
  identifyUser: (userId: string, traits?: unknown) => identifyCalls.push({ userId, traits }),
  resetUser: () => resetCalls.push(resetCalls.length),
  trackEvent: (name: string, props?: unknown) => trackCalls.push({ name, props }),
});
mockModule("@/lib/auth-context", { useAuth: () => ({ user: currentUser }) });
mockModule("@/lib/i18n-context", { useI18n: () => ({ language: currentLanguage }) });
mockModule("@/lib/premium-context", { usePremium: () => ({ isPremium: currentIsPremium }) });
mockModule("@/lib/diagnostics-context", {
  useDiagnostics: () => ({ diagnosticsEnabled: currentDiagnosticsEnabled }),
});

async function mountProvider(options: { strict: boolean }) {
  const { AnalyticsProvider, IDENTIFY_DEBOUNCE_MS } = await import("@/lib/analytics-provider");
  const provider = createElement(AnalyticsProvider, null, createElement("View", null)) as ReactElement;
  return {
    debounceMs: IDENTIFY_DEBOUNCE_MS,
    tree: render(options.strict ? createElement(StrictMode, null, provider) : provider),
  };
}

beforeEach(() => {
  identifyCalls.length = 0;
  resetCalls.length = 0;
  trackCalls.length = 0;
  currentUser = null;
  currentLanguage = "ru";
  currentIsPremium = false;
  currentDiagnosticsEnabled = true;
});

describe("<AnalyticsProvider> under <React.StrictMode>", () => {
  it("fires identifyUser exactly once for a signed-in user despite the double-mount", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    currentUser = { id: "user-1" };

    const { debounceMs } = await mountProvider({ strict: true });
    assert.equal(identifyCalls.length, 0, "the identify is debounced, never synchronous");

    t.mock.timers.tick(debounceMs);
    assert.equal(identifyCalls.length, 1, "StrictMode's remount must collapse into one identify");
    assert.equal(identifyCalls[0].userId, "user-1");
    assert.deepEqual(identifyCalls[0].traits, { language: "ru", isPremium: false });
  });

  it("fires the same single identify without StrictMode — the mode changes nothing observable", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    currentUser = { id: "user-1" };

    const { debounceMs } = await mountProvider({ strict: false });
    t.mock.timers.tick(debounceMs);
    assert.equal(identifyCalls.length, 1);
  });

  it("fires once more per REAL user change, and not for a re-render at the same identity", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    currentUser = { id: "user-1" };

    const { tree, debounceMs } = await mountProvider({ strict: true });
    t.mock.timers.tick(debounceMs);
    assert.equal(identifyCalls.length, 1);

    // Same user object, nothing changed: the effect's deps are identical, so
    // no new identify is scheduled.
    tree.rerender();
    t.mock.timers.tick(debounceMs);
    assert.equal(identifyCalls.length, 1, "a re-render at the same identity must not re-identify");

    // A genuinely different user.
    currentUser = { id: "user-2" };
    tree.rerender();
    t.mock.timers.tick(debounceMs);
    assert.equal(identifyCalls.length, 2);
    assert.equal(identifyCalls[1].userId, "user-2");
  });

  it("collapses a trait change landing inside the debounce window into one identify", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    currentUser = { id: "user-1" };

    const { tree, debounceMs } = await mountProvider({ strict: true });
    t.mock.timers.tick(debounceMs / 2);

    // Premium unlock + language switch arriving mid-window — the exact
    // sequence the debounce was added for.
    currentIsPremium = true;
    currentLanguage = "en";
    tree.rerender();
    t.mock.timers.tick(debounceMs);

    assert.equal(identifyCalls.length, 1, "only the settled call within the window may fire");
    assert.deepEqual(identifyCalls[0].traits, { language: "en", isPremium: true });
  });

  it("resets synchronously on sign-out, and only when an identify actually fired", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    currentUser = { id: "user-1" };

    const { tree, debounceMs } = await mountProvider({ strict: true });
    t.mock.timers.tick(debounceMs);
    assert.equal(identifyCalls.length, 1);

    currentUser = null;
    tree.rerender();
    assert.equal(resetCalls.length, 1, "a stale identity must not outlive the session");
  });

  it("does not reset when the pending identify was cancelled before it fired", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    currentUser = { id: "user-1" };

    const { tree } = await mountProvider({ strict: true });
    currentUser = null;
    tree.rerender();

    assert.equal(identifyCalls.length, 0);
    assert.equal(resetCalls.length, 0, "a cancelled identify leaves no phantom identity to reset");
  });

  it("keeps one scheduler across the double-mount — no pending identify survives a remount", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    currentUser = { id: "user-1" };

    // The cleanup effect calls `scheduler.dispose()`, which cancels the timer.
    // StrictMode runs mount → cleanup → mount, so a provider that built its
    // scheduler per-effect (rather than in a lazily-initialised ref) would end
    // up with the first mount's armed timer still pending under a scheduler
    // nobody disposed — and would fire twice here.
    const { debounceMs } = await mountProvider({ strict: true });
    t.mock.timers.tick(debounceMs * 4);
    assert.equal(identifyCalls.length, 1);
  });
});

describe("<AnalyticsProvider> — context value", () => {
  it("exposes optedOut as the inverse of the diagnostics toggle", async () => {
    const { AnalyticsProvider, useAnalytics } = await import("@/lib/analytics-provider");

    let seen: { optedOut: boolean } | null = null;
    function Probe() {
      seen = useAnalytics();
      return null;
    }

    currentDiagnosticsEnabled = true;
    render(createElement(AnalyticsProvider, null, createElement(Probe)) as ReactElement);
    assert.equal(seen!.optedOut, false);

    currentDiagnosticsEnabled = false;
    render(createElement(AnalyticsProvider, null, createElement(Probe)) as ReactElement);
    assert.equal(seen!.optedOut, true);
  });

  it("throws a provider-order error when useAnalytics is called outside the provider", async () => {
    const { useAnalytics } = await import("@/lib/analytics-provider");
    function Orphan() {
      useAnalytics();
      return null;
    }
    assert.throws(
      () => render(createElement(Orphan) as ReactElement),
      /useAnalytics must be used inside <AnalyticsProvider>/,
    );
  });
});
