import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";

import { installNativeModuleStubs, render } from "./helpers/render";
import { drain, installSpyToast, installStubI18n } from "./helpers/mount-provider";
import { mockModule } from "./helpers/render";
import { readSource, sourceFiles } from "./helpers/source-files";

/**
 * The user-visible half of the hydration gate.
 *
 * Five providers refuse to persist when a hydrate could not read the store, and
 * that refusal is correct — the alternative was writing an empty state over the
 * user's real blobs. What it is not is free: the session that follows looks
 * completely normal and loses every edit at relaunch. This is the toast that
 * says so, and the facts worth pinning are about WHEN it fires and HOW MANY
 * times, neither of which a source scan can answer.
 */

installNativeModuleStubs();

const toasts = installSpyToast();
installStubI18n();

mockModule("@/lib/sentry", { captureException: () => undefined });

type NoticeModule = typeof import("../lib/storage-notice");
type ReportingModule = typeof import("../lib/report-storage-failure");

let notice: NoticeModule | null = null;

/** Whether the provider under test is refusing — reassigned between renders. */
let refusing = false;

function Probe() {
  notice!.useStorageNotice(refusing);
  return createElement("View", null);
}

/** A second provider on the same device, refusing for the same reason. */
function SecondProbe() {
  notice!.useStorageNotice(refusing);
  return createElement("View", null);
}

/**
 * The write half, which is mounted ONCE for the whole app rather than by each
 * provider. `components/storage-notice.tsx` is this and nothing else; the
 * adoption cases below check that `app/_layout.tsx` renders it.
 */
function Listener() {
  notice!.useStorageFailureNotice();
  return createElement("View", null);
}

let reporting: ReportingModule | null = null;

async function load(): Promise<NoticeModule> {
  notice ??= await import("../lib/storage-notice");
  reporting ??= await import("../lib/report-storage-failure");
  return notice;
}

beforeEach(async () => {
  (await load()).__resetStorageNoticeForTests();
  reporting!.__clearStorageFailureObserversForTests();
  reporting!.__resetStorageFailureReportsForTests();
  toasts.length = 0;
  refusing = false;
});

describe("useStorageNotice", () => {
  it("says nothing while the gate is open", async () => {
    await load();
    const tree = render(createElement(Probe));
    await drain(tree);

    assert.deepEqual(toasts, [], "a healthy session must not be interrupted");
    assert.equal(notice!.storageNoticeShown(), false);
  });

  it("raises one error toast the first time a gate refuses", async () => {
    await load();
    refusing = true;
    const tree = render(createElement(Probe));
    await drain(tree);

    assert.deepEqual(toasts, [
      {
        level: "error",
        message: "storagePersistRefusedMessage",
        title: "storagePersistRefusedTitle",
      },
    ]);
  });

  it("an error rather than an info, because the session is losing data", async () => {
    await load();
    refusing = true;
    const tree = render(createElement(Probe));
    await drain(tree);

    assert.equal(toasts[0]?.level, "error");
  });

  it("fires when a gate closes AFTER the first render, which is when a hydrate resolves", async () => {
    await load();
    const tree = render(createElement(Probe));
    await drain(tree);
    assert.deepEqual(toasts, [], "nothing has been decided yet on the first render");

    refusing = true;
    tree.rerender();
    await drain(tree);

    assert.equal(toasts.length, 1);
  });

  it("says it once for the whole device, not once per provider", async () => {
    await load();
    refusing = true;
    const tree = render(
      createElement("View", null, createElement(Probe), createElement(SecondProbe)),
    );
    await drain(tree);

    assert.equal(
      toasts.length,
      1,
      "a store that cannot be read fails every provider that reads it; five toasts is worse than one",
    );
  });

  it("does not repeat itself on a later re-render", async () => {
    await load();
    refusing = true;
    const tree = render(createElement(Probe));
    await drain(tree);

    refusing = false;
    tree.rerender();
    refusing = true;
    tree.rerender();
    await drain(tree);

    assert.equal(toasts.length, 1);
  });

  it("stays latched across a whole session, sign-out included", async () => {
    await load();
    refusing = true;
    const first = render(createElement(Probe));
    await drain(first);

    // A second mount is a new provider tree, which is what a sign-out and a
    // sign-in produce. The device is still broken; the user already knows.
    const second = render(createElement(Probe));
    await drain(second);

    assert.equal(toasts.length, 1);
  });
});

describe("useStorageFailureNotice — a write that was rejected mid-session", () => {
  it("says the same thing when a persisted blob could not be written", async () => {
    await load();
    const tree = render(createElement(Listener));
    await drain(tree);
    assert.deepEqual(toasts, [], "nothing has failed yet");

    reporting!.reportStorageFailure(
      "use-persisted-blob.setItem",
      "collectables-items-v1-user-a",
      new Error("QuotaExceededError"),
    );

    assert.deepEqual(toasts, [
      {
        level: "error",
        message: "storagePersistRefusedMessage",
        title: "storagePersistRefusedTitle",
      },
    ]);
  });

  it("hears a write from a module with no React in it", async () => {
    await load();
    const tree = render(createElement(Listener));
    await drain(tree);

    reporting!.reportStorageFailure("sync-cursors.setItem", "sync-cursor", new Error("full"));

    assert.equal(toasts.length, 1, "the observer is what reaches the UI from lib/sync-cursors.ts");
  });

  it("ignores a failed READ, which costs a default rather than the user's data", async () => {
    await load();
    const tree = render(createElement(Listener));
    await drain(tree);

    reporting!.reportStorageFailure("locale-helpers.getItem", "currency", new Error("blocked"));

    assert.deepEqual(
      toasts,
      [],
      "a currency preference that could not be read is not 'changes are not being saved'",
    );
  });

  it("still fires when the Sentry budget for that pair is already spent", async () => {
    await load();
    // A read on the same keyspace, before the tree exists, spends nothing the
    // write needs — but it does spend its own budget entry, and an earlier
    // draft gated the observer behind the same check.
    reporting!.reportStorageFailure(
      "use-persisted-blob.setItem",
      "collectables-items-v1-user-a",
      new Error("full"),
    );
    const tree = render(createElement(Listener));
    await drain(tree);

    reporting!.reportStorageFailure(
      "use-persisted-blob.setItem",
      "collectables-items-v1-user-a",
      new Error("full"),
    );

    assert.equal(toasts.length, 1, "the budget is Sentry's; the latch is the user's");
  });

  it("hands back an unsubscribe, which is what the effect returns on unmount", async () => {
    await load();
    let heard = 0;
    const unsubscribe = reporting!.observeStorageFailures(() => {
      heard += 1;
    });

    reporting!.reportStorageFailure("chat-context.setItem", "collectables-chats-v1", new Error("x"));
    unsubscribe();
    reporting!.reportStorageFailure("chat-context.setItem", "collectables-chats-v1", new Error("x"));

    // Asserted on the registry rather than through a React unmount: the render
    // harness has no unmount phase (it cleans an effect up only when its
    // dependencies change), so a case that removed the probe from the tree
    // would pass whether or not the hook returned its unsubscribe at all.
    assert.equal(heard, 1, "an observer that outlives its toast host is a leak");
  });

  it("a throwing observer does not take the storage catch down with it", async () => {
    await load();
    const unsubscribe = reporting!.observeStorageFailures(() => {
      throw new Error("observer exploded");
    });

    assert.doesNotThrow(() =>
      reporting!.reportStorageFailure("tombstones.setItem", "tombstones", new Error("full")),
    );
    unsubscribe();
  });
});

/**
 * One listener for a registry that already reaches the whole tree.
 *
 * The latch means the OUTCOME is one toast however many providers subscribe,
 * which is exactly why nothing looked wrong while five of them did: the cost
 * was five closures and five `Set` entries, invisible from every assertion
 * about what the user sees. These cases assert the count instead.
 */
describe("the write half subscribes once, not once per provider", () => {
  it("a gated provider adds no observer at all", async () => {
    await load();
    const tree = render(
      createElement("View", null, createElement(Probe), createElement(SecondProbe)),
    );
    await drain(tree);

    assert.equal(
      reporting!.__storageFailureObserverCountForTests(),
      0,
      "the gate half is per provider; the registry half is per device",
    );
  });

  it("the listener adds exactly one, and a re-render does not add a second", async () => {
    await load();
    const tree = render(createElement(Listener));
    await drain(tree);
    assert.equal(reporting!.__storageFailureObserverCountForTests(), 1);

    tree.rerender();
    await drain(tree);

    assert.equal(
      reporting!.__storageFailureObserverCountForTests(),
      1,
      "the effect depends on a memoised raise, so a render is not a subscription",
    );
  });

  it("both halves raise through the same latch", async () => {
    await load();
    refusing = true;
    const tree = render(createElement("View", null, createElement(Probe), createElement(Listener)));
    await drain(tree);
    assert.equal(toasts.length, 1, "the gate said it");

    reporting!.reportStorageFailure("tombstones.setItem", "tombstones", new Error("full"));

    assert.equal(
      toasts.length,
      1,
      "a device that fails both ways is one broken device, not two sentences",
    );
  });

  it("says nothing about a rejected write when the listener is not mounted", async () => {
    await load();
    const tree = render(createElement(Probe));
    await drain(tree);

    reporting!.reportStorageFailure("tombstones.setItem", "tombstones", new Error("full"));

    // Not a wish — a statement of what the split costs. The providers no longer
    // carry the write half, so `app/_layout.tsx` mounting `<StorageNotice />`
    // is the whole of it, which is why the adoption cases below check for it.
    assert.deepEqual(toasts, [], "the providers hear writes through nobody now");
  });
});

// ---------------------------------------------------------------------------
// Adoption
// ---------------------------------------------------------------------------

/**
 * Every provider that can refuse to persist must be able to say so. The rule is
 * "declares `hydrationSafeToPersist`" rather than a list, because the list is
 * the thing that goes stale — a sixth provider growing the flag is exactly the
 * case a hand-written list would miss.
 */
const PROVIDERS = [
  "lib/chat-context.tsx",
  "lib/collections-context.tsx",
  "lib/marketplace-context.tsx",
  "lib/premium-context.tsx",
  "lib/social-context.tsx",
];

/** Every module in the tree that holds the flag, found rather than listed. */
function gatedModules(): string[] {
  return sourceFiles()
    .filter((relative) => /\bconst \[hydrationSafeToPersist\b/.test(readSource(relative)))
    .slice();
}

describe("every gated provider raises the notice", () => {
  it("the list is every module in the tree that declares the flag", () => {
    assert.deepEqual(
      gatedModules(),
      PROVIDERS,
      "a sixth provider growing a hydration gate joins this list or fails here — which is the point of finding them rather than naming them",
    );
  });

  it("each of them calls useStorageNotice", () => {
    const silent = gatedModules().filter(
      (relative) => !readSource(relative).includes("useStorageNotice("),
    );

    assert.deepEqual(
      silent,
      [],
      "a gate that refuses every write for a session and tells the user nothing is silent data loss",
    );
  });

  it("none of them derives the refusal itself", () => {
    const inlined = gatedModules().filter((relative) =>
      /toast\.\w+\([^)]*storagePersistRefused/.test(readSource(relative)),
    );

    assert.deepEqual(
      inlined,
      [],
      "the once-per-device latch only works if every provider goes through the hook",
    );
  });

  it("and none of them subscribes to the registry any more", () => {
    const subscribers = gatedModules().filter((relative) =>
      readSource(relative).includes("useStorageFailureNotice("),
    );

    assert.deepEqual(
      subscribers,
      [],
      "five providers listening to a module-level registry is five closures for one toast",
    );
  });
});

/**
 * The write half has exactly one host, and it is above the auth gate.
 *
 * A registry with no subscriber is silent in the same way the providers were
 * before the notice existed, so the mount is the adoption requirement now. It
 * is checked by source rather than by mounting `app/_layout.tsx`, which pulls
 * in expo-router, the font loader and eight providers.
 */
describe("the listener is mounted once, under the toast provider", () => {
  const LISTENER = "components/storage-notice.tsx";
  /** The module that DECLARES the hook; its signature reads like a call. */
  const DECLARATION = "lib/storage-notice.ts";

  /**
   * Every module that CALLS the write-half hook, found rather than listed.
   *
   * `lib/storage-notice.ts` is excluded by name because it declares the hook,
   * and a signature reads the same as a call to any regex that does not parse.
   */
  function subscribingModules(): string[] {
    return sourceFiles()
      .filter((relative) => relative !== DECLARATION)
      .filter((relative) => /\buseStorageFailureNotice\(\s*\)/.test(readSource(relative)));
  }

  it("exactly one module in the tree calls the hook", () => {
    assert.deepEqual(
      subscribingModules(),
      [LISTENER],
      "a second caller is a second observer on a registry that needs one",
    );
  });

  it("app/_layout.tsx renders it", () => {
    assert.match(
      readSource("app/_layout.tsx"),
      /<StorageNotice\s*\/>/,
      "the hook is only reached by mounting the component; nothing else does",
    );
  });

  it("inside ToastProvider, which is where its two contexts exist", () => {
    const layout = readSource("app/_layout.tsx");
    const opened = layout.indexOf("<ToastProvider>");
    const mounted = layout.indexOf("<StorageNotice />");
    const closed = layout.indexOf("</ToastProvider>");

    assert.ok(opened >= 0 && mounted >= 0 && closed >= 0, "all three tags are in the tree");
    assert.ok(
      opened < mounted && mounted < closed,
      "useToast and useI18n both throw outside their providers, and I18nProvider is above ToastProvider",
    );
  });

  it("above the auth gate, so a sign-out does not unmount it", () => {
    const layout = readSource("app/_layout.tsx");

    assert.ok(
      layout.indexOf("<StorageNotice />") < layout.indexOf("<AuthProvider>"),
      "a store that fills up during an account switch is exactly when the user needs telling",
    );
  });
});
