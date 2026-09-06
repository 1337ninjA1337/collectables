import { describe, it, beforeEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactElement } from "react";

import { setupFakeDom, type FakeDom } from "./helpers/fake-dom";
import {
  autoUnmount,
  installNativeModuleStubs,
  mockModule,
  render,
  type RenderResult,
} from "./helpers/render";

/**
 * `useVisibilityRefresh` — the poll behind both chat screens, run at last.
 *
 * ## Why it had no suite, and what it was hiding
 *
 * `suite-named-modules.test.ts` listed it as "a hook over AppState; needs a
 * render harness". It is the third of the census's entries to close and the
 * first to be hiding something: the WEB branch with no `document` returned
 * `() => {}` as its cleanup, having already started an interval two lines
 * above. Nothing cleared it. The tree unmounted, `refreshFn` kept firing every
 * `intervalMs` for the life of the process, and every closure it held stayed
 * reachable — in a hook whose whole purpose is to stop polling when nobody is
 * looking.
 *
 * That path is not hypothetical. `Platform.OS === "web"` with no `document` is
 * a web bundle evaluated outside a browser: the static export
 * `scripts/build-spa-fallback.ts` produces, and any prerender pass. It is also
 * exactly the environment this suite runs in, which is why the case that
 * catches it costs nothing to write once the module can be loaded at all.
 *
 * ## What is faked, and why the module list is short
 *
 * `react-native` is mocked rather than stubbed. The stub in `helpers/stubs/`
 * pins `Platform.OS` to `"web"` — correct for the components it was written
 * for, and this hook has two branches. The mock's `Platform` is a mutable
 * object the cases reassign, so the native half is reachable in the same
 * process, and its `AppState.addEventListener` records the listener and its
 * `remove()` instead of dropping both on the floor.
 *
 * `document` comes from `helpers/fake-dom.ts`, which grew `hidden`,
 * `addEventListener` and `setHidden` for this suite. The listener registry is
 * what the unmount case asserts against: a handler still registered after the
 * tree is down is the leak, stated as the leak rather than as a refresh count.
 *
 * Intervals go through `t.mock.timers`, so "every 30 seconds" is one `tick`
 * and a paused poll is a tick that changes nothing.
 */

/** Reassigned per case, so both branches of the hook are reachable here. */
const platform: { OS: string } = { OS: "web" };

/** Every `AppState` listener the hook registered, and whether it was removed. */
type AppStateSubscription = {
  readonly onChange: (state: string) => void;
  removed: boolean;
};

const appStateSubscriptions: AppStateSubscription[] = [];

mockModule("react-native", {
  Platform: platform,
  AppState: {
    currentState: "active",
    addEventListener: (_event: string, onChange: (state: string) => void) => {
      const subscription: AppStateSubscription = { onChange, removed: false };
      appStateSubscriptions.push(subscription);
      return {
        remove: () => {
          subscription.removed = true;
        },
      };
    },
  },
});

installNativeModuleStubs();
// Ends every tree a case rendered, including the cases that fail early — and
// it runs BEFORE the `beforeEach` below restores the real globals, so a
// cleanup that touches `document` still finds the fake one it registered on.
autoUnmount();

type VisibilityModule = typeof import("../lib/use-visibility-refresh");

let hook: VisibilityModule | null = null;

const INTERVAL_MS = 30_000;

/** Refresh calls, in order, so a paused poll reads as a count that stopped. */
let refreshes = 0;

/** Mounts a probe that does nothing but run the hook. */
async function mountProbe(intervalMs = INTERVAL_MS): Promise<RenderResult> {
  hook ??= await import("../lib/use-visibility-refresh");
  const useVisibilityRefresh = hook.useVisibilityRefresh;
  function Probe() {
    useVisibilityRefresh(() => {
      refreshes += 1;
    }, intervalMs);
    return null;
  }
  return render(createElement(Probe) as ReactElement);
}

/** The fake DOM for the case that wants one; torn down in `beforeEach`. */
let dom: FakeDom | null = null;

/** The tree a case mounted, unmounted in `beforeEach` even when it failed. */
let tree: RenderResult | null = null;

beforeEach(() => {
  tree?.unmount();
  tree = null;
  dom?.restore();
  dom = null;
  refreshes = 0;
  appStateSubscriptions.length = 0;
  platform.OS = "web";
});

/** Mocked intervals, per case — the runner restores them when the case ends. */
function useFakeIntervals(t: TestContext): void {
  t.mock.timers.enable({ apis: ["setInterval"] });
}

describe("useVisibilityRefresh — the poll itself", () => {
  it("refreshes once on mount, before any interval has elapsed", async (t) => {
    useFakeIntervals(t);
    dom = setupFakeDom();

    tree = await mountProbe();

    // The screens that use this render an empty list until the first refresh
    // returns, so a hook that waited a full interval would show one for 30
    // seconds on every open.
    assert.equal(refreshes, 1);
  });

  it("refreshes again every interval", async (t) => {
    useFakeIntervals(t);
    dom = setupFakeDom();
    tree = await mountProbe();

    t.mock.timers.tick(INTERVAL_MS);
    t.mock.timers.tick(INTERVAL_MS);

    assert.equal(refreshes, 3);
  });

  it("calls the latest callback, not the one it mounted with", async (t) => {
    // The hook keeps `refreshFn` in a ref and depends only on `intervalMs`, so
    // a screen re-rendering with a new closure must not restart the interval —
    // and must not keep calling the closure from the first pass either.
    useFakeIntervals(t);
    dom = setupFakeDom();
    hook ??= await import("../lib/use-visibility-refresh");
    const useVisibilityRefresh = hook.useVisibilityRefresh;
    const called: string[] = [];
    let label = "first";
    function Probe() {
      useVisibilityRefresh(() => called.push(label), INTERVAL_MS);
      return null;
    }
    tree = render(createElement(Probe) as ReactElement);

    label = "second";
    tree.rerender();
    t.mock.timers.tick(INTERVAL_MS);

    assert.deepEqual(called, ["first", "second"]);
  });
});

describe("useVisibilityRefresh on the web", () => {
  it("stops polling while the tab is hidden and resumes with an immediate refresh", async (t) => {
    useFakeIntervals(t);
    dom = setupFakeDom();
    tree = await mountProbe();
    assert.equal(refreshes, 1);

    dom.setHidden(true);
    t.mock.timers.tick(INTERVAL_MS * 3);
    assert.equal(refreshes, 1, "a hidden tab must not poll");

    dom.setHidden(false);
    // Immediately, not on the next interval: the data on screen is as stale as
    // the time the tab was away, and that is the moment somebody is looking.
    assert.equal(refreshes, 2);

    t.mock.timers.tick(INTERVAL_MS);
    assert.equal(refreshes, 3, "the interval must be running again");
  });

  it("does not stack intervals when the same visibility state repeats", async (t) => {
    useFakeIntervals(t);
    dom = setupFakeDom();
    tree = await mountProbe();

    dom.setHidden(false);
    dom.setHidden(false);
    t.mock.timers.tick(INTERVAL_MS);

    // `resume()` is guarded on the handle being null. Without that guard each
    // redundant event leaves another live interval behind and the poll rate
    // doubles every time the tab is focused.
    assert.equal(refreshes, 2);
  });

  it("removes its listener and stops polling on unmount", async (t) => {
    useFakeIntervals(t);
    dom = setupFakeDom();
    tree = await mountProbe();
    assert.equal(dom.listeners.visibilitychange?.length, 1);

    tree.unmount();
    tree = null;

    assert.deepEqual(dom.listeners.visibilitychange, []);
    t.mock.timers.tick(INTERVAL_MS * 3);
    assert.equal(refreshes, 1);
  });

  it("stops polling on unmount even where there is no document at all", async (t) => {
    // The static export and any prerender pass: `Platform.OS === "web"` with no
    // DOM. This branch returned an empty cleanup while an interval was already
    // running, so the poll — and every closure it held — outlived the tree for
    // the life of the process.
    useFakeIntervals(t);
    assert.equal(typeof (globalThis as { document?: unknown }).document, "undefined");

    tree = await mountProbe();
    assert.equal(refreshes, 1);

    tree.unmount();
    tree = null;

    t.mock.timers.tick(INTERVAL_MS * 3);
    assert.equal(refreshes, 1, "the interval outlived the tree");
  });
});

describe("useVisibilityRefresh on native", () => {
  it("pauses when the app leaves the foreground and resumes on active", async (t) => {
    useFakeIntervals(t);
    platform.OS = "ios";
    tree = await mountProbe();
    assert.equal(appStateSubscriptions.length, 1);
    const [subscription] = appStateSubscriptions;

    subscription.onChange("background");
    t.mock.timers.tick(INTERVAL_MS * 3);
    assert.equal(refreshes, 1);

    subscription.onChange("active");
    assert.equal(refreshes, 2);
    t.mock.timers.tick(INTERVAL_MS);
    assert.equal(refreshes, 3);
  });

  it("treats iOS's transient inactive state as away", async (t) => {
    // `inactive` is the state during a call banner or the app switcher. It is
    // not `active`, so it pauses — which is the branch the hook writes as an
    // else and nothing else in the tree states.
    useFakeIntervals(t);
    platform.OS = "ios";
    tree = await mountProbe();

    appStateSubscriptions[0].onChange("inactive");
    t.mock.timers.tick(INTERVAL_MS * 2);

    assert.equal(refreshes, 1);
  });

  it("removes the subscription and stops polling on unmount", async (t) => {
    useFakeIntervals(t);
    platform.OS = "ios";
    tree = await mountProbe();

    tree.unmount();
    tree = null;

    assert.equal(appStateSubscriptions[0].removed, true);
    t.mock.timers.tick(INTERVAL_MS * 3);
    assert.equal(refreshes, 1);
  });

  it("registers no DOM listener on native, even with a document present", async (t) => {
    useFakeIntervals(t);
    dom = setupFakeDom();
    platform.OS = "ios";

    tree = await mountProbe();

    assert.deepEqual(dom.listeners, {});
    assert.equal(appStateSubscriptions.length, 1);
  });
});
