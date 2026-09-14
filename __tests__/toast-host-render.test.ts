import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";

import {
  DANGER_DEEP_7,
  DANGER_DEEP_8,
  SUCCESS_DEEP,
  SUCCESS_GREEN_3,
} from "@/lib/design-tokens";

import {
  autoUnmount,
  installNativeModuleStubs,
  render,
  styleOf,
  type TestNode,
} from "./helpers/render";

installNativeModuleStubs();
autoUnmount();

/**
 * The toast overlay, RENDERED.
 *
 * Every case about this markup was a source-text scan until 2026-09-14, for a
 * reason that stopped being true that afternoon: it lived in
 * `lib/toast-context.tsx`, which pulls the whole provider — React Native,
 * the announcement seam, the queue — and could not be imported under
 * `tsx --test`. The overlay moved to `components/toast-host.tsx` so the five
 * markup rules could see it, and the move left behind something the rules
 * cannot check either way: the host is now presentational and takes its list
 * as a prop, which is exactly the shape `helpers/render.ts` mounts.
 *
 * What a source scan was approximating, and what these say instead: that an
 * empty queue draws NOTHING rather than an empty container, that the action
 * button is announced by the label a caller passed, that pressing the body
 * dismisses and pressing the action runs the caller's handler BEFORE the
 * dismissal, and that each toast type reaches the screen in its own colours.
 *
 * The source cases in `toast-action.test.ts` stay where they are: they pin the
 * timing shape (`toastDisplayMs`, the hold/release pair, the ref the timeout
 * reads), which is about how the component is WRITTEN rather than about what
 * it draws, and a harness with no real timers cannot say anything about it.
 */

type Toast = {
  id: number;
  type: "success" | "error" | "info";
  title?: string;
  message: string;
  action?: { label: string; onPress: () => void };
};

async function ToastHostElement(toasts: Toast[], onDismiss: (id: number) => void) {
  const { ToastHost } = (await import("@/components/toast-host")) as {
    ToastHost: (props: { toasts: Toast[]; onDismiss: (id: number) => void }) => unknown;
  };
  return createElement(ToastHost as never, { toasts, onDismiss });
}

const toast = (over: Partial<Toast> = {}): Toast => ({
  id: 1,
  type: "info",
  message: "Saved",
  ...over,
});

/** Every Pressable in the tree, in document order. */
const pressables = (nodes: TestNode[]) => nodes.filter((node) => node.type === "Pressable");

describe("the toast host draws what it is given", () => {
  it("renders nothing at all when the queue is empty", async () => {
    // Not an empty container: the host is `position: absolute` with a
    // `zIndex` of 9999, so a stray wrapper would sit over the whole app
    // swallowing presses at the top of every screen.
    const result = render(await ToastHostElement([], () => {}));
    assert.deepEqual(result.root.children, []);
  });

  it("draws one toast's message, and its title when there is one", async () => {
    const result = render(
      await ToastHostElement([toast({ title: "Collection saved", message: "3 items moved" })], () => {}),
    );
    assert.deepEqual(result.texts(), ["Collection saved", "3 items moved"]);
  });

  it("omits the title element entirely rather than drawing an empty one", async () => {
    const result = render(await ToastHostElement([toast()], () => {}));
    assert.deepEqual(result.texts(), ["Saved"]);
  });

  it("stacks every queued toast", async () => {
    const result = render(
      await ToastHostElement(
        [toast({ id: 1, message: "one" }), toast({ id: 2, message: "two" })],
        () => {},
      ),
    );
    assert.deepEqual(result.texts(), ["one", "two"]);
  });
});

describe("the toast host is operable", () => {
  it("dismisses the toast whose body was pressed, by id", async () => {
    // By id and not by index: two toasts and a host that dismissed "the first"
    // would close the wrong one every time the second was tapped.
    const dismissed: number[] = [];
    const result = render(
      await ToastHostElement(
        [toast({ id: 7, message: "one" }), toast({ id: 9, message: "two" })],
        (id) => dismissed.push(id),
      ),
    );
    result.press(pressables(result.all())[1]);
    assert.deepEqual(dismissed, [9]);
  });

  it("announces the action button by the label the caller passed", async () => {
    // The label is a translated string rather than a key — the overlay is
    // below the i18n context — so a screen reader hears whatever the caller
    // said, and this is what says the prop reaches the element.
    const result = render(
      await ToastHostElement(
        [toast({ action: { label: "Undo", onPress: () => {} } })],
        () => {},
      ),
    );
    const action = pressables(result.all())[1];
    assert.equal(action.props.accessibilityLabel, "Undo");
    assert.equal(action.props.accessibilityRole, "button");
    assert.deepEqual(result.texts(), ["Saved", "Undo"]);
  });

  it("runs the action BEFORE the dismissal, so a throw cannot spend the button", async () => {
    const order: string[] = [];
    const result = render(
      await ToastHostElement(
        [toast({ action: { label: "Undo", onPress: () => order.push("action") } })],
        () => order.push("dismiss"),
      ),
    );
    result.press(pressables(result.all())[1]);
    assert.deepEqual(order, ["action", "dismiss"]);
  });

  it("draws no action button when the toast has no action", async () => {
    const result = render(await ToastHostElement([toast()], () => {}));
    assert.equal(pressables(result.all()).length, 1);
  });
});

describe("each type reaches the screen in its own colours", () => {
  const accentOf = (result: ReturnType<typeof render>) =>
    styleOf(
      result
        .all()
        .filter((node) => node.type === "View")
        .find((node) => "backgroundColor" in styleOf(node))!,
    ).backgroundColor;

  it("colours the success accent and text from the success tokens", async () => {
    const result = render(await ToastHostElement([toast({ type: "success" })], () => {}));
    assert.equal(accentOf(result), SUCCESS_GREEN_3);
    assert.equal(styleOf(result.findByType("Text")).color, SUCCESS_DEEP);
  });

  it("colours the error accent and text from the danger tokens", async () => {
    const result = render(await ToastHostElement([toast({ type: "error" })], () => {}));
    assert.equal(accentOf(result), DANGER_DEEP_7);
    assert.equal(styleOf(result.findByType("Text")).color, DANGER_DEEP_8);
  });

  it("gives the two types different colours, which is the whole point", async () => {
    // The floor under the two above: a palette lookup that had collapsed to
    // one entry would satisfy either of them written on its own.
    assert.notEqual(SUCCESS_GREEN_3, DANGER_DEEP_7);
    assert.notEqual(SUCCESS_DEEP, DANGER_DEEP_8);
  });
});
