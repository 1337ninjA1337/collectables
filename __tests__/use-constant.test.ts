/**
 * The other half of the `useRef` idiom, and the one that was never named.
 *
 * `useLatestRef` pulled out `const ref = useRef(x); ref.current = x;`. The
 * construction it describes in its own first bullet — a `PanResponder` built
 * once inside `useRef(create()).current` — stayed written out, in six places,
 * and `react-hooks/refs` reports every one of them plus every closure that
 * reads the result: 17 errors in `components/swipe-tabs.tsx` alone, 14 of them
 * from one `new Animated.Value(0)`.
 *
 * Two things have to be true of the replacement, and only one of them is what
 * the linter was complaining about:
 *
 *  - **`create` runs once.** This is the contract the call sites depend on. A
 *    `PanResponder` rebuilt mid-gesture drops the gesture; an `Animated.Value`
 *    replaced mid-animation jumps the frame.
 *  - **`create` runs once.** `useRef(create())` evaluated `create()` on every
 *    render and kept the first result, so the guarantee READ correctly and the
 *    work was done every time. That is the half no test in this tree ever
 *    asserted, because no call site could tell the difference — which is also
 *    why it went unnoticed for as long as it did.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement, useState } from "react";

import { useConstant } from "@/lib/use-constant";

import { autoUnmount, render, unmountAllTrees } from "./helpers/render";
import { readRepoFile } from "./helpers/repo-file";

beforeEach(() => unmountAllTrees());
autoUnmount();

describe("useConstant — built on the first render and never again", () => {
  it("hands back what the factory made", () => {
    const made = { tag: "responder" };
    function Probe() {
      return createElement("probe", { seen: useConstant(() => made) });
    }
    assert.equal(render(createElement(Probe)).findByType("probe").props.seen, made);
  });

  it("calls the factory exactly once across many renders", () => {
    // The half `useRef(create())` got wrong. Nothing the call sites do could
    // observe it, so it is asserted here rather than at any of them.
    let calls = 0;
    function Probe({ n }: { n: number }) {
      const value = useConstant(() => {
        calls += 1;
        return { n };
      });
      return createElement("probe", { seen: value });
    }
    const result = render(createElement(Probe, { n: 1 }));
    result.rerender(createElement(Probe, { n: 2 }));
    result.rerender(createElement(Probe, { n: 3 }));
    assert.equal(calls, 1, "the factory must not re-run on a re-render");
  });

  it("keeps ONE value across renders, including the props the factory closed over", () => {
    // The hazard the hook does not remove, asserted so that nobody reads the
    // stability guarantee as a freshness one: `n` is the first render's for the
    // life of the component, which is exactly why the two PanResponder call
    // sites read `active`, `tabs`, `onChange` and the translator through
    // `useLatestRef` instead of closing over them.
    const identities = new Set<unknown>();
    function Probe({ n }: { n: number }) {
      const value = useConstant(() => ({ n }));
      identities.add(value);
      return createElement("probe", { seen: value });
    }
    const result = render(createElement(Probe, { n: 1 }));
    result.rerender(createElement(Probe, { n: 2 }));
    assert.equal(identities.size, 1, "the value object must be the same one every render");
    assert.deepEqual(result.findByType("probe").props.seen, { n: 1 });
  });

  it("survives a state update, which is the render a memo hint would not", () => {
    // `useMemo(create, [])` is a hint React may discard; the state initialiser
    // is a guarantee. This case cannot force a discard, so it asserts the
    // thing it can: an unrelated re-render does not rebuild.
    let calls = 0;
    let bump: (() => void) | undefined;
    function Probe() {
      const [, setTick] = useState(0);
      bump = () => setTick((t) => t + 1);
      const value = useConstant(() => {
        calls += 1;
        return {};
      });
      return createElement("probe", { seen: value });
    }
    const result = render(createElement(Probe));
    const first = result.findByType("probe").props.seen;
    bump?.();
    bump?.();
    assert.equal(calls, 1);
    assert.equal(result.findByType("probe").props.seen, first);
  });

  it("carries a value the factory returns as undefined rather than rebuilding for it", () => {
    // A factory that answers undefined is a factory that ran; a hook that took
    // undefined as "not built yet" would call it on every render, which is the
    // bug `useLatestRef` has the matching case for.
    let calls = 0;
    function Probe() {
      const value = useConstant<string | undefined>(() => {
        calls += 1;
        return undefined;
      });
      return createElement("probe", { seen: value ?? "MISSING" });
    }
    const result = render(createElement(Probe));
    result.rerender(createElement(Probe));
    assert.equal(result.findByType("probe").props.seen, "MISSING");
    assert.equal(calls, 1);
  });
});

describe("the sites that were writing it out", () => {
  it("leaves no `useRef(...).current` construction in swipe-tabs", () => {
    // The first of the three files the task names. The other five sites are
    // still there and are their own pieces; this case is scoped to the one
    // that is done rather than asserting a tree-wide negative that is not
    // true yet.
    const src = readRepoFile("components/swipe-tabs.tsx");
    // `).current` rather than `useRef(...).current`: the construction spans
    // three lines for the responder, and every OTHER `.current` in this file
    // is a plain identifier read (`widthRef`, `activeRef`, `reducedMotion`).
    // Comment lines are dropped first — the line above the responder names the
    // shape it is NOT, and a negative that its own explanation fails is a
    // negative nobody can write down.
    const code = src
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    assert.doesNotMatch(code, /\)\.current/);
    assert.match(src, /const translateX = useConstant\(\(\) => new Animated\.Value\(0\)\);/);
    assert.match(src, /const panResponder = useConstant\(\(\) =>\n\s+PanResponder\.create\(\{/);
  });
});
