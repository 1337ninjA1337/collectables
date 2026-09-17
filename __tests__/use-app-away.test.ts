import { describe, it, beforeEach } from "node:test";
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
 * `useAppAway` — the departure signal, on both platforms.
 *
 * ## What it is for, and why the cases are about ABSENCE
 *
 * The toast overlay holds its dismissal timer while a pointer is on it, and a
 * browser does not promise the `onHoverOut` that would release it: alt-tab away
 * mid-hover and no pointer event is ever sent again. `toastHoldCeilingMs`
 * bounds that at four windows; this hook ENDS it, and keeps the ceiling a
 * backstop rather than the ordinary path.
 *
 * So the interesting cases are the ones where nothing arrives. Two web events,
 * because they are two different absences — a hidden tab and a blurred window,
 * the second of which `document.hidden` reports as `false` — and the two halves
 * of each: that a departure fires the callback, and that a RETURN does not.
 *
 * ## The leak, stated as a leak
 *
 * A hook that registers listeners on globals has one failure worse than being
 * wrong, and it is the one no behavioural assertion about callbacks can see: a
 * handler still registered after the tree is down, holding every closure it
 * captured, firing at a component that no longer exists. `fake-dom.ts`'s two
 * registries are what says so directly, and `windowListeners` was added here
 * for exactly that — `window` is a second surface, not an alias of `document`,
 * and a hook listening on the wrong one would otherwise pass.
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
// Ends every tree a case rendered, including the ones that failed early — and
// it runs BEFORE the `beforeEach` below restores the real globals, so a
// cleanup that touches `document` still finds the fake one it registered on.
autoUnmount();

type AwayModule = typeof import("../lib/use-app-away");

let hook: AwayModule | null = null;

/** Departures reported, in order — a count that moved is the whole assertion. */
let departures = 0;

/** Mounts a probe that does nothing but run the hook. */
async function mountProbe(): Promise<RenderResult> {
  hook ??= await import("../lib/use-app-away");
  const useAppAway = hook.useAppAway;
  function Probe() {
    useAppAway(() => {
      departures += 1;
    });
    return null;
  }
  return render(createElement(Probe) as ReactElement);
}

let dom: FakeDom | null = null;
let tree: RenderResult | null = null;

beforeEach(() => {
  tree?.unmount();
  tree = null;
  dom?.restore();
  dom = null;
  departures = 0;
  appStateSubscriptions.length = 0;
  platform.OS = "web";
});

describe("useAppAway — on the web", () => {
  it("reports a departure when the tab is hidden", async () => {
    dom = setupFakeDom();
    tree = await mountProbe();

    dom.setHidden(true);

    assert.equal(departures, 1);
  });

  it("does NOT report the return trip", async () => {
    // `visibilitychange` fires both ways and carries no direction; the flag
    // does. Reporting a return as a departure would cancel a hold the user has
    // just come back to.
    dom = setupFakeDom();
    tree = await mountProbe();

    dom.setHidden(true);
    dom.setHidden(false);

    assert.equal(departures, 1);
  });

  it("reports a window that lost focus while its tab stayed visible", async () => {
    // The alt-tab case, and the commonest way a desktop user leaves.
    // `document.hidden` is `false` throughout, so a hook listening only for
    // `visibilitychange` would report nothing at all here.
    dom = setupFakeDom();
    tree = await mountProbe();

    dom.fireWindow("blur");

    assert.equal(departures, 1);
    assert.equal(dom.listeners.visibilitychange?.length, 1, "and still listening for the other");
  });

  it("counts each departure, so a hold cannot survive two of them", async () => {
    dom = setupFakeDom();
    tree = await mountProbe();

    dom.setHidden(true);
    dom.setHidden(false);
    dom.fireWindow("blur");

    assert.equal(departures, 2);
  });

  it("registers on both surfaces, and leaves neither behind on unmount", async () => {
    // The leak, stated as the leak: a handler still registered after the tree
    // is down holds every closure it captured and fires at a component that
    // no longer exists.
    dom = setupFakeDom();
    tree = await mountProbe();

    assert.equal(dom.listeners.visibilitychange?.length, 1);
    assert.equal(dom.windowListeners.blur?.length, 1);

    tree.unmount();
    tree = null;

    assert.deepEqual(dom.listeners.visibilitychange, []);
    assert.deepEqual(dom.windowListeners.blur, []);
  });

  it("mounts and unmounts cleanly with no browser globals at all", async () => {
    // `Platform.OS === "web"` with no `document` is a web bundle evaluated
    // outside a browser: the static export `scripts/build-spa-fallback.ts`
    // produces, and any prerender pass. Nothing to listen to, nothing to
    // clean up, and nothing to throw on either side of the mount.
    const g = globalThis as { window?: unknown; document?: unknown };
    assert.equal(typeof g.document, "undefined", "a previous case leaked a fake DOM");

    tree = await mountProbe();
    tree.unmount();
    tree = null;

    assert.equal(departures, 0);
  });
});

describe("useAppAway — on native", () => {
  it("reports every state that is not active", async () => {
    // iOS's `"inactive"` is a notification shade or an incoming call, and it
    // is as much "the user is not looking" as a full background.
    platform.OS = "ios";
    tree = await mountProbe();

    assert.equal(appStateSubscriptions.length, 1);
    appStateSubscriptions[0].onChange("background");
    appStateSubscriptions[0].onChange("inactive");

    assert.equal(departures, 2);
  });

  it("does not report a return to active", async () => {
    platform.OS = "android";
    tree = await mountProbe();

    appStateSubscriptions[0].onChange("background");
    appStateSubscriptions[0].onChange("active");

    assert.equal(departures, 1);
  });

  it("removes its subscription on unmount", async () => {
    platform.OS = "ios";
    tree = await mountProbe();
    tree.unmount();
    tree = null;

    assert.equal(appStateSubscriptions[0].removed, true);
  });

  it("does not touch the DOM on native, even when one is there", async () => {
    // react-native-web is not the only way a `document` is in scope; a native
    // branch that registered browser listeners anyway would double-report on
    // every platform that has both.
    platform.OS = "ios";
    dom = setupFakeDom();
    tree = await mountProbe();

    assert.equal(dom.listeners.visibilitychange, undefined);
    assert.equal(dom.windowListeners.blur, undefined);
  });
});
