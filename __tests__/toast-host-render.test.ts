import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";

import {
  DANGER_DEEP_7,
  DANGER_DEEP_8,
  SUCCESS_DEEP,
  SUCCESS_GREEN_3,
} from "@/lib/design-tokens";
import { TOAST_ACTION_DISPLAY_MS, TOAST_DISPLAY_MS } from "@/lib/toast-timing";

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
 * The source cases in `toast-action.test.ts` stay where they are: they pin how
 * the component is WRITTEN — the ref the timeout reads, the dependency list —
 * which is not what it does. What it DOES with its timer is asserted below,
 * against a captured `setTimeout`, which is the half three of those matches
 * were standing in for.
 */

/** Scheduled timers, in order, while a case holds the global. */
type Scheduled = { delay: number; run: () => void; cleared: boolean };

/**
 * Capture `setTimeout` for the duration of one case.
 *
 * Not a fake clock — nothing here needs time to pass, only to see WHAT was
 * scheduled and WHETHER it was cleared. The real global is restored by the
 * returned function, and every case that takes one calls it, because a suite
 * that left a stubbed timer installed would break every later file in the
 * same process.
 */
function captureTimers(): { timers: Scheduled[]; restore: () => void } {
  const timers: Scheduled[] = [];
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  globalThis.setTimeout = ((run: () => void, delay: number) => {
    timers.push({ delay, run, cleared: false });
    return timers.length as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((handle: number) => {
    const entry = timers[(handle as number) - 1];
    if (entry) entry.cleared = true;
  }) as typeof clearTimeout;
  return {
    timers,
    restore: () => {
      globalThis.setTimeout = realSet;
      globalThis.clearTimeout = realClear;
    },
  };
}

/** The timers still standing — scheduled and not cleared. */
const live = (timers: Scheduled[]) => timers.filter((timer) => !timer.cleared);

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

describe("the dismissal window holds while the user is engaged", () => {
  it("schedules the plain window for a toast with no action", async () => {
    const { timers, restore } = captureTimers();
    try {
      render(await ToastHostElement([toast()], () => {}));
      assert.deepEqual(
        live(timers).map((timer) => timer.delay),
        [TOAST_DISPLAY_MS],
      );
    } finally {
      restore();
    }
  });

  it("schedules the longer window for a toast the user may want to act on", async () => {
    // An undo the user cannot reach in time is worse than no undo at all.
    const { timers, restore } = captureTimers();
    try {
      render(
        await ToastHostElement([toast({ action: { label: "Undo", onPress: () => {} } })], () => {}),
      );
      assert.deepEqual(
        live(timers).map((timer) => timer.delay),
        [TOAST_ACTION_DISPLAY_MS],
      );
      assert.notEqual(TOAST_ACTION_DISPLAY_MS, TOAST_DISPLAY_MS);
    } finally {
      restore();
    }
  });

  it("clears the window on hover and leaves none standing", async () => {
    // The feature: an undo must not expire under the cursor reaching for it.
    // Three source-text matches stood in for this until the overlay moved
    // somewhere a harness could mount it.
    const { timers, restore } = captureTimers();
    try {
      const result = render(
        await ToastHostElement([toast({ action: { label: "Undo", onPress: () => {} } })], () => {}),
      );
      result.fire(pressables(result.all())[0], "onHoverIn");
      assert.deepEqual(live(timers), []);
    } finally {
      restore();
    }
  });

  it("restarts the FULL window on leave, not the remainder", async () => {
    // Deliberate: the user has just looked away from something they were
    // reading, and a 300ms stub would be indistinguishable from a toast that
    // ignored them.
    const { timers, restore } = captureTimers();
    try {
      const result = render(
        await ToastHostElement([toast({ action: { label: "Undo", onPress: () => {} } })], () => {}),
      );
      const body = pressables(result.all())[0];
      result.fire(body, "onHoverIn");
      result.fire(body, "onHoverOut");
      assert.deepEqual(
        live(timers).map((timer) => timer.delay),
        [TOAST_ACTION_DISPLAY_MS],
      );
    } finally {
      restore();
    }
  });

  it("holds on FOCUS too, so a keyboard user gets the same window", async () => {
    // The action button is `focusable`; on the web it is a tab stop, and a
    // toast that expired while its button was focused would be the same bug
    // with a keyboard instead of a mouse.
    const { timers, restore } = captureTimers();
    try {
      const result = render(
        await ToastHostElement([toast({ action: { label: "Undo", onPress: () => {} } })], () => {}),
      );
      result.fire(pressables(result.all())[1], "onFocus");
      assert.deepEqual(live(timers), []);
      result.fire(pressables(result.all())[1], "onBlur");
      assert.deepEqual(
        live(timers).map((timer) => timer.delay),
        [TOAST_ACTION_DISPLAY_MS],
      );
    } finally {
      restore();
    }
  });

  it("dismisses the right toast when its window finally runs out", async () => {
    // The other end of the timer: what the callback actually does, which no
    // source match can say.
    const { timers, restore } = captureTimers();
    try {
      const dismissed: number[] = [];
      render(
        await ToastHostElement([toast({ id: 4 }), toast({ id: 5 })], (id) => dismissed.push(id)),
      );
      live(timers)[1].run();
      assert.deepEqual(dismissed, [5]);
    } finally {
      restore();
    }
  });
});
