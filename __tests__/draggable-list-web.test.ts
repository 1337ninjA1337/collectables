import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactElement } from "react";

import { stripComments } from "@/lib/strip-comments";

import { autoUnmount, installNativeModuleStubs, render, type TestNode } from "./helpers/render";
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
 * ## What the shim gives up, stated on purpose
 *
 * `drag` is a no-op and `isActive` is always `false`, so `onDragEnd` can never
 * fire: reorder-by-drag does not work in the web build. That is a real gap in
 * what `app/collection/[id].tsx`'s reorder mode and `app/index.tsx`'s
 * collection list offer there, and it is pinned here rather than left to be
 * rediscovered — a case that says "the shim drops `onDragEnd`" is also the
 * case that goes red the day somebody makes web dragging work, which is the
 * moment the sentence above stops being true.
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

/** The `FlatList` host node one of the shims renders for the given props. */
async function renderShim(
  name: (typeof SHIM_EXPORTS)[number],
  props: Record<string, unknown>,
): Promise<TestNode> {
  const shim = (await webModule())[name] as (props: unknown) => ReactElement;
  const tree = render(createElement(shim as never, props as never) as ReactElement);
  return tree.findByType("FlatList");
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
          drag();
          seen.push({ item, isActive, index: getIndex() });
          return null;
        },
      });
      const adapted = node.props.renderItem as (params: { item: Row; index: number }) => unknown;
      assert.equal(typeof adapted, "function");
      assert.equal(adapted({ item: ROWS[1], index: 1 }), null);
      assert.deepEqual(seen, [{ item: ROWS[1], isActive: false, index: 1 }]);
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
      const adapted = node.props.renderItem as (params: { item: Row; index: number }) => unknown;
      adapted({ item: ROWS[0], index: 0 });
      adapted({ item: ROWS[1], index: 1 });
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
