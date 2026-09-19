import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactElement } from "react";

import {
  autoUnmount,
  installNativeModuleStubs,
  mockModule,
  render,
  type RenderResult,
} from "./helpers/render";
import { findMotionDrivers, findUnaskedAnimations } from "@/lib/check-reduced-motion";

import { readRepoFile } from "./helpers/repo-file";
import { sourceFiles } from "./helpers/source-files";

/**
 * "Reduce motion", which four animated surfaces ignored until today.
 *
 * ## Why the cases are not "duration is 0"
 *
 * The naive reading of this setting is `duration: reduced ? 0 : ms`, and it is
 * wrong in two of the three shapes this app has. A transition whose completion
 * callback changes the tab or closes the sheet must still RUN, so zero is
 * right there and skipping it would strand the user mid-gesture. A spring back
 * to rest has nothing waiting on it, so the instant equivalent is `setValue`
 * — a zero-duration spring is still a spring. And a LOOP must not start at
 * all: `Animated.loop` of a 0ms timing is a frame callback that never stops,
 * which is a battery drain handed to the person who asked for less.
 *
 * So the arithmetic is asserted by being called, and each surface's choice
 * among the three is asserted where that choice is written — the one thing a
 * `duration` assertion cannot distinguish.
 *
 * ## The default, and why it is the way round it is
 *
 * `false` when the platform cannot answer. An app that read a missing API as
 * "the user wants no motion" would silently drop every animation on a platform
 * whose only fault is not implementing the query, and nobody would know why.
 */

/** Reassigned per case; the hook reads this through the mocked module. */
let reduceMotionAnswer: Promise<boolean> = Promise.resolve(false);

/** Every `reduceMotionChanged` listener registered, and whether it was removed. */
type MotionSubscription = {
  readonly onChange: (enabled: boolean) => void;
  removed: boolean;
};

const subscriptions: MotionSubscription[] = [];

mockModule("react-native", {
  AccessibilityInfo: {
    isReduceMotionEnabled: () => reduceMotionAnswer,
    addEventListener: (_event: string, onChange: (enabled: boolean) => void) => {
      const subscription: MotionSubscription = { onChange, removed: false };
      subscriptions.push(subscription);
      return {
        remove: () => {
          subscription.removed = true;
        },
      };
    },
  },
});

installNativeModuleStubs();
autoUnmount();

type MotionModule = typeof import("../lib/reduced-motion");

let hook: MotionModule | null = null;

/**
 * The module, loaded lazily.
 *
 * A static `import` at the top of this file would resolve `react-native`
 * before `mockModule` had replaced it, and the real package does not survive
 * esbuild's transform — the failure is a parse error in `react-native/index.js`
 * rather than anything about this suite.
 */
async function motion(): Promise<MotionModule> {
  hook ??= await import("../lib/reduced-motion");
  return hook;
}

/** What the probe last rendered with, so a case can read the current value. */
let seen: boolean[] = [];

async function mountProbe(): Promise<RenderResult> {
  const { useReducedMotion } = await motion();
  function Probe() {
    seen.push(useReducedMotion());
    return null;
  }
  return render(createElement(Probe) as ReactElement);
}

let tree: RenderResult | null = null;

/**
 * Let the platform's promise settle, then re-render.
 *
 * The hook's initial read resolves outside React's event system, so the state
 * it sets does not schedule a pass in this harness — `rerender()` is how a
 * case asks for the one the real reconciler would have run on its own.
 */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  tree?.rerender();
}

beforeEach(() => {
  tree?.unmount();
  tree = null;
  seen = [];
  subscriptions.length = 0;
  reduceMotionAnswer = Promise.resolve(false);
});

describe("motionDuration", () => {
  it("collapses a duration to nothing when motion is reduced", async () => {
    const { motionDuration } = await motion();
    assert.equal(motionDuration(220, true), 0);
    assert.equal(motionDuration(1300, true), 0);
  });

  it("leaves the duration alone otherwise", async () => {
    const { motionDuration } = await motion();
    assert.equal(motionDuration(220, false), 220);
    assert.equal(motionDuration(0, false), 0);
  });
});

describe("useReducedMotion", () => {
  it("allows motion until the platform says otherwise", () => {
    // The way round it has to be: a missing or slow API must not silently drop
    // every animation in the app.
    assert.deepEqual(seen, []);
  });

  it("reports the setting once the platform has answered", async () => {
    reduceMotionAnswer = Promise.resolve(true);
    tree = await mountProbe();
    await settle();

    assert.equal(seen[0], false, "the first render cannot know yet");
    assert.equal(seen[seen.length - 1], true);
  });

  it("stays out of the way when the setting is off", async () => {
    tree = await mountProbe();
    await settle();

    assert.ok(seen.every((value) => value === false));
  });

  it("hears the setting being turned ON mid-session", async () => {
    // The moment it most needs to be heard: the user is turning this on
    // BECAUSE something in this app made them ill, and a value read once at
    // mount would leave every mounted surface animating until they navigated
    // away and back.
    tree = await mountProbe();
    await settle();

    assert.equal(subscriptions.length, 1);
    subscriptions[0].onChange(true);
    tree.rerender();

    assert.equal(seen[seen.length - 1], true);
  });

  it("hears it being turned off again", async () => {
    reduceMotionAnswer = Promise.resolve(true);
    tree = await mountProbe();
    await settle();
    assert.equal(seen[seen.length - 1], true, "the case starts from the setting being ON");

    subscriptions[0].onChange(false);
    tree.rerender();

    assert.equal(seen[seen.length - 1], false);
  });

  it("removes its subscription on unmount", async () => {
    tree = await mountProbe();
    tree.unmount();
    tree = null;

    assert.equal(subscriptions[0].removed, true);
  });

  it("survives a platform whose query rejects", async () => {
    // `isReduceMotionEnabled` is a promise and a platform may simply not
    // implement it; an unhandled rejection here would be a crash on mount of
    // every animated surface.
    reduceMotionAnswer = Promise.reject(new Error("unimplemented"));
    tree = await mountProbe();
    await reduceMotionAnswer.catch(() => undefined);
    await settle();

    assert.ok(seen.every((value) => value === false));
  });
});

describe("every animated surface consults the setting", () => {
  it("stops the skeleton loop rather than running it at zero", () => {
    // `Animated.loop` of a 0ms timing is a frame callback that never stops.
    const src = readRepoFile("components/skeleton.tsx");
    assert.match(src, /if \(reducedMotion\) \{\n\s+anim\.setValue\(0\);\n\s+return;\n\s+\}/);
    assert.match(src, /Animated\.loop\(/);
  });

  it("parks the skeleton's shimmer at rest rather than wherever it stopped", () => {
    // The loop's cleanup is `loop.stop()`, which freezes the value where it
    // had got to. Turning the setting on mid-sweep is the ordinary case — it
    // is turned on BECAUSE something animated — and without the reset the
    // highlight band stays parked across the middle of the box for good, which
    // is the opposite of the "keeps its base colour" the comment promises.
    const src = readRepoFile("components/skeleton.tsx");
    const reset = src.indexOf("anim.setValue(0)");
    const loopStart = src.indexOf("Animated.loop(");
    assert.ok(reset > 0, "the reduced branch must return the value to rest");
    assert.ok(reset < loopStart, "and it must do so before the loop is built, not after");
    assert.doesNotMatch(
      src,
      /Animated\.timing\(anim, \{\s*toValue: 0/,
      "a spring or timing back to rest has nothing waiting on it — setValue is the instant equivalent",
    );
  });

  it("collapses the toast entrance rather than skipping it", () => {
    // The toast still has to reach `opacity: 1`; it just does not slide.
    const src = readRepoFile("components/toast-host.tsx");
    assert.match(src, /duration: motionDuration\(220, reducedMotion\)/);
  });

  it("keeps the pager's committing transition, at zero", () => {
    // Its completion callback is what changes the tab.
    const src = readRepoFile("components/swipe-tabs.tsx");
    assert.match(src, /duration: motionDuration\(ANIM_DURATION, reducedMotion\.current\)/);
    assert.match(src, /translateX\.setValue\(0\);\n      return;/, "and the spring back is a setValue");
  });

  it("keeps the wishlist sheet's dismissal, at zero, and snaps its spring", () => {
    // The dismissal's callback closes the sheet; the spring back has nothing
    // waiting on it.
    const src = readRepoFile("app/wishlist.tsx");
    assert.match(src, /duration: motionDuration\(200, reducedMotion\.current\)/);
    assert.match(src, /} else if \(reducedMotion\.current\) \{\n\s+\/\/[\s\S]*?sheetTranslateY\.setValue\(0\);/);
  });

  it("reads the setting through a ref wherever a PanResponder needs it", () => {
    // Both pan responders are built inside `useRef(...).current` and never
    // rebuilt, so a captured value would be the first render's, forever.
    for (const file of ["components/swipe-tabs.tsx", "app/wishlist.tsx"]) {
      assert.match(readRepoFile(file), /useReducedMotionRef\(\)/, `${file} must read through a ref`);
    }
  });

  it("leaves no animated surface that never asks", () => {
    // The floor under the five above, and it used to BE the list of four
    // filenames the five are about — green on the day it was written and
    // silent about the fifth surface somebody adds next month. `npm run
    // lint:reduced-motion` walks app/ + components/ + lib/ and asks the
    // question of whatever it finds, so the list is derived now; this case is
    // the same claim, stated where a reader of this sweep will look for it.
    const animated = sourceFiles("app", "components", "lib").filter(
      (file) => findMotionDrivers(file, readRepoFile(file)).length > 0,
    );
    assert.ok(animated.length > 0, "the scanner matched no animation at all");
    assert.deepEqual(
      animated.flatMap((file) => findUnaskedAnimations(file, readRepoFile(file))),
      [],
      "every animated surface must import @/lib/reduced-motion",
    );
  });
});
