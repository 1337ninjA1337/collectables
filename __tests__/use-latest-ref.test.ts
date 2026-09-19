/**
 * One assignment, ten places that were writing it out.
 *
 * `const ref = useRef(x); ref.current = x;` appeared in eight files for three
 * different reasons — a `PanResponder` built once and never rebuilt, a callback
 * whose identity changes every render and must not restart a timer, and render
 * state read by a handler that outlives the render. The second line is the
 * whole hook, and it is the line that gets forgotten: the failure is not a
 * crash, it is a ref that keeps the FIRST value and a component that behaves
 * correctly until the value changes — a language switch, a second toast, a
 * reorder, none of which the first render can see.
 *
 * The hook is one line, so most of this suite is about the behaviour that line
 * has to have: that the identity is stable across renders, and that the value
 * is current by the time anything reads it.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement, useEffect } from "react";

import { useLatestRef } from "@/lib/use-latest-ref";

import { autoUnmount, render, unmountAllTrees } from "./helpers/render";
import { readRepoFile } from "./helpers/repo-file";
import { sourceFiles } from "./helpers/source-files";

// No stubs needed: the hook imports `react` and nothing else, which is half of
// why it is worth having in `lib/` rather than beside any one of its callers.
beforeEach(() => unmountAllTrees());
// A case that renders, asserts and returns leaves its effects subscribed for
// every case after it.
autoUnmount();

describe("useLatestRef — the value a late closure reads", () => {
  it("hands back the value it was given", () => {
    let seen: unknown;
    function Probe({ value }: { value: string }) {
      seen = useLatestRef(value).current;
      return null;
    }
    render(createElement(Probe, { value: "first" }));
    assert.equal(seen, "first");
  });

  it("updates on re-render, which is the point", () => {
    const reads: string[] = [];
    function Probe({ value }: { value: string }) {
      const ref = useLatestRef(value);
      // An effect is the earliest thing that runs after the commit and is
      // where half the callers read it from.
      useEffect(() => {
        reads.push(ref.current);
      });
      return null;
    }
    const result = render(createElement(Probe, { value: "first" }));
    result.rerender(createElement(Probe, { value: "second" }));
    assert.deepEqual(reads, ["first", "second"]);
  });

  it("keeps ONE ref across renders, so a closure captured on the first still sees the latest", () => {
    // This is the whole contract. A hook returning a fresh object per render
    // would satisfy every case above and none of the four call sites, because
    // the PanResponder holds the object it was given on render one.
    let captured: { current: string } | undefined;
    const identities = new Set<unknown>();
    function Probe({ value }: { value: string }) {
      const ref = useLatestRef(value);
      identities.add(ref);
      if (!captured) captured = ref;
      return null;
    }
    const result = render(createElement(Probe, { value: "first" }));
    result.rerender(createElement(Probe, { value: "second" }));
    result.rerender(createElement(Probe, { value: "third" }));
    assert.equal(identities.size, 1, "the ref object must be the same one every render");
    assert.equal(captured?.current, "third", "and the first render's capture must see the latest value");
  });

  it("carries undefined and null as values rather than treating them as absent", () => {
    // `getIndex()` answers undefined for an unplaced row, and a callback prop
    // is legitimately undefined when a screen does not pass one. A hook that
    // skipped the assignment for a falsy value would keep the previous one.
    function Probe({ value }: { value: string | null | undefined }) {
      return createElement("probe", { seen: useLatestRef(value).current ?? "MISSING" });
    }
    const result = render(createElement(Probe, { value: "first" }));
    result.rerender(createElement(Probe, { value: undefined }));
    assert.equal(result.findByType("probe").props.seen, "MISSING");
    result.rerender(createElement(Probe, { value: null }));
    assert.equal(result.findByType("probe").props.seen, "MISSING");
  });

  it("is mutable, because one caller writes to its own ref from inside an effect", () => {
    // `use-transition-event` keeps a second ref it assigns in its effect. A
    // readonly type here would push that one back to a hand-rolled useRef, and
    // one holdout is how an idiom stays two idioms.
    function Probe() {
      const ref = useLatestRef(1);
      ref.current = 2;
      return createElement("probe", { seen: ref.current });
    }
    assert.equal(render(createElement(Probe)).findByType("probe").props.seen, 2);
  });
});

describe("the sites that were writing it out", () => {
  it("leaves no render-body ref assignment behind", () => {
    // The pattern this replaces, matched at the top level of a component body:
    // `xRef.current = x;` on its own line, with the same name either side. An
    // assignment inside an effect or a handler is a different thing and is not
    // matched — the name has to be the identifier the ref was built from.
    const offenders: string[] = [];
    for (const file of sourceFiles("app", "components", "lib")) {
      const source = readRepoFile(file);
      for (const match of source.matchAll(/^ {2}(\w+)Ref\.current = (\w+);$/gm)) {
        if (match[1] === match[2]) offenders.push(`${file}: ${match[0].trim()}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `these should be useLatestRef(...):\n  ${offenders.join("\n  ")}`,
    );
  });

  it("is used by every file that had the idiom", () => {
    const sites = [
      "app/index.tsx",
      "app/collection/[id].tsx",
      "components/swipe-tabs.tsx",
      "components/toast-host.tsx",
      "lib/reduced-motion.ts",
      "lib/use-dwell-time.ts",
      "lib/use-entry-currency.ts",
      "lib/use-transition-event.ts",
      "lib/use-visibility-refresh.ts",
    ];
    for (const file of sites) {
      assert.match(readRepoFile(file), /useLatestRef\(/, `${file} must use the shared hook`);
    }
  });

  it("collapsed useReducedMotionRef to the signal plus the hook", () => {
    // It was written with the assignment inside it for exactly the reason the
    // hook now exists, which makes it the one site that was already right.
    assert.match(
      readRepoFile("lib/reduced-motion.ts"),
      /return useLatestRef\(useReducedMotion\(\)\);/,
    );
  });
});
