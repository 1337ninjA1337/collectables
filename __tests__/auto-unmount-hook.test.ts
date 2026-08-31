/**
 * The one thing the lifetime sweep cannot see: whether the hook actually fires.
 *
 * `every suite that mounts a tree ends it` (in `render-harness.test.ts`) reads
 * `autoUnmount()` as a TOKEN in a suite's source, and `render harness — trees
 * that outlive their case` proves `unmountAllTrees()` ends trees the harness
 * suite rendered on purpose. Neither says that a suite calling `autoUnmount()`
 * at module scope gets its trees taken down BETWEEN its cases — that depends on
 * a `node:test` behaviour (a root-level `afterEach` registered from module scope
 * applies to every test in the file) that sixteen suites now rely on and nothing
 * pinned.
 *
 * The proof has to span two cases, because one case cannot observe its own
 * `afterEach`: the first drops a tree on the floor, the second reads what is
 * left. `node:test` runs the cases of a file in source order, which is what
 * makes "the next case" a thing this file can write down.
 *
 * Deliberately its own file. Everything here is about the state the harness
 * carries ACROSS cases, so a suite that also tested something else would be one
 * added `render()` away from proving nothing.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement, useEffect } from "react";
import { __mountedTreeCountForTests, autoUnmount, render } from "./helpers/render";

autoUnmount();

const cleanups: string[] = [];

function Subscriber({ label }: { label: string }) {
  useEffect(() => {
    return () => {
      cleanups.push(label);
    };
  }, [label]);
  return null;
}

describe("autoUnmount ends a case's trees before the next one runs", () => {
  it("leaves two trees mounted, and does not end them itself", () => {
    // The shape of every case that renders to assert on `texts()` and returns:
    // no `const tree =`, no `unmount()`. Two of them, because one tree coming
    // down proves less than a loop that has to reach the second.
    render(createElement(Subscriber, { label: "first" }));
    render(createElement(Subscriber, { label: "second" }));

    assert.equal(__mountedTreeCountForTests(), 2, "both are live while the case runs");
    assert.deepEqual(cleanups, [], "and nothing has been torn down yet");
  });

  it("finds the registry empty and both cleanups run", () => {
    assert.equal(__mountedTreeCountForTests(), 0, "the hook ran between the two cases");
    assert.deepEqual(cleanups, ["first", "second"], "every dropped tree's cleanup, not the last");
  });

  it("is a no-op for a case that rendered nothing", () => {
    // The hook runs after all sixteen suites' cases, most of which render
    // nothing at all — a sweep case in a mounted suite pays it too. An empty
    // registry must stay an ordinary pass rather than a throw over an empty set.
    assert.equal(__mountedTreeCountForTests(), 0);
  });

  it("ends a tree the case rendered even though an assertion failed first", () => {
    // The whole reason the hook beats an `unmount()` at the end of every case:
    // a case that returns early — because it threw — never reaches that line,
    // and it is precisely the failing case that leaves a subscription behind
    // for the next assertion to read. Simulated with a caught throw, since a
    // genuinely failing case would fail this suite.
    assert.throws(() => {
      render(createElement(Subscriber, { label: "third" }));
      throw new Error("as if an assertion failed here");
    }, /as if an assertion failed/);

    assert.equal(__mountedTreeCountForTests(), 1, "the tree outlived the throw");
  });

  it("still starts clean after the case that threw", () => {
    assert.equal(__mountedTreeCountForTests(), 0);
    assert.deepEqual(cleanups, ["first", "second", "third"]);
  });
});
