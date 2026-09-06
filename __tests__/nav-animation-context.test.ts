import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactElement } from "react";

import { providerHarness } from "./helpers/mount-provider";
import { autoUnmount, installNativeModuleStubs, render } from "./helpers/render";

/**
 * `NavAnimationProvider`, mounted — the direction the next screen slides from.
 *
 * ## Why it had no suite
 *
 * `suite-named-modules.test.ts` found it, and its exemption comment said "a
 * provider; needs the mount harness". That is the whole cost: this provider
 * imports nothing but React, so no module is mocked here at all. It is the
 * only one of the app's eight providers with that property, which is why it
 * was the next of the census's five to close.
 *
 * ## What it actually decides
 *
 * `components/bottom-nav.tsx` calls `setAnimation("slide_from_left")` before
 * navigating left along the tab bar, and `app/_layout.tsx` reads `animation`
 * into the `Stack` screen options. So the value is written by one subtree and
 * read by another on the SAME pass — which is the arrangement a stale context
 * value breaks silently: the screen slides in from the wrong side and nothing
 * throws.
 *
 * ## Three properties, and only one of them is the state
 *
 * That the value changes is the obvious one. The two that a source scan cannot
 * see are the identities: `setAnimation` is wrapped in `useCallback` with an
 * empty dependency list, and the context value in a `useMemo` — and both exist
 * for consumers, not for this module. `bottom-nav` holds the setter in its own
 * callbacks, so a setter that changed identity every pass would invalidate
 * them; a context value rebuilt every pass re-renders every consumer of the
 * tab bar on every keystroke elsewhere in the tree.
 *
 * The memo is asserted from the OUTSIDE, by mounting and comparing the object
 * a probe received across two passes. `use-analytics-hook.test.ts` makes the
 * same claim about its provider by matching `/useMemo<AnalyticsContextValue>/`
 * against the source, which holds until somebody writes the memo with the
 * wrong dependency list — the failure the assertion is for.
 */

installNativeModuleStubs();
autoUnmount();

type NavAnimationModule = typeof import("../lib/nav-animation-context");
type NavAnimationValue = ReturnType<NavAnimationModule["useNavAnimation"]>;

const harness = providerHarness<NavAnimationValue>(async () => {
  const nav = await import("../lib/nav-animation-context");
  return { Provider: nav.NavAnimationProvider, useValue: nav.useNavAnimation };
});

beforeEach(() => {
  harness.reset();
});

describe("NavAnimationProvider — the direction the next screen comes from", () => {
  it("starts at the platform default, so a first navigation is not animated sideways", async () => {
    await harness.mount();

    assert.equal(harness.value().animation, "default");
  });

  it("hands a consumer the direction another consumer set", async () => {
    // The real arrangement: `components/bottom-nav.tsx` sets it, and the
    // `Stack` in `app/_layout.tsx` reads it. Both are consumers of this
    // provider, so a value that did not propagate is a screen sliding in from
    // the wrong side with nothing thrown.
    const tree = await harness.mount();

    harness.value().setAnimation("slide_from_left");
    tree.rerender();

    assert.equal(harness.value().animation, "slide_from_left");
  });

  it("takes every direction the type allows", async () => {
    const tree = await harness.mount();
    const seen: string[] = [];

    for (const direction of ["slide_from_right", "slide_from_left", "default"] as const) {
      harness.value().setAnimation(direction);
      tree.rerender();
      seen.push(harness.value().animation);
    }

    assert.deepEqual(seen, ["slide_from_right", "slide_from_left", "default"]);
  });
});

describe("NavAnimationProvider — the identities consumers depend on", () => {
  it("keeps one setter across a state change", async () => {
    // `bottom-nav` closes over this in its own callbacks. A setter that
    // changed identity per pass would invalidate them on every navigation,
    // which is exactly the pass on which the tab bar is doing the most work.
    const tree = await harness.mount();
    const before = harness.value().setAnimation;

    before("slide_from_right");
    tree.rerender();

    assert.equal(harness.value().setAnimation, before);
  });

  it("hands out the same value object when nothing changed", async () => {
    const tree = await harness.mount();
    const before = harness.value();

    tree.rerender();

    assert.equal(harness.value(), before);
  });

  it("hands out a new value object when the direction did change", async () => {
    // The other half of the memo: stable is only correct while the state is.
    // A memo with an empty dependency list passes the case above and pins
    // every consumer to the direction the app started with.
    const tree = await harness.mount();
    const before = harness.value();

    before.setAnimation("slide_from_left");
    tree.rerender();

    assert.notEqual(harness.value(), before);
  });
});

describe("useNavAnimation outside its provider", () => {
  it("throws a provider-order error rather than reading null", async () => {
    const { useNavAnimation } = await import("../lib/nav-animation-context");
    function Orphan() {
      useNavAnimation();
      return null;
    }

    assert.throws(
      () => render(createElement(Orphan) as ReactElement),
      /useNavAnimation must be used inside NavAnimationProvider/,
    );
  });
});
