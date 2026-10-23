import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactElement } from "react";

import {
  autoUnmount,
  installNativeModuleStubs,
  render,
  type RenderResult,
} from "./helpers/render";

/**
 * `useMountedRef` — "is this component still here", for the closure that
 * outlived it.
 *
 * Four hand-written copies before it: a pull-to-refresh that resolved after
 * the user navigated away, the chat composer's in-flight state, and the two
 * create forms, whose `finally` runs after their own `router.replace` has
 * taken the screen down.
 *
 * The cases are about the two transitions, because the value is only ever read
 * from a closure and there is nothing else to assert: it reads `true` while
 * mounted, and `false` from the same ref object after the tree is gone. The
 * ref IDENTITY is the third case — a caller captures it once, in a handler
 * built before the unmount, so a hook that handed back a new object per render
 * would report `true` forever from the one that was captured.
 */
installNativeModuleStubs();
autoUnmount();

type MountedModule = typeof import("../lib/use-mounted-ref");

let hook: MountedModule | null = null;

/** The ref objects the probe saw, one per render. */
let seen: { current: boolean }[] = [];

// Imported inside the probe rather than at the top level: a top-level `await`
// makes this module async, and node's test runner requires it synchronously.
async function mountProbe(): Promise<RenderResult> {
  hook ??= await import("../lib/use-mounted-ref");
  const useMountedRef = hook.useMountedRef;
  function Probe() {
    seen.push(useMountedRef());
    return null;
  }
  return render(createElement(Probe) as ReactElement);
}

let tree: RenderResult | null = null;

beforeEach(() => {
  tree?.unmount();
  tree = null;
  seen = [];
});

describe("useMountedRef", () => {
  it("reads true while the component is mounted", async () => {
    tree = await mountProbe();
    assert.equal(seen[0].current, true);
  });

  it("reads false from the captured ref after the tree is gone", async () => {
    // The whole point: the closure that reads this runs when the component
    // does not exist, so the answer has to survive on an object it already
    // holds.
    tree = await mountProbe();
    const captured = seen[0];

    tree.unmount();
    tree = null;

    assert.equal(captured.current, false);
  });

  it("hands back the same ref object on every render", async () => {
    // A new object per render would leave a handler built on an early render
    // reading `true` forever — which is the bug, not a smaller version of it.
    tree = await mountProbe();
    tree.rerender();
    tree.rerender();

    assert.ok(seen.length >= 3, "the probe rendered three times");
    for (const ref of seen) assert.equal(ref, seen[0]);
  });

  it("reports true again when a re-mount follows an unmount", async () => {
    // Strict Mode mounts, unmounts and re-mounts, so the cleanup's `false` has
    // to be undone by the next MOUNT. This is why the assignment is in the
    // effect rather than in the render body, where `useLatestRef` puts its own.
    tree = await mountProbe();
    const first = seen[0];
    tree.unmount();
    assert.equal(first.current, false);

    seen = [];
    tree = await mountProbe();
    assert.equal(seen[0].current, true, "a fresh mount starts mounted");
  });
});
