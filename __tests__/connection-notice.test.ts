import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactElement } from "react";

import {
  clearedReconnectedNotice,
  CONNECTION_NOTICE_KEYS,
  nextConnectionNotice,
  RECONNECTED_NOTICE_MS,
  type ConnectionNotice,
} from "@/lib/connection-notice";

import { assertDeclaredInEveryLocale } from "./helpers/i18n-locales";
import { readI18nSource } from "./helpers/i18n-source-file";
import { settle } from "./helpers/mount-provider";
import { autoUnmount, installNativeModuleStubs, render } from "./helpers/render";

/**
 * Saying that the connection came back, which is the half that was missing.
 *
 * The offline pill said the socket had dropped and then went quiet when it
 * returned. On screen a pill vanishing reads as "fixed"; in a live region text
 * becoming empty is not a sentence and is announced by nothing. So the user
 * who most needed telling — the one who cannot see the pill — was told the
 * connection broke and was never told it worked again, with a message they had
 * just sent and no way to know whether it had gone.
 *
 * ## Two halves, because the transition outlives the state
 *
 * `nextConnectionNotice` is one change of connection state and
 * `clearedReconnectedNotice` is the timer that ends the window. They are
 * separate functions because the timer can outlive what it was started for:
 * the socket can drop again inside those four seconds, and a clear that wrote
 * `null` unconditionally would erase an `"offline"` the user is currently
 * living through.
 *
 * The hook's own cases drive a real tree, because "a mount at online is not a
 * reconnection" is a claim about the FIRST render and nothing else can ask it.
 */

installNativeModuleStubs();
autoUnmount();

describe("nextConnectionNotice", () => {
  it("says offline while the socket is down", () => {
    assert.equal(nextConnectionNotice(null, false), "offline");
    assert.equal(nextConnectionNotice("reconnected", false), "offline");
    assert.equal(nextConnectionNotice("offline", false), "offline");
  });

  it("says reconnected when a connection that was down comes back", () => {
    assert.equal(nextConnectionNotice("offline", true), "reconnected");
  });

  it("says nothing when a connection that was up stays up", () => {
    assert.equal(nextConnectionNotice(null, true), null);
  });

  it("does not re-announce a reconnection that is still on screen", () => {
    // Any re-render while online runs this, and restarting the window on each
    // one would keep the pill up for as long as the screen is busy.
    assert.equal(nextConnectionNotice("reconnected", true), "reconnected");
  });

  it("has an answer for every pair", () => {
    // Total, which is what lets the hook call it from an updater without a
    // fallback branch that would be the real decision.
    const states: ConnectionNotice[] = [null, "offline", "reconnected"];
    for (const previous of states) {
      for (const online of [true, false]) {
        const answer = nextConnectionNotice(previous, online);
        assert.ok(
          answer === null || answer === "offline" || answer === "reconnected",
          `${String(previous)} + ${online}`,
        );
      }
    }
  });
});

describe("CONNECTION_NOTICE_KEYS", () => {
  it("names a sentence for every notice that renders one", () => {
    // `null` renders nothing, so the table covers exactly the two that do. A
    // third notice would be a compile error at the call sites rather than a
    // pill with no words in it.
    assert.deepEqual(Object.keys(CONNECTION_NOTICE_KEYS).sort(), ["offline", "reconnected"]);
  });

  it("is a table rather than a ternary, so the keys stay visible to the guard", () => {
    // `lib/i18n-key-usage.ts` counts a literal in a record VALUE as a read and
    // the consequent of a `?:` as an expression. Written as a ternary, the
    // first key here stopped being read the moment the second was added, and
    // `lint:orphan-i18n` said so.
    const source = readI18nSource();
    for (const key of Object.values(CONNECTION_NOTICE_KEYS)) {
      assertDeclaredInEveryLocale(source, key);
    }
  });
});

describe("clearedReconnectedNotice", () => {
  it("ends the reconnected window", () => {
    assert.equal(clearedReconnectedNotice("reconnected"), null);
  });

  it("refuses to clear an offline the user is currently living through", () => {
    // The socket dropped again inside the four seconds. The timer from the
    // reconnection is still armed and it is about a fact that has been
    // replaced.
    assert.equal(clearedReconnectedNotice("offline"), "offline");
  });

  it("leaves an already-quiet surface quiet", () => {
    assert.equal(clearedReconnectedNotice(null), null);
  });
});

describe("useConnectionNotice", () => {
  /** Short enough that a case can wait the window out. */
  const HOLD = 20;

  let seen: ConnectionNotice = null;

  beforeEach(() => {
    seen = null;
  });

  async function mount(online: boolean) {
    const { useConnectionNotice } = await import("@/lib/use-connection-notice");
    function Probe({ up }: { up: boolean }) {
      seen = useConnectionNotice(up, HOLD);
      return null;
    }
    const tree = render(createElement(Probe, { up: online }) as ReactElement);
    await settle();
    return {
      tree,
      set: async (up: boolean) => {
        tree.rerender(createElement(Probe, { up }) as ReactElement);
        await settle();
        tree.rerender(createElement(Probe, { up }) as ReactElement);
      },
      wait: async () => {
        await new Promise((resolve) => setTimeout(resolve, HOLD + 10));
        tree.rerender(createElement(Probe, { up: online }) as ReactElement);
      },
    };
  }

  it("says nothing on a session that starts online", async () => {
    // The first render is not a transition, and greeting every user with news
    // about a connection that was never broken is worse than saying nothing.
    await mount(true);

    assert.equal(seen, null);
  });

  it("says offline on a session that starts disconnected", async () => {
    await mount(false);

    assert.equal(seen, "offline");
  });

  it("says reconnected when the socket comes back", async () => {
    const probe = await mount(false);
    assert.equal(seen, "offline");

    await probe.set(true);

    assert.equal(seen, "reconnected");
  });

  it("goes quiet again once the window has passed", async () => {
    const probe = await mount(false);
    await probe.set(true);
    assert.equal(seen, "reconnected");

    await probe.wait();

    assert.equal(seen, null);
  });

  it("goes back to offline if the socket drops inside the window", async () => {
    const probe = await mount(false);
    await probe.set(true);
    assert.equal(seen, "reconnected");

    await probe.set(false);
    assert.equal(seen, "offline");

    // The timer from the reconnection is still armed, and what it would write
    // is a fact that has been replaced.
    await probe.wait();
    assert.equal(seen, "offline", "a stale clear must not erase the live notice");
  });

  it("holds for the documented window by default", () => {
    assert.equal(RECONNECTED_NOTICE_MS, 4000);
  });
});
