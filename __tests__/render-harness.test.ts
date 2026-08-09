import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement, Fragment, createContext, memo, forwardRef, useState, useMemo, useEffect, useRef } from "react";

import {
  flattenStyle,
  installNativeModuleStubs,
  render,
  styleOf,
  stubbedModuleSpecifiers,
} from "./helpers/render";

installNativeModuleStubs();

/**
 * Contract tests for `__tests__/helpers/render.ts`, the in-repo React render
 * harness.
 *
 * Everything here is built from locally-declared components rather than app
 * ones, so a failure points at the harness and not at a screen. The suites
 * that actually assert app behaviour (`design-tokens-rendering.test.ts`) can
 * then read a failure as "the component changed", which is only true if the
 * harness itself is pinned.
 */

describe("render harness — module stubs", () => {
  it("aliases exactly the three specifiers esbuild cannot transform", () => {
    assert.deepEqual(stubbedModuleSpecifiers().sort(), [
      "@expo/vector-icons",
      "@react-native-async-storage/async-storage",
      "react-native",
    ]);
  });

  it("loads react-native as the stub, with StyleSheet.create as identity", async () => {
    const { StyleSheet, View, Text } = await import("react-native");
    const sheet = { box: { backgroundColor: "#000000" } };
    assert.equal(StyleSheet.create(sheet), sheet, "create must not copy — tests compare by value");
    assert.equal(View, "View");
    assert.equal(Text, "Text");
  });

  it("loads @expo/vector-icons families as bare host strings", async () => {
    const { Ionicons } = await import("@expo/vector-icons");
    assert.equal(typeof Ionicons, "string", "boxing this would break the host-element check");
    assert.equal(Ionicons, "Ionicons");
  });

  it("is idempotent — a second install does not re-register hooks", () => {
    installNativeModuleStubs();
    installNativeModuleStubs();
    assert.equal(stubbedModuleSpecifiers().length, 3);
  });
});

describe("render harness — flattenStyle", () => {
  it("collapses an array with last-write-wins, matching platform precedence", () => {
    const flat = flattenStyle([{ color: "a", size: 1 }, { color: "b" }]);
    assert.deepEqual(flat, { color: "b", size: 1 });
  });

  it("drops the falsy entries of the `cond && styles.x` idiom", () => {
    assert.deepEqual(flattenStyle([{ a: 1 }, false, null, undefined]), { a: 1 });
  });

  it("flattens nested arrays", () => {
    assert.deepEqual(flattenStyle([{ a: 1 }, [{ b: 2 }, [{ c: 3 }]]]), { a: 1, b: 2, c: 3 });
  });

  it("returns an empty object for no style at all", () => {
    assert.deepEqual(flattenStyle(undefined), {});
  });
});

describe("render harness — element walking", () => {
  it("renders host elements with their props and children", () => {
    const tree = render(
      createElement("View", { testID: "outer" }, createElement("Text", null, "hello")),
    );
    const view = tree.findByType("View");
    assert.equal(view.props.testID, "outer");
    assert.deepEqual(tree.texts(), ["hello"]);
  });

  it("calls function components and keeps walking their output", () => {
    function Leaf({ label }: { label: string }) {
      return createElement("Text", null, label);
    }
    function Branch() {
      return createElement("View", null, createElement(Leaf, { label: "deep" }));
    }
    assert.deepEqual(render(createElement(Branch)).texts(), ["deep"]);
  });

  it("unwraps memo() and forwardRef() rather than treating them as hosts", () => {
    const Memoised = memo(function Memoised() {
      return createElement("Text", null, "memo");
    });
    const Forwarded = forwardRef<unknown, Record<string, never>>(function Forwarded() {
      return createElement("Text", null, "forwardRef");
    });
    const tree = render(
      createElement(Fragment, null, createElement(Memoised), createElement(Forwarded)),
    );
    assert.deepEqual(tree.texts(), ["memo", "forwardRef"]);
  });

  it("flattens fragments and arrays without inventing wrapper nodes", () => {
    const tree = render(
      createElement(
        "View",
        null,
        createElement(Fragment, null, createElement("Text", { key: "a" }, "a")),
        [createElement("Text", { key: "b" }, "b")],
      ),
    );
    assert.equal(tree.findAllByType("View").length, 1);
    assert.deepEqual(tree.texts(), ["a", "b"]);
  });

  it("drops null / false / undefined children (the `cond ? … : null` idiom)", () => {
    const tree = render(createElement("View", null, null, false, undefined, "kept"));
    assert.deepEqual(tree.texts(), ["kept"]);
  });

  it("does not walk into a <Modal visible={false}> — nothing mounts when it is shut", () => {
    const sheet = createElement("Text", null, "sheet body");
    const closed = render(createElement("Modal", { visible: false }, sheet));
    assert.deepEqual(closed.texts(), []);
    const open = render(createElement("Modal", { visible: true }, sheet));
    assert.deepEqual(open.texts(), ["sheet body"]);
  });
});

describe("render harness — hooks", () => {
  it("routes the real react package's useState/useMemo through the dispatcher", () => {
    let memoRuns = 0;
    function Counter() {
      const [count] = useState(7);
      const doubled = useMemo(() => {
        memoRuns += 1;
        return count * 2;
      }, [count]);
      return createElement("Text", null, String(doubled));
    }
    const tree = render(createElement(Counter));
    assert.deepEqual(tree.texts(), ["14"]);
    assert.equal(memoRuns, 1);
  });

  it("keeps hook state across rerender() and skips a memo whose deps are unchanged", () => {
    let memoRuns = 0;
    function Counter() {
      const [count, setCount] = useState(0);
      useMemo(() => {
        memoRuns += 1;
      }, []);
      return createElement("Pressable", { onPress: () => setCount(count + 1) }, String(count));
    }
    const tree = render(createElement(Counter));
    assert.deepEqual(tree.texts(), ["0"]);
    tree.press(tree.findByType("Pressable"));
    assert.deepEqual(tree.texts(), ["1"], "press must re-render when state changed");
    tree.rerender();
    assert.equal(memoRuns, 1, "an empty dep array must not re-run");
  });

  it("does not re-render when setState is called with the same value", () => {
    let renders = 0;
    function Static() {
      const [value, setValue] = useState("same");
      renders += 1;
      return createElement("Pressable", { onPress: () => setValue("same") }, value);
    }
    const tree = render(createElement(Static));
    assert.equal(renders, 1);
    tree.press(tree.findByType("Pressable"));
    assert.equal(renders, 1);
  });

  it("gives useRef a stable object across renders", () => {
    const seen: unknown[] = [];
    function Reffed() {
      const ref = useRef({ hits: 0 });
      seen.push(ref);
      return null;
    }
    const tree = render(createElement(Reffed));
    tree.rerender();
    assert.equal(seen.length, 2);
    assert.equal(seen[0], seen[1]);
  });

  it("flushes effects after the pass and re-renders the state they set", () => {
    const order: string[] = [];
    function Hydrating() {
      const [ready, setReady] = useState(false);
      order.push(`render:${ready}`);
      useEffect(() => {
        order.push("effect");
        setReady(true);
      }, []);
      return createElement("Text", null, ready ? "ready" : "pending");
    }
    const tree = render(createElement(Hydrating));
    assert.deepEqual(order, ["render:false", "effect", "render:true"]);
    assert.deepEqual(tree.texts(), ["ready"]);
  });

  it("resolves useContext through the nearest provider, and to the default without one", async () => {
    const Ctx = createContext("default");
    const { useContext } = await import("react");
    function Consumer() {
      return createElement("Text", null, useContext(Ctx));
    }
    assert.deepEqual(render(createElement(Consumer)).texts(), ["default"]);
    assert.deepEqual(
      render(createElement(Ctx.Provider, { value: "provided" }, createElement(Consumer))).texts(),
      ["provided"],
    );
  });

  it("pops the provider stack on the way out so siblings see the outer value", async () => {
    const Ctx = createContext("outer");
    const { useContext } = await import("react");
    function Consumer() {
      return createElement("Text", null, useContext(Ctx));
    }
    const tree = render(
      createElement(
        "View",
        null,
        createElement(Ctx.Provider, { value: "inner", key: "p" }, createElement(Consumer)),
        createElement(Consumer, { key: "c" }),
      ),
    );
    assert.deepEqual(tree.texts(), ["inner", "outer"]);
  });
});

describe("render harness — queries", () => {
  function Tree() {
    return createElement(
      "View",
      null,
      createElement("Text", { style: [{ color: "a" }, { color: "b" }] }, "one"),
      createElement("Text", null, "two"),
    );
  }

  it("styleOf flattens the node's own style prop", () => {
    const tree = render(createElement(Tree));
    assert.deepEqual(styleOf(tree.findByType("Text")), { color: "b" });
  });

  it("findAllByType returns document order and findByType returns the first", () => {
    const tree = render(createElement(Tree));
    assert.equal(tree.findAllByType("Text").length, 2);
    assert.equal(tree.findByType("Text").children[0].text, "one");
  });

  it("find() throws with the rendered tree in the message when nothing matches", () => {
    const tree = render(createElement(Tree));
    assert.throws(
      () => tree.find((node) => node.type === "Image"),
      /no node matched the predicate/,
    );
  });

  it("press() throws rather than silently doing nothing on a node without onPress", () => {
    const tree = render(createElement(Tree));
    assert.throws(() => tree.press(tree.findByType("Text")), /has no onPress/);
  });

  it("all() excludes the synthetic root", () => {
    const tree = render(createElement(Tree));
    assert.ok(!tree.all().some((node) => node.type === "#root"));
    assert.equal(tree.root.type, "#root");
  });
});
