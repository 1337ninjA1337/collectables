import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactElement } from "react";

import {
  autoUnmount,
  installNativeModuleStubs,
  mockModule,
  render,
  type TestNode,
} from "./helpers/render";

/**
 * The two status surfaces a user who cannot see them had no way to learn about.
 *
 * The sync pill says a write is parked and the realtime pill says the socket
 * has dropped. Both appeared, sat there and vanished in silence: nothing in
 * either component reached the accessibility tree as a CHANGE, so the only way
 * to find out was to go looking for a node that may not be there.
 *
 * ## Why a region and not `announceMessage`
 *
 * Both are statuses rather than interruptions. The app's one announcement
 * channel is assertive — it exists so a keyboard reorder can cut off the
 * position the user was at three presses ago — and cutting somebody off
 * mid-sentence to say three changes are queued is the wrong trade. A polite
 * live region waits for a pause, which is what a status is worth.
 *
 * ## What these cases are actually about: the wrapper
 *
 * A live region announces a CHANGE to text it already had. A node carrying
 * `aria-live` that is inserted with its text already inside it is usually not
 * announced at all — the same lesson `lib/announce.web.ts` opens with and the
 * reason `ensureLiveRegion` exists. So the region has to be mounted BEFORE the
 * pill it will carry, which is the one thing a source regex cannot check and
 * the reason this file renders instead.
 *
 * Both spellings of the prop, because the platforms disagree on the name:
 * react-native-web forwards `aria-live` to the DOM node, Android reads
 * `accessibilityLiveRegion`, and iOS has no live regions at all.
 */

let pending = { collections: 0, social: 0, chat: 0 };
let connectionState: string | null = "online";
let notice: "offline" | "reconnected" | null = null;
/** Every `online` the pill has asked the notice hook about. */
const noticeAskedAbout: boolean[] = [];

mockModule("@/lib/collections-context", {
  useCollections: () => ({ pendingSyncCount: pending.collections }),
});
mockModule("@/lib/social-context", {
  useSocial: () => ({ pendingSyncCount: pending.social }),
});
mockModule("@/lib/chat-context", {
  useChat: () => ({ pendingSyncCount: pending.chat }),
});
mockModule("@/lib/i18n-context", {
  useI18n: () => ({
    t: (key: string, params?: { count?: number }) =>
      params?.count === undefined ? key : `${key}:${params.count}`,
  }),
});
mockModule("@/lib/realtime-status-context", {
  useOptionalRealtimeStatus: () => (connectionState === null ? null : { connectionState }),
});
/**
 * The notice is handed to the pill rather than timed out of it.
 *
 * WHEN each notice appears — the grace before a drop is reported, the window a
 * reconnection stays up, and the blip that is neither — is
 * `connection-notice.test.ts`'s, under its own short windows. What is here is
 * the pill: which sentence each notice renders, and that the region carrying
 * it was in the tree first. Driving the real hook would mean waiting out a
 * 1.5s grace per case to assert a string.
 */
mockModule("@/lib/use-connection-notice", {
  useConnectionNotice: (online: boolean) => {
    noticeAskedAbout.push(online);
    return notice;
  },
});

installNativeModuleStubs();
autoUnmount();

beforeEach(() => {
  pending = { collections: 0, social: 0, chat: 0 };
  connectionState = "online";
  notice = null;
  noticeAskedAbout.length = 0;
});

/** Every node in the tree that declares itself a polite live region. */
function politeRegions(nodes: TestNode[]): TestNode[] {
  return nodes.filter((node) => node.props?.["aria-live"] === "polite");
}

async function mountSync() {
  const { SyncStatusPill } = await import("@/components/sync-status-pill");
  return render(createElement(SyncStatusPill) as ReactElement);
}

async function mountRealtime() {
  const { RealtimeStatusPill } = await import("@/components/realtime-status-pill");
  return render(createElement(RealtimeStatusPill) as ReactElement);
}

describe("the sync pill's live region", () => {
  it("is in the tree before there is anything to announce", async () => {
    // The whole mechanism. A region inserted together with its text is a new
    // node, not a changed one, and a new node is announced by nothing.
    const tree = await mountSync();

    const regions = politeRegions(tree.all());
    assert.equal(regions.length, 1, "the region must be mounted while the queues are empty");
    assert.deepEqual(tree.texts(), [], "and it must be carrying nothing");
  });

  it("carries both spellings of the prop", async () => {
    const tree = await mountSync();

    const [region] = politeRegions(tree.all());
    assert.equal(region.props["aria-live"], "polite");
    assert.equal(
      region.props.accessibilityLiveRegion,
      "polite",
      "react-native-web reads the first and Android reads this one",
    );
  });

  it("puts the pill inside the region it already had", async () => {
    pending = { collections: 2, social: 1, chat: 0 };
    const tree = await mountSync();

    const regions = politeRegions(tree.all());
    assert.equal(regions.length, 1, "still one region, not a second one beside it");
    assert.deepEqual(tree.texts(), ["syncingPill:3"], "the count is the sum of all three queues");
  });

  it("says how many changes are queued, to a reader and on screen", async () => {
    pending = { collections: 1, social: 0, chat: 4 };
    const tree = await mountSync();

    const labelled = tree.find((node) => node.props?.accessibilityLabel !== undefined);
    assert.equal(labelled.props.accessibilityLabel, "syncingPillA11y:5");
  });

  it("is polite, so it never cuts off the assertive channel", async () => {
    // `lib/announce.ts` owns the only assertive region in the app, for
    // reordering. A status that interrupted it would mean the user hears half
    // of the sentence about the thing they just did.
    pending = { collections: 1, social: 0, chat: 0 };
    const tree = await mountSync();

    assert.equal(
      tree.all().some((node) => node.props?.["aria-live"] === "assertive"),
      false,
    );
  });

  it("empties the region rather than unmounting it when the queues drain", async () => {
    pending = { collections: 3, social: 0, chat: 0 };
    const tree = await mountSync();
    assert.deepEqual(tree.texts(), ["syncingPill:3"]);

    pending = { collections: 0, social: 0, chat: 0 };
    const drained = tree.rerender();

    assert.equal(politeRegions(drained.all()).length, 1, "the region has to outlive the pill");
    assert.deepEqual(drained.texts(), []);
  });
});

describe("the realtime pill's live region", () => {
  it("is in the tree while the socket is up", async () => {
    const tree = await mountRealtime();

    assert.equal(politeRegions(tree.all()).length, 1);
    assert.deepEqual(tree.texts(), [], "an online socket says nothing");
  });

  it("puts the offline pill inside the region it already had", async () => {
    notice = "offline";
    const tree = await mountRealtime();

    assert.equal(politeRegions(tree.all()).length, 1);
    assert.deepEqual(tree.texts(), ["chatOfflinePill"]);
  });

  it("says the connection came back, in the same region", async () => {
    // The pill used to vanish, which reads as "fixed" to a sighted user and is
    // announced by nothing: text becoming empty is not a sentence.
    notice = "reconnected";
    const tree = await mountRealtime();

    assert.equal(politeRegions(tree.all()).length, 1, "the same region, not a second one");
    assert.deepEqual(tree.texts(), ["chatBackOnlinePill"]);
  });

  it("renders nothing at all where there is no subscription to have a state", async () => {
    // Not the same fact as a connection that is up: a screen with no live data
    // has no opinion, and a region that announced one would be announcing a
    // status nobody is subscribed to.
    connectionState = null;
    notice = "offline";
    const tree = await mountRealtime();

    assert.deepEqual(politeRegions(tree.all()), []);
    assert.deepEqual(tree.texts(), []);
  });

  it("calls connecting the only state that is offline", async () => {
    connectionState = "connecting";
    await mountRealtime();

    assert.deepEqual(noticeAskedAbout, [false]);
  });

  it("calls online and idle both up", async () => {
    // `idle` is a screen with no subscription running. Passing `false` there
    // would claim a connection is down when there is no connection at all.
    for (const state of ["online", "idle"]) {
      noticeAskedAbout.length = 0;
      connectionState = state;
      await mountRealtime();
      assert.deepEqual(noticeAskedAbout, [true], state);
    }
  });

  it("asks even on a screen with no subscription, before the early return", async () => {
    // Hooks cannot be skipped, and `status?.connectionState !== "connecting"`
    // is `true` for `undefined` — which is the right answer for "not offline".
    connectionState = null;
    await mountRealtime();

    assert.deepEqual(noticeAskedAbout, [true]);
  });
});
