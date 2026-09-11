import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactElement } from "react";

import {
  clearedReconnectedNotice,
  CONNECTION_NOTICE_KEYS,
  nextConnectionNotice,
  OFFLINE_GRACE_MS,
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
  /** Short enough that a case can wait either window out. */
  const HOLD = 30;
  const GRACE = 20;

  let seen: ConnectionNotice = null;

  beforeEach(() => {
    seen = null;
  });

  async function mount(online: boolean) {
    const { useConnectionNotice } = await import("@/lib/use-connection-notice");
    let up = online;
    function Probe(props: { up: boolean }) {
      seen = useConnectionNotice(props.up, HOLD, GRACE);
      return null;
    }
    const tree = render(createElement(Probe, { up }) as ReactElement);
    await settle();

    /** Re-renders until the effects have stopped changing anything. */
    const drain = async (passes = 3) => {
      for (let pass = 0; pass < passes; pass += 1) {
        await settle();
        tree.rerender(createElement(Probe, { up }) as ReactElement);
      }
    };

    return {
      tree,
      set: async (next: boolean) => {
        up = next;
        await drain();
      },
      /** Waits out a window, without changing the connection. */
      wait: async (ms: number) => {
        await new Promise((resolve) => setTimeout(resolve, ms));
        await drain();
      },
    };
  }

  it("says nothing on a session that starts online", async () => {
    // The first render is not a transition, and greeting every user with news
    // about a connection that was never broken is worse than saying nothing.
    const probe = await mount(true);
    await probe.wait(GRACE + HOLD + 10);

    assert.equal(seen, null);
  });

  it("says offline on a session that starts disconnected, once the drop has lasted", async () => {
    const probe = await mount(false);
    assert.equal(seen, null, "a mount during a blip must flash nothing");

    await probe.wait(GRACE + 10);

    assert.equal(seen, "offline");
  });

  it("says nothing at all for a blip, in either direction", async () => {
    // The failure this is here for: a polite live region QUEUES, so a phone on
    // a train writes two sentences per drop/recover cycle into something that
    // reads all of them.
    const probe = await mount(true);

    await probe.set(false);
    assert.equal(seen, null);

    await probe.set(true);
    await probe.wait(GRACE + HOLD + 10);

    assert.equal(seen, null, "a connection nobody was told about has nothing to come back from");
  });

  it("says reconnected when a reported outage comes back", async () => {
    const probe = await mount(false);
    await probe.wait(GRACE + 10);
    assert.equal(seen, "offline");

    await probe.set(true);

    assert.equal(seen, "reconnected");
  });

  it("says it immediately, without waiting out a grace of its own", async () => {
    // Coming back is the one the user is already waiting to hear.
    const probe = await mount(false);
    await probe.wait(GRACE + 10);

    await probe.set(true);

    assert.equal(seen, "reconnected");
  });

  it("goes quiet again once the window has passed", async () => {
    const probe = await mount(false);
    await probe.wait(GRACE + 10);
    await probe.set(true);
    assert.equal(seen, "reconnected");

    await probe.wait(HOLD + 10);

    assert.equal(seen, null);
  });

  it("goes back to offline if the socket drops again and stays down", async () => {
    const probe = await mount(false);
    await probe.wait(GRACE + 10);
    await probe.set(true);
    assert.equal(seen, "reconnected");

    await probe.set(false);
    await probe.wait(GRACE + 10);
    assert.equal(seen, "offline");

    // The timer from the reconnection is still armed, and what it would write
    // is a fact that has been replaced.
    await probe.wait(HOLD + 10);
    assert.equal(seen, "offline", "a stale clear must not erase the live notice");
  });

  it("holds and waits for the documented windows by default", () => {
    assert.equal(RECONNECTED_NOTICE_MS, 4000);
    assert.equal(OFFLINE_GRACE_MS, 1500);
    assert.ok(
      OFFLINE_GRACE_MS < RECONNECTED_NOTICE_MS,
      "a drop that is worth reporting is worth leaving up longer than it took to report",
    );
  });
});
