import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactElement } from "react";

import { stripComments } from "@/lib/strip-comments";

import { setupFakeDom, type FakeDom } from "./helpers/fake-dom";
import {
  autoUnmount,
  installNativeModuleStubs,
  render,
  type RenderResult,
  type TestNode,
} from "./helpers/render";
import { readRepoFile } from "./helpers/repo-file";

installNativeModuleStubs();
// Ends every tree a case rendered, including the cases that fail early.
autoUnmount();

/**
 * The list adapter the deployed build actually serves.
 *
 * ## Why this file and not the other one
 *
 * `components/` holds two spellings of the same module and Metro picks between
 * them by platform: the plain one re-exports
 * `react-native-draggable-flatlist` and the `.web` one is a shim over
 * `FlatList`. GitHub Pages serves the web bundle, so the shim is the half a
 * user of this app runs, and it was the last entry on
 * `suite-named-modules.test.ts`'s exemption list — "a component; needs a
 * render harness" — while the half nobody runs sat beside it as a re-export
 * with nothing to assert.
 *
 * Closing one closes both, and not by choice: the census counts a module as
 * named when a suite's code contains its path without the extension, and
 * `components/DraggableList.web` contains `components/DraggableList` as a
 * prefix. There is no way to name the shim that does not also name its twin.
 * So the parity case below is the twin's half of the entry, and it asserts the
 * thing that entry's comment claimed on trust: that the native file is still
 * seven lines of re-export, and that both spellings publish the same names.
 *
 * ## The gesture, and where a browser is not needed to check it
 *
 * `drag` used to be a no-op and `isActive` a constant `false`, so `onDragEnd`
 * could never fire and reorder-by-drag did nothing on the one platform this
 * app is deployed to. The shim runs the gesture itself now, off `document`'s
 * pointer events, and the cases below drive it the way a browser would: the
 * row elements the adapted `renderItem` builds carry a `ref`, so a case can
 * hand one a stand-in whose `getBoundingClientRect` returns the geometry it
 * wants, then fire `pointermove` and `pointerup` through `setupFakeDom`'s
 * listener registry and read what `onDragEnd` was given.
 *
 * The arithmetic under that — which index a pointer is over, and what the
 * array becomes — is `lib/drag-reorder.ts` and has its own suite. What is
 * proved here is the wiring: that the listeners go on and come back off, that
 * the drop reads the data as it is at the drop, and that nothing is committed
 * when the rows could not be measured or when the row never moved.
 */

/** The two shims the module exports, exercised by the same cases. */
const SHIM_EXPORTS = ["DraggableFlatList", "NestableDraggableFlatList"] as const;

type Row = { id: string; title: string };

const ROWS: readonly Row[] = [
  { id: "a", title: "Alpha" },
  { id: "b", title: "Beta" },
];

/** The web module, pulled in after the stubs are installed. */
async function webModule(): Promise<Record<string, unknown>> {
  return (await import("@/components/DraggableList.web")) as unknown as Record<string, unknown>;
}

/** The whole tree plus the `FlatList` host node one of the shims rendered. */
async function mountShim(
  name: (typeof SHIM_EXPORTS)[number],
  props: Record<string, unknown>,
): Promise<{ tree: RenderResult; list: TestNode }> {
  const shim = (await webModule())[name] as (props: unknown) => ReactElement;
  const tree = render(createElement(shim as never, props as never) as ReactElement);
  return { tree, list: tree.findByType("FlatList") };
}

/** The `FlatList` host node one of the shims renders for the given props. */
async function renderShim(
  name: (typeof SHIM_EXPORTS)[number],
  props: Record<string, unknown>,
): Promise<TestNode> {
  return (await mountShim(name, props)).list;
}

/**
 * The element the adapted `renderItem` builds for one row.
 *
 * `FlatList` is a host string in `helpers/stubs/react-native.mjs`, so the
 * harness never walks into it and the rows are never built for us — calling
 * the prop is how a case reaches the wrapper, the same way the real list does.
 * React 19 carries `ref` as an ordinary prop, which is what lets the drag cases
 * below attach a measurable stand-in where a browser would attach a `div`.
 */
type RowElement = ReactElement<{
  ref?: (node: unknown) => void;
  style?: unknown;
  children?: unknown;
}>;

function adaptedRow(list: TestNode, item: Row, index: number): RowElement {
  const adapted = list.props.renderItem as (params: { item: Row; index: number }) => RowElement;
  assert.equal(typeof adapted, "function");
  return adapted({ item, index });
}

describe("the web DraggableList shim renders a FlatList", () => {
  for (const name of SHIM_EXPORTS) {
    it(`${name} forwards the list props it does not consume`, async () => {
      const keyExtractor = (row: Row) => row.id;
      const node = await renderShim(name, {
        data: ROWS,
        keyExtractor,
        contentContainerStyle: { paddingBottom: 24 },
        testID: "rows",
      });
      assert.equal(node.props.data, ROWS);
      assert.equal(node.props.keyExtractor, keyExtractor);
      assert.deepEqual(node.props.contentContainerStyle, { paddingBottom: 24 });
      assert.equal(node.props.testID, "rows");
    });

    it(`${name} keeps the drag-only props off the FlatList`, async () => {
      // Not "is undefined": `{...rest}` spreading a key with an undefined value
      // still puts the key on the element, and react-native-web forwards
      // unknown props to the DOM node. The shim strips both by destructuring,
      // and the absence of the key is what says so.
      const node = await renderShim(name, {
        data: ROWS,
        onDragEnd: () => {},
        activationDistance: 12,
      });
      assert.equal("onDragEnd" in node.props, false);
      assert.equal("activationDistance" in node.props, false);
    });

    it(`${name} adapts renderItem to the draggable params`, async () => {
      const seen: { item: Row; isActive: boolean; index: number | undefined }[] = [];
      const node = await renderShim(name, {
        data: ROWS,
        renderItem: ({ item, drag, isActive, getIndex }: {
          item: Row;
          drag: () => void;
          isActive: boolean;
          getIndex: () => number | undefined;
        }) => {
          assert.equal(typeof drag, "function");
          seen.push({ item, isActive, index: getIndex() });
          return null;
        },
      });
      const row = adaptedRow(node, ROWS[1], 1);
      assert.deepEqual(seen, [{ item: ROWS[1], isActive: false, index: 1 }]);
      // The row the screen wrote is the wrapper's only child: the shim adds a
      // `View` to have something it can measure during a drag, and nothing else.
      assert.equal(row.type, "View");
      assert.equal(row.props.children, null);
      assert.equal(row.props.style, undefined);
    });

    it(`${name} reports the index FlatList passed, not a captured one`, async () => {
      // `getIndex` is a closure over the argument, so two rows adapted from one
      // element have to answer differently. A shim that returned a constant —
      // or that read an index off the item — passes every case above and fails
      // this one, and `app/collection/[id].tsx` reads `getIndex()` to decide
      // whether a row is the last in the list.
      const indices: (number | undefined)[] = [];
      const node = await renderShim(name, {
        data: ROWS,
        renderItem: ({ getIndex }: { getIndex: () => number | undefined }) => {
          indices.push(getIndex());
          return null;
        },
      });
      adaptedRow(node, ROWS[0], 0);
      adaptedRow(node, ROWS[1], 1);
      assert.deepEqual(indices, [0, 1]);
    });

    it(`${name} leaves renderItem undefined when it was given none`, async () => {
      const node = await renderShim(name, { data: ROWS });
      assert.equal(node.props.renderItem, undefined);
    });
  }

  it("gives the two shims separate identities", async () => {
    // `makeDraggableShim()` is called twice, so the nestable list is not the
    // same component as the plain one. React remounts a subtree whose element
    // type changed, and a screen that swaps one for the other would lose its
    // row state — worth knowing rather than assuming.
    const mod = await webModule();
    assert.notEqual(mod.DraggableFlatList, mod.NestableDraggableFlatList);
  });
});

/** Row extents a case hands the shim in place of a laid-out `div`. */
const ROW_HEIGHT = 100;

function measurable(index: number) {
  return {
    getBoundingClientRect: () => ({
      top: index * ROW_HEIGHT,
      bottom: (index + 1) * ROW_HEIGHT,
    }),
  };
}

type DragEnd = { data: Row[]; from: number; to: number };

type Gesture = {
  dom: FakeDom;
  tree: RenderResult;
  /** Rebuilds every row from the current tree, attaching or dropping its ref. */
  layOutRows: (options?: { measured?: boolean }) => void;
  /** The `drag` callback the row at this index was handed on the last pass. */
  dragRow: (index: number) => void;
  pointerMove: (clientY: number) => void;
  pointerUp: () => void;
  isActive: (index: number) => boolean;
  drops: DragEnd[];
};

/**
 * A mounted shim with a fake document, ready to be dragged.
 *
 * Returns a `restore` alongside, and every case calls it in a `finally` — the
 * fake globals outlive the test that installed them otherwise, and the suites
 * that come after this one in the same process would render against them.
 */
async function mountGesture(
  name: (typeof SHIM_EXPORTS)[number],
): Promise<Gesture & { restore: () => void }> {
  const dom = setupFakeDom();
  const drops: DragEnd[] = [];
  const dragHandles = new Map<number, () => void>();
  const active = new Map<number, boolean>();

  const { tree, list } = await mountShim(name, {
    data: ROWS,
    keyExtractor: (row: Row) => row.id,
    onDragEnd: (params: DragEnd) => drops.push(params),
    renderItem: ({ drag, isActive, getIndex }: {
      drag: () => void;
      isActive: boolean;
      getIndex: () => number | undefined;
    }) => {
      const index = getIndex();
      if (index !== undefined) {
        dragHandles.set(index, drag);
        active.set(index, isActive);
      }
      return null;
    },
  });

  const layOutRows = (options: { measured?: boolean } = {}) => {
    const current = tree.dirty ? tree.rerender() : tree;
    const node = current.findByType("FlatList");
    ROWS.forEach((row, index) => {
      const element = adaptedRow(node, row, index);
      element.props.ref?.(options.measured === false ? null : measurable(index));
    });
  };

  const fire = (type: string, event: Record<string, unknown>) => {
    for (const listener of [...(dom.listeners[type] ?? [])]) {
      listener({ type, ...event } as never);
    }
  };

  return {
    dom,
    tree,
    layOutRows,
    dragRow: (index) => {
      const drag = dragHandles.get(index);
      assert.ok(drag, `row ${index} was never rendered`);
      drag();
    },
    pointerMove: (clientY) => fire("pointermove", { clientY }),
    pointerUp: () => fire("pointerup", {}),
    isActive: (index) => active.get(index) === true,
    drops,
    restore: dom.restore,
  };
}

describe("the web DraggableList shim runs the drag gesture itself", () => {
  it("moves a row past its neighbour's midpoint and commits on pointerup", async () => {
    const gesture = await mountGesture("NestableDraggableFlatList");
    try {
      gesture.layOutRows();
      gesture.dragRow(0);
      // Below the second row's midpoint (150), which is the point at which the
      // two swap — not the point at which the cursor leaves the first row.
      gesture.pointerMove(160);
      gesture.pointerUp();
      assert.deepEqual(gesture.drops, [
        { data: [ROWS[1], ROWS[0]], from: 0, to: 1 },
      ]);
    } finally {
      gesture.restore();
    }
  });

  it("commits nothing when the pointer never left the row it started on", async () => {
    const gesture = await mountGesture("NestableDraggableFlatList");
    try {
      gesture.layOutRows();
      gesture.dragRow(1);
      gesture.pointerMove(190);
      gesture.pointerUp();
      assert.deepEqual(gesture.drops, []);
    } finally {
      gesture.restore();
    }
  });

  it("commits nothing when the rows could not be measured", async () => {
    // A windowed list whose rows have not attached their refs yet, and every
    // environment without a layout engine. `measureRows` is all-or-nothing
    // precisely so this cannot silently drop the row one place short.
    const gesture = await mountGesture("NestableDraggableFlatList");
    try {
      gesture.layOutRows({ measured: false });
      gesture.dragRow(0);
      gesture.pointerMove(160);
      gesture.pointerUp();
      assert.deepEqual(gesture.drops, []);
    } finally {
      gesture.restore();
    }
  });

  it("marks the dragged row active until the drop", async () => {
    const gesture = await mountGesture("NestableDraggableFlatList");
    try {
      gesture.layOutRows();
      gesture.dragRow(0);
      gesture.layOutRows();
      assert.equal(gesture.isActive(0), true);
      assert.equal(gesture.isActive(1), false);
      gesture.pointerUp();
      gesture.layOutRows();
      assert.equal(gesture.isActive(0), false);
    } finally {
      gesture.restore();
    }
  });

  it("dims the active row and leaves the others unstyled", async () => {
    const gesture = await mountGesture("NestableDraggableFlatList");
    try {
      gesture.layOutRows();
      gesture.dragRow(1);
      const node = gesture.tree.rerender().findByType("FlatList");
      assert.deepEqual(adaptedRow(node, ROWS[1], 1).props.style, { opacity: 0.6 });
      assert.equal(adaptedRow(node, ROWS[0], 0).props.style, undefined);
    } finally {
      gesture.restore();
    }
  });

  it("takes its listeners back off the document when the drag ends", async () => {
    const gesture = await mountGesture("NestableDraggableFlatList");
    try {
      gesture.layOutRows();
      gesture.dragRow(0);
      assert.equal(gesture.dom.listeners.pointermove?.length, 1);
      assert.equal(gesture.dom.listeners.pointerup?.length, 1);
      assert.equal(gesture.dom.listeners.pointercancel?.length, 1);
      gesture.pointerUp();
      assert.equal(gesture.dom.listeners.pointermove?.length, 0);
      assert.equal(gesture.dom.listeners.pointerup?.length, 0);
      assert.equal(gesture.dom.listeners.pointercancel?.length, 0);
    } finally {
      gesture.restore();
    }
  });

  it("takes them off on unmount too, and commits nothing", async () => {
    // A screen navigated away from mid-drag. The listeners close over a list
    // nobody is rendering, so leaving them attached is the leak; committing the
    // reorder on the way out would be worse.
    const gesture = await mountGesture("NestableDraggableFlatList");
    try {
      gesture.layOutRows();
      gesture.dragRow(0);
      gesture.pointerMove(160);
      gesture.tree.unmount();
      assert.equal(gesture.dom.listeners.pointermove?.length, 0);
      assert.deepEqual(gesture.drops, []);
    } finally {
      gesture.restore();
    }
  });

  it("replaces the gesture rather than stacking a second one", async () => {
    // Reachable with touch, where a pointerup can be swallowed and the next
    // long press arrives with the previous drag still attached.
    const gesture = await mountGesture("NestableDraggableFlatList");
    try {
      gesture.layOutRows();
      gesture.dragRow(0);
      gesture.layOutRows();
      gesture.dragRow(1);
      assert.equal(gesture.dom.listeners.pointermove?.length, 1);
      gesture.pointerMove(10);
      gesture.pointerUp();
      assert.deepEqual(gesture.drops, [
        { data: [ROWS[1], ROWS[0]], from: 1, to: 0 },
      ]);
    } finally {
      gesture.restore();
    }
  });

  it("does nothing at all where there is no document", async () => {
    // The node-run suites, and any renderer that is not a browser. `drag()` is
    // the no-op it was before the gesture existed, and — the part that matters
    // — it does not leave a row marked active with no way to clear it.
    const node = await renderShim("DraggableFlatList", {
      data: ROWS,
      renderItem: ({ drag }: { drag: () => void }) => {
        drag();
        return null;
      },
    });
    assert.doesNotThrow(() => adaptedRow(node, ROWS[0], 0));
    assert.equal(adaptedRow(node, ROWS[0], 0).props.style, undefined);
  });
});

describe("the web DraggableList shim's non-list exports", () => {
  it("is react-native's ScrollView under the nestable container's name", async () => {
    const [mod, rn] = await Promise.all([webModule(), import("react-native")]);
    assert.equal(mod.NestableScrollContainer, rn.ScrollView);
  });

  it("renders ScaleDecorator's children with no wrapper of its own", async () => {
    const { ScaleDecorator } = await webModule();
    const { Text } = await import("react-native");
    const tree = render(
      createElement(
        ScaleDecorator as never,
        null,
        createElement(Text as never, { testID: "row" }, "Alpha"),
      ) as ReactElement,
    );
    // A fragment, so the decorator adds no layout: the child is the tree's
    // first node, and the native library's decorator is an Animated.View that
    // only scales during a drag the web build cannot start.
    assert.deepEqual(tree.root.children.map((node) => node.type), ["Text"]);
    assert.deepEqual(tree.texts(), ["Alpha"]);
  });
});

describe("the native DraggableList twin", () => {
  const NATIVE = readRepoFile("components", "DraggableList.tsx");

  it("is nothing but re-exports of the draggable list library", () => {
    const statements = stripComments(NATIVE)
      .split(";")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    const foreign = statements.filter(
      (statement) => !/^export\s.*from\s+"react-native-draggable-flatlist"$/s.test(statement),
    );
    assert.deepEqual(
      foreign,
      [],
      `components/DraggableList.tsx is exempt from having its own suite because it has no behaviour of its own, and these statements are behaviour:\n  ${foreign.join("\n  ")}`,
    );
  });

  it("publishes the same value exports as the web spelling", async () => {
    const native = new Set<string>();
    for (const [, clause] of stripComments(NATIVE).matchAll(
      /export\s+(?!type\s)\{([^}]*)\}\s+from/g,
    )) {
      for (const specifier of clause.split(",")) {
        const name = specifier.trim().split(/\s+as\s+/).pop();
        if (name) native.add(name);
      }
    }
    const web = new Set(Object.keys(await webModule()));
    assert.deepEqual(
      [...native].sort(),
      [...web].sort(),
      "Metro picks between these two files by platform, so a name on one and not the other is a screen that renders on a phone and throws in the browser",
    );
  });

  it("re-exports the RenderItemParams type the web spelling declares", () => {
    // The type is erased at runtime, so the parity case above cannot see it,
    // and it is the one export both call sites import by name.
    assert.match(
      stripComments(NATIVE),
      /export\s+type\s+\{[^}]*\bRenderItemParams\b[^}]*\}\s+from\s+"react-native-draggable-flatlist"/,
    );
  });
});
