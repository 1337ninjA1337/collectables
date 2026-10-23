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
 * `useAppVisible` — "is the user looking at the app", on both platforms.
 *
 * ## What it is for, and why the cases come in pairs
 *
 * The chat screen's read receipt. `markRead(chatId)` runs from an effect keyed
 * on `messages.length`, and messages arrive on their own, so one landing in a
 * hidden tab marked itself read with nobody in front of it — and `markRead`
 * writes `upsertChatRead` as well as the local flag, so the SENDER was shown a
 * receipt the recipient never earned.
 *
 * {@link import("../lib/use-app-away").useAppAway} already reports a departure
 * and deliberately has no "back" half. This hook is the other shape: a boolean
 * read on a render, both ways, because what it gates is owed the moment the
 * user IS looking. So every case here has a return trip — a departure that is
 * not reported back is a badge that never clears, which is a worse bug than
 * the one being fixed.
 *
 * ## The two absences, and why one flag would not do
 *
 * A hidden tab and a blurred window are different events, and the second is
 * the one `document.hidden` reports as `false` (alt-tab to another app, the
 * commonest way a desktop user leaves). Both have to be false for the answer
 * to be `true`, which is why the interleaving cases are here: a single flag
 * written by two events has the second one answer for the first.
 */

/** Reassigned per case, so both branches of the hook are reachable here. */
const platform: { OS: string } = { OS: "web" };

/** Mutable so the native initial-value cases can set it before the mount. */
const appState: {
  currentState: string | null;
  addEventListener: (event: string, onChange: (state: string) => void) => { remove: () => void };
} = {
  currentState: "active",
  addEventListener: (_event, onChange) => {
    const subscription: AppStateSubscription = { onChange, removed: false };
    appStateSubscriptions.push(subscription);
    return {
      remove: () => {
        subscription.removed = true;
      },
    };
  },
};

/** Every `AppState` listener the hook registered, and whether it was removed. */
type AppStateSubscription = {
  readonly onChange: (state: string) => void;
  removed: boolean;
};

const appStateSubscriptions: AppStateSubscription[] = [];

mockModule("react-native", { Platform: platform, AppState: appState });

installNativeModuleStubs();
// Ends every tree a case rendered, including the ones that failed early — and
// it runs BEFORE the `beforeEach` below restores the real globals, so a
// cleanup that touches `document` still finds the fake one it registered on.
autoUnmount();

type VisibleModule = typeof import("../lib/use-app-visible");

let hook: VisibleModule | null = null;

/** What the hook answered on each render, in order. */
let answers: boolean[] = [];

/** Mounts a probe that does nothing but record what the hook returns. */
async function mountProbe(): Promise<RenderResult> {
  hook ??= await import("../lib/use-app-visible");
  const useAppVisible = hook.useAppVisible;
  function Probe() {
    answers.push(useAppVisible());
    return null;
  }
  return render(createElement(Probe) as ReactElement);
}

/** The hook's current answer: re-render first, because state is not a render. */
function answer(tree: RenderResult): boolean {
  tree.rerender();
  return answers[answers.length - 1];
}

let dom: FakeDom | null = null;
let tree: RenderResult | null = null;

beforeEach(() => {
  tree?.unmount();
  tree = null;
  dom?.restore();
  dom = null;
  answers = [];
  appStateSubscriptions.length = 0;
  appState.currentState = "active";
  platform.OS = "web";
});

describe("useAppVisible — on the web", () => {
  it("starts visible in a visible tab", async () => {
    dom = setupFakeDom();
    tree = await mountProbe();

    assert.equal(answers[0], true, "the first render is what gates the first effect");
  });

  it("starts hidden when the tab was already hidden at mount", async () => {
    // A conversation opened by a notification tap into a background tab, and
    // the case the initial value exists for: an effect that reads this on its
    // FIRST run would otherwise fire before any event arrives.
    dom = setupFakeDom();
    dom.setHidden(true);
    tree = await mountProbe();

    assert.equal(answers[0], false);
  });

  it("goes invisible when the tab is hidden, and visible again when it comes back", async () => {
    dom = setupFakeDom();
    tree = await mountProbe();

    dom.setHidden(true);
    assert.equal(answer(tree), false);

    dom.setHidden(false);
    assert.equal(answer(tree), true, "the return trip is the half useAppAway does not have");
  });

  it("goes invisible when the window loses focus while its tab stays visible", async () => {
    // The alt-tab case. `document.hidden` is `false` throughout, so a hook
    // listening only for `visibilitychange` would answer `true` here.
    dom = setupFakeDom();
    tree = await mountProbe();

    dom.fireWindow("blur");
    assert.equal(answer(tree), false);

    dom.fireWindow("focus");
    assert.equal(answer(tree), true);
  });

  it("stays invisible while EITHER absence holds", async () => {
    // The reason the two are tracked separately. A single flag would have the
    // `focus` answer for the hidden tab as well, and report a minimised window
    // that happened to regain focus as somebody looking at it.
    dom = setupFakeDom();
    tree = await mountProbe();

    dom.setHidden(true);
    dom.fireWindow("blur");
    assert.equal(answer(tree), false);

    dom.fireWindow("focus");
    assert.equal(answer(tree), false, "the tab is still hidden");

    dom.setHidden(false);
    assert.equal(answer(tree), true);
  });

  it("re-renders nothing when an event repeats the answer already held", async () => {
    // Two blurs are one absence. This hook returns state, so every needless
    // transition is a render in every screen that reads it.
    dom = setupFakeDom();
    tree = await mountProbe();

    dom.fireWindow("blur");
    tree.rerender();
    assert.equal(tree.dirty, false, "a settled transition left no pending state");

    dom.fireWindow("blur");
    assert.equal(tree.dirty, false, "the second blur said nothing new");
  });

  it("registers on both surfaces, and leaves nothing behind on unmount", async () => {
    // The leak no behavioural assertion can see: a handler still registered
    // after the tree is down, holding every closure it captured and setting
    // state on a component that no longer exists.
    dom = setupFakeDom();
    tree = await mountProbe();

    assert.equal(dom.listeners.visibilitychange?.length, 1);
    assert.equal(dom.windowListeners.blur?.length, 1);
    assert.equal(dom.windowListeners.focus?.length, 1);

    tree.unmount();
    tree = null;

    assert.deepEqual(dom.listeners.visibilitychange, []);
    assert.deepEqual(dom.windowListeners.blur, []);
    assert.deepEqual(dom.windowListeners.focus, []);
  });

  it("answers visible, and mounts cleanly, with no browser globals at all", async () => {
    // `Platform.OS === "web"` with no `document` is a web bundle evaluated
    // outside a browser: the static export, a prerender pass. Nothing to
    // listen to, and the answer has to be the one that leaves the caller doing
    // what it did before the gate existed.
    const g = globalThis as { window?: unknown; document?: unknown };
    assert.equal(typeof g.document, "undefined", "a previous case leaked a fake DOM");

    tree = await mountProbe();

    assert.equal(answers[0], true);
    tree.unmount();
    tree = null;
  });
});

describe("useAppVisible — on native", () => {
  it("reads the state it mounted into", async () => {
    platform.OS = "ios";
    appState.currentState = "background";
    tree = await mountProbe();

    assert.equal(answers[0], false);
  });

  it("answers visible when the platform does not know its state yet", async () => {
    // Android reports `null` until the first state is known. Unknown reads as
    // visible for the same reason the missing-`document` case does.
    platform.OS = "android";
    appState.currentState = null;
    tree = await mountProbe();

    assert.equal(answers[0], true);
  });

  it("treats every state that is not active as not looking, and reports the return", async () => {
    // iOS's `inactive` is a notification shade or an incoming call, and it is
    // as much "the user is not looking" as a full background. A list of state
    // names is a list somebody has to keep.
    platform.OS = "ios";
    tree = await mountProbe();

    assert.equal(appStateSubscriptions.length, 1);

    appStateSubscriptions[0].onChange("inactive");
    assert.equal(answer(tree), false);

    appStateSubscriptions[0].onChange("background");
    assert.equal(answer(tree), false);

    appStateSubscriptions[0].onChange("active");
    assert.equal(answer(tree), true);
  });

  it("removes its subscription on unmount", async () => {
    platform.OS = "ios";
    tree = await mountProbe();
    tree.unmount();
    tree = null;

    assert.equal(appStateSubscriptions[0].removed, true);
  });

  it("does not touch the DOM on native, even when one is there", async () => {
    // React Native Web is not the native branch; a hook that read `document`
    // on both would register a listener that never fires on a device.
    platform.OS = "android";
    dom = setupFakeDom();
    tree = await mountProbe();

    assert.deepEqual(dom.listeners.visibilitychange ?? [], []);
    assert.deepEqual(dom.windowListeners.blur ?? [], []);
  });
});
