import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createElement,
  createContext,
  forwardRef,
  Fragment,
  memo,
  StrictMode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  __mountedTreeCountForTests,
  flattenStyle,
  installNativeModuleStubs,
  mockModule,
  render,
  styleOf,
  stubbedModuleSpecifiers,
  unmountAllTrees,
} from "./helpers/render";
import { assertExemptionsHonest, suiteCode, topLevelSuites } from "./helpers/suite-files";

installNativeModuleStubs();

// A synthetic specifier, so mocking it cannot disturb any real module this
// suite (or a suite sharing the process) also loads.
const spyCalls: string[] = [];
mockModule("virtual:harness-fixture", {
  greet: (name: string) => spyCalls.push(name),
  ANSWER: 42,
  default: "fixture-default",
});

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

  it("re-runs an effect whose deps changed, cleaning the previous one up first", () => {
    const order: string[] = [];
    let topic = "a";
    function Subscriber() {
      useEffect(() => {
        order.push(`subscribe:${topic}`);
        const held = topic;
        return () => {
          order.push(`unsubscribe:${held}`);
        };
      }, [topic]);
      return null;
    }
    const tree = render(createElement(Subscriber));
    topic = "b";
    tree.rerender();

    assert.deepEqual(order, ["subscribe:a", "unsubscribe:a", "subscribe:b"]);
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

describe("render harness — mockModule", () => {
  it("serves named exports, a default, and non-function values", async () => {
    const fixture = (await import("virtual:harness-fixture" as string)) as Record<string, unknown>;
    assert.equal(fixture.ANSWER, 42);
    assert.equal(fixture.default, "fixture-default");
    (fixture.greet as (n: string) => void)("world");
    assert.deepEqual(spyCalls, ["world"]);
  });

  it("rejects an export name that is not a valid identifier", () => {
    assert.throws(
      () => mockModule("virtual:bad", { "not-an-identifier": 1 }),
      /not a valid export identifier/,
    );
  });
});

describe("render harness — StrictMode", () => {
  it("invokes the body twice but rewinds the hook cursor, so useRef stays identical", () => {
    const bodies: unknown[] = [];
    function Once() {
      const ref = useRef({ built: Symbol("instance") });
      bodies.push(ref);
      return null;
    }
    render(createElement(StrictMode, null, createElement(Once)));
    assert.equal(bodies.length, 2, "StrictMode double-invokes the body");
    assert.equal(bodies[0], bodies[1], "a fresh ref on the second call is the bug this catches");
  });

  it("mounts, cleans up and mounts each effect again — the remount React does in dev", () => {
    const log: string[] = [];
    function Subscriber() {
      useEffect(() => {
        log.push("subscribe");
        return () => {
          log.push("unsubscribe");
        };
      }, []);
      return null;
    }
    render(createElement(StrictMode, null, createElement(Subscriber)));
    assert.deepEqual(log, ["subscribe", "unsubscribe", "subscribe"]);
  });

  it("leaves effects outside a strict subtree mounted exactly once", () => {
    const log: string[] = [];
    function Subscriber() {
      useEffect(() => {
        log.push("subscribe");
        return () => {
          log.push("unsubscribe");
        };
      }, []);
      return null;
    }
    render(createElement(Subscriber));
    assert.deepEqual(log, ["subscribe"]);
  });

  it("tears down every strict effect even when one cleanup throws", () => {
    // The same bug the unmount sweep had, one function away: a bare loop lets
    // the first throw skip the rest, and the `mount()` that follows then
    // re-runs an effect whose previous instance is still subscribed — a
    // duplicated subscription reported as a cleanup failure.
    const log: string[] = [];
    function Broken() {
      useEffect(() => () => {
        throw new Error("strict cleanup threw");
      }, []);
      return null;
    }
    function Healthy() {
      useEffect(() => () => {
        log.push("healthy unsubscribed");
      }, []);
      return null;
    }

    assert.throws(
      () =>
        render(
          createElement(
            StrictMode,
            null,
            createElement(Broken, { key: "broken" }),
            createElement(Healthy, { key: "healthy" }),
          ),
        ),
      (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.match(error.message, /strict cleanup threw/);
        return true;
      },
    );
    assert.deepEqual(
      log,
      ["healthy unsubscribed"],
      "the sibling's cleanup must run whatever the first one did",
    );
  });

  it("runs the previous cleanup before re-running an effect whose deps changed", () => {
    const log: string[] = [];
    function Watcher({ topic }: { topic: string }) {
      useEffect(() => {
        log.push(`open:${topic}`);
        return () => {
          log.push(`close:${topic}`);
        };
      }, [topic]);
      return null;
    }
    const tree = render(createElement(Watcher, { topic: "a" }));
    tree.rerender(createElement(Watcher, { topic: "b" }));
    assert.deepEqual(log, ["open:a", "close:a", "open:b"]);
  });
});

/**
 * Teardown, which the harness had no phase for.
 *
 * An effect's cleanup ran only when its deps changed, so "this component
 * unsubscribes when it goes away" was a fact no case could ask about: a probe
 * dropped from the tree kept its instance, its state and its subscription, and
 * a component that never returned a cleanup looked exactly like one that did.
 * Suites that cared worked around it by calling the subscription API by hand
 * and asserting on the registry — which tests the registry.
 */
describe("render harness — unmount", () => {
  it("runs an effect cleanup when the tree is unmounted", () => {
    const order: string[] = [];
    function Subscriber() {
      useEffect(() => {
        order.push("subscribe");
        return () => {
          order.push("unsubscribe");
        };
      }, []);
      return createElement("Text", null, "up");
    }
    const tree = render(createElement(Subscriber));
    assert.deepEqual(order, ["subscribe"]);

    tree.unmount();

    assert.deepEqual(order, ["subscribe", "unsubscribe"]);
    assert.deepEqual(tree.texts(), [], "the tree is gone, not merely quiet");
  });

  it("cleans up child before parent", () => {
    const order: string[] = [];
    function Leaf() {
      useEffect(() => () => {
        order.push("leaf");
      }, []);
      return null;
    }
    function Branch() {
      useEffect(() => () => {
        order.push("branch");
      }, []);
      return createElement(Leaf);
    }
    const tree = render(createElement(Branch));
    tree.unmount();

    assert.deepEqual(
      order,
      ["leaf", "branch"],
      "a child tears down while its parent's context and subscriptions still stand",
    );
  });

  it("is idempotent, so a second unmount does not run a cleanup twice", () => {
    let cleanups = 0;
    function Subscriber() {
      useEffect(() => () => {
        cleanups += 1;
      }, []);
      return null;
    }
    const tree = render(createElement(Subscriber));
    tree.unmount();
    tree.unmount();

    assert.equal(cleanups, 1);
  });

  it("refuses to re-render afterwards, because the hook state is gone", () => {
    function Component() {
      const [value] = useState("x");
      return createElement("Text", null, value);
    }
    const tree = render(createElement(Component));
    tree.unmount();

    assert.throws(() => tree.rerender(), /after unmount/);
  });

  it("tears down a subtree the next render stopped producing", () => {
    const order: string[] = [];
    let showChild = true;
    function Child() {
      useEffect(() => {
        order.push("subscribe");
        return () => {
          order.push("unsubscribe");
        };
      }, []);
      return createElement("Text", null, "child");
    }
    function Parent() {
      return createElement("View", null, showChild ? createElement(Child) : null);
    }
    const tree = render(createElement(Parent));
    assert.deepEqual(order, ["subscribe"]);

    showChild = false;
    tree.rerender();

    assert.deepEqual(order, ["subscribe", "unsubscribe"], "a closed branch is an unmount");
  });

  it("gives a re-added subtree fresh state, as React does", () => {
    let showChild = true;
    let seen: string | null = null;
    function Child() {
      const [value, setValue] = useState("initial");
      seen = value;
      return createElement("Pressable", { onPress: () => setValue("edited") }, value);
    }
    function Parent() {
      return createElement("View", null, showChild ? createElement(Child) : null);
    }
    const tree = render(createElement(Parent));
    tree.press(tree.findByType("Pressable"));
    assert.equal(seen, "edited");

    showChild = false;
    tree.rerender();
    showChild = true;
    tree.rerender();

    assert.equal(seen, "initial", "state does not survive the branch that held it");
  });

  it("leaves an effect that returns nothing alone", () => {
    function Silent() {
      useEffect(() => {
        // No cleanup, which is legal and must not become a call to undefined.
      }, []);
      return null;
    }
    const tree = render(createElement(Silent));

    assert.doesNotThrow(() => tree.unmount());
  });

  /**
   * A destructor that throws must not decide whether the rest of the tree comes
   * down.
   *
   * The loop was bare, so the first throw skipped every remaining cleanup — the
   * throwing component's own siblings, and then every LATER instance, parent
   * included. One broken component therefore left live subscriptions behind in
   * five healthy ones, and the failure named only the first. React logs and
   * continues; this collects and reports, which keeps the evidence.
   */
  it("runs every other cleanup when one of them throws", () => {
    const order: string[] = [];
    function Leaf() {
      useEffect(() => () => {
        order.push("leaf");
        throw new Error("leaf unsubscribe blew up");
      }, []);
      return null;
    }
    function Branch() {
      useEffect(() => () => {
        order.push("branch");
      }, []);
      return createElement("View", null, createElement(Leaf));
    }
    const tree = render(createElement(Branch));

    assert.throws(
      () => tree.unmount(),
      (error: unknown) => {
        assert.ok(error instanceof AggregateError, "one shape whatever the count");
        assert.equal(error.errors.length, 1);
        assert.match(error.message, /leaf unsubscribe blew up/);
        return true;
      },
    );
    assert.deepEqual(
      order,
      ["leaf", "branch"],
      "the parent's cleanup must run even though the child's threw",
    );
  });

  it("reports every failure together rather than the first one", () => {
    function Broken({ label }: { label: string }) {
      useEffect(() => () => {
        throw new Error(`${label} threw`);
      }, []);
      return null;
    }
    const tree = render(
      createElement(
        "View",
        null,
        createElement(Broken, { key: "a", label: "first" }),
        createElement(Broken, { key: "b", label: "second" }),
      ),
    );

    assert.throws(
      () => tree.unmount(),
      (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors.length, 2, "both, not the first");
        assert.match(error.message, /first threw/);
        assert.match(error.message, /second threw/);
        return true;
      },
    );
  });

  it("does not re-run a cleanup that threw", () => {
    let calls = 0;
    function Broken() {
      useEffect(() => () => {
        calls += 1;
        throw new Error("nope");
      }, []);
      return null;
    }
    const tree = render(createElement(Broken));

    // The cell is cleared BEFORE the call, so the throw does not leave the
    // destructor armed for a second unmount.
    assert.throws(() => tree.unmount(), AggregateError);
    assert.doesNotThrow(() => tree.unmount());
    assert.equal(calls, 1);
  });

  it("reports a cleanup that throws while a branch closes, not only on unmount", () => {
    // A closed conditional branch is an unmount too, and it runs inside the
    // render pass rather than from `unmount()` — the same collection has to
    // cover it or a broken cleanup there takes the re-render down mid-sweep.
    let showChild = true;
    function Child() {
      useEffect(() => () => {
        throw new Error("branch cleanup threw");
      }, []);
      return null;
    }
    function Parent() {
      return createElement("View", null, showChild ? createElement(Child) : null);
    }
    const tree = render(createElement(Parent));

    showChild = false;
    assert.throws(
      () => tree.rerender(),
      (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.match(error.message, /branch cleanup threw/);
        return true;
      },
    );
  });
});

/**
 * A tree a case drops on the floor stays mounted for the rest of the process.
 *
 * `unmount()` made teardown possible; nothing made it happen. A case that
 * renders, asserts and returns leaves its effects live — the subscription an
 * effect opened is still in whatever module-level registry it joined, and the
 * NEXT case's assertions see it. Four provider suites carry a
 * `resetStorageNotice`-shaped `beforeEach` for exactly that reason: clearing
 * the registry the leak lands in, rather than ending the tree that leaked into
 * it, which works for the registries somebody thought of and for no others.
 */
describe("render harness — trees that outlive their case", () => {
  it("counts a rendered tree as live until it is unmounted", () => {
    function Probe() {
      return null;
    }
    const before = __mountedTreeCountForTests();

    const tree = render(createElement(Probe));
    assert.equal(__mountedTreeCountForTests(), before + 1);

    tree.unmount();
    assert.equal(__mountedTreeCountForTests(), before, "an ended tree is not live");
  });

  it("unmountAllTrees ends what a case forgot, and runs its cleanups", () => {
    const log: string[] = [];
    function Subscriber() {
      useEffect(() => {
        log.push("subscribe");
        return () => {
          log.push("unsubscribe");
        };
      }, []);
      return null;
    }
    const before = __mountedTreeCountForTests();

    // Deliberately dropped: no `const tree =`, which is the shape of every case
    // that renders to assert on `texts()` and returns.
    render(createElement(Subscriber));
    render(createElement(Subscriber));
    assert.equal(__mountedTreeCountForTests(), before + 2);

    unmountAllTrees();

    assert.deepEqual(log, ["subscribe", "subscribe", "unsubscribe", "unsubscribe"]);
    assert.equal(__mountedTreeCountForTests(), 0, "and the registry is empty, not merely smaller");
  });

  it("is idempotent, and safe over a tree the case already ended", () => {
    let cleanups = 0;
    function Subscriber() {
      useEffect(() => () => {
        cleanups += 1;
      }, []);
      return null;
    }
    const tree = render(createElement(Subscriber));
    tree.unmount();

    assert.doesNotThrow(() => {
      unmountAllTrees();
    });
    assert.equal(cleanups, 1, "a tree that ended itself must not be torn down twice");
  });

  it("ends every tree even when the first one's cleanup throws", () => {
    // The bare loop was the same bug `unmountAll` fixed one level down: the
    // first broken destructor ended the sweep, so the trees behind it stayed
    // mounted — the failure that proves a component is broken reopening the
    // very leak this registry closes. From the `autoUnmount` hook that means
    // handing live subscriptions to the next case.
    let survivorCleanups = 0;
    function Broken() {
      useEffect(() => () => {
        throw new Error("broken tree cleanup");
      }, []);
      return null;
    }
    function Survivor() {
      useEffect(() => () => {
        survivorCleanups += 1;
      }, []);
      return null;
    }
    render(createElement(Broken));
    render(createElement(Survivor));

    assert.throws(
      () => {
        unmountAllTrees();
      },
      (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors.length, 1);
        assert.match(error.message, /broken tree cleanup/);
        return true;
      },
    );

    assert.equal(survivorCleanups, 1, "the tree behind the broken one still came down");
    assert.equal(__mountedTreeCountForTests(), 0, "and nothing was left in the registry");
  });

  it("flattens the per-tree aggregates instead of nesting them", () => {
    function Broken({ label }: { label: string }) {
      useEffect(() => () => {
        throw new Error(`${label} threw`);
      }, []);
      return null;
    }
    // Two broken components in one tree, then a third in a second tree: one
    // aggregate with three causes, not two aggregates one of which holds two.
    render(
      createElement(
        "View",
        null,
        createElement(Broken, { key: "a", label: "first" }),
        createElement(Broken, { key: "b", label: "second" }),
      ),
    );
    render(createElement(Broken, { label: "third" }));

    assert.throws(
      () => {
        unmountAllTrees();
      },
      (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors.length, 3, "flat, not two aggregates");
        assert.ok(
          error.errors.every((cause: unknown) => !(cause instanceof AggregateError)),
          "no cause is itself an aggregate",
        );
        assert.match(error.message, /first threw/);
        assert.match(error.message, /third threw/);
        assert.match(
          error.message,
          /across 2 tree\(s\)/,
          "three failures in one tree and three in three are different diagnoses",
        );
        return true;
      },
    );
  });

  it("keeps an aggregate a component's own cleanup threw as one cause", () => {
    // The unwrap recognises the harness's own aggregate by its subclass, not by
    // `instanceof AggregateError` — which a destructor rethrowing a
    // `Promise.any` rejection also satisfies. Splicing that one's causes in
    // would turn one broken component into two and grow the count in the
    // message with it.
    const componentAggregate = new AggregateError(
      [new Error("inner one"), new Error("inner two")],
      "the component's own aggregate",
    );
    function Broken() {
      useEffect(() => () => {
        throw componentAggregate;
      }, []);
      return null;
    }
    render(createElement(Broken));

    assert.throws(
      () => {
        unmountAllTrees();
      },
      (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors.length, 1, "one broken component, one cause");
        assert.equal(error.errors[0], componentAggregate, "and it arrives intact");
        return true;
      },
    );
  });

  it("spells out the first five causes and counts the rest", () => {
    // `error.errors` keeps all of them; the MESSAGE stops, because a tree with
    // fifty broken components otherwise produces a fifty-clause sentence before
    // the reader reaches the list.
    function Broken({ label }: { label: string }) {
      useEffect(() => () => {
        throw new Error(`cleanup ${label} threw`);
      }, []);
      return null;
    }
    const labels = ["1", "2", "3", "4", "5", "6", "7"];
    render(
      createElement(
        "View",
        null,
        ...labels.map((label) => createElement(Broken, { key: label, label })),
      ),
    );

    assert.throws(
      () => {
        unmountAllTrees();
      },
      (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors.length, labels.length, "every cause is kept");
        assert.match(error.message, /7 effect cleanup\(s\) across 1 tree\(s\) threw/);
        assert.match(error.message, /… and 2 more \(see error\.errors\)/);
        assert.equal(
          error.message.split("cleanup ").length - 1,
          5,
          "five spelled out, not seven",
        );
        return true;
      },
    );
  });
});

/**
 * The suite that OWNS the lifetime rule is the one suite that must not follow it.
 *
 * Three cases here render trees on purpose and assert on the count, including
 * one that leaves two mounted to prove `unmountAllTrees()` ends them. An
 * `afterEach` tearing those down between cases would not break them — but it
 * would mean the harness's own contract was being checked through the thing it
 * is a contract about.
 */
const OWNS_THE_LIFETIME_RULE = ["render-harness.test.ts"];

describe("every suite that mounts a tree ends it", () => {
  /** Suites that build a tree: directly, or through the provider harness. */
  function mountsATree(name: string): boolean {
    const code = suiteCode(name);
    return (
      /import \{[^}]*\brender\b[^}]*\} from "\.\/helpers\/render"/.test(code) ||
      /import \{[^}]*\bproviderHarness\b[^}]*\} from "\.\/helpers\/mount-provider"/.test(code)
    );
  }

  it("finds the suites it is about, so the sweep is not scanning an empty room", () => {
    const mounting = topLevelSuites().filter(mountsATree);

    assert.ok(
      mounting.length >= 15,
      `only ${String(mounting.length)} suites mount a tree — the parse, not the tree`,
    );
  });

  it("no suite renders without an autoUnmount()", () => {
    const offenders = topLevelSuites()
      .filter((name) => !OWNS_THE_LIFETIME_RULE.includes(name))
      .filter(mountsATree)
      .filter((name) => !suiteCode(name).includes("autoUnmount()"));

    assert.deepEqual(
      offenders,
      [],
      "call autoUnmount() at module scope — a case that renders, asserts and returns leaves its effects subscribed for every case after it",
    );
  });

  it("the one exempt suite still owns the rule it is exempt from", () => {
    assertExemptionsHonest({
      exemptions: OWNS_THE_LIFETIME_RULE,
      expected: ["render-harness.test.ts"],
      rule: "the autoUnmount rule",
      walk: topLevelSuites(),
      stillNeeded: (name) => suiteCode(name).includes("unmountAllTrees()"),
    });
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
