import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";

import { installNativeModuleStubs, render } from "./helpers/render";
import { drain, installSpyToast, installStubI18n } from "./helpers/mount-provider";
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

type NoticeModule = typeof import("../lib/hydration-gate-notice");

let notice: NoticeModule | null = null;

/** Whether the provider under test is refusing — reassigned between renders. */
let refusing = false;

function Probe() {
  notice!.useHydrationGateNotice(refusing);
  return createElement("View", null);
}

/** A second provider on the same device, refusing for the same reason. */
function SecondProbe() {
  notice!.useHydrationGateNotice(refusing);
  return createElement("View", null);
}

async function load(): Promise<NoticeModule> {
  notice ??= await import("../lib/hydration-gate-notice");
  return notice;
}

beforeEach(async () => {
  (await load()).__resetHydrationGateNoticeForTests();
  toasts.length = 0;
  refusing = false;
});

describe("useHydrationGateNotice", () => {
  it("says nothing while the gate is open", async () => {
    await load();
    const tree = render(createElement(Probe));
    await drain(tree);

    assert.deepEqual(toasts, [], "a healthy session must not be interrupted");
    assert.equal(notice!.hydrationGateNoticeShown(), false);
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

  it("each of them calls useHydrationGateNotice", () => {
    const silent = gatedModules().filter(
      (relative) => !readSource(relative).includes("useHydrationGateNotice("),
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
});
