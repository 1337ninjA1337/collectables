import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";

import { findLocaleBlock } from "@/lib/i18n-source";

import { installNativeModuleStubs, render } from "./helpers/render";
import {
  drain,
  installSpyCapture,
  installSpyToast,
  installStubI18n,
} from "./helpers/mount-provider";
import { readI18nSource } from "./helpers/i18n-source-file";
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

const captured = installSpyCapture();

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
  captured.length = 0;
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

    // The quota spelling in the error is why this reads a full-storage sentence
    // rather than the gate's: same title, same latch, the fix differs. The WEB
    // one, because the harness's `react-native` stub reports `Platform.OS ===
    // "web"` — which is also the build this repo deploys.
    assert.deepEqual(toasts, [
      {
        level: "error",
        message: "storageFullWebMessage",
        title: "storagePersistRefusedTitle",
      },
    ]);
  });

  it("tells a full store to free up space rather than to restart", async () => {
    await load();
    const tree = render(createElement(Listener));
    await drain(tree);

    const quota = new Error("The quota has been exceeded.");
    quota.name = "QuotaExceededError";
    reporting!.reportStorageFailure("chat-context.setItem", "collectables-chats-v1", quota);

    assert.deepEqual(toasts, [
      {
        level: "error",
        message: "storageFullWebMessage",
        title: "storagePersistRefusedTitle",
      },
    ]);
  });

  it("keeps the restart sentence for a store that is merely blocked", async () => {
    await load();
    const tree = render(createElement(Listener));
    await drain(tree);

    const blocked = new Error("localStorage is not available");
    blocked.name = "SecurityError";
    reporting!.reportStorageFailure("chat-context.setItem", "collectables-chats-v1", blocked);

    assert.equal(toasts[0]?.message, "storagePersistRefusedMessage");
  });

  it("hears a write from a module with no React in it", async () => {
    await load();
    const tree = render(createElement(Listener));
    await drain(tree);

    reporting!.reportStorageFailure("sync-cursors.setItem", "sync-cursor", new Error("full"));

    assert.equal(toasts.length, 1, "the observer is what reaches the UI from lib/sync-cursors.ts");
  });

  it("ignores a language that could not be SAVED, for the reason it ignores a read", async () => {
    await load();
    const tree = render(createElement(Listener));
    await drain(tree);

    reporting!.reportStorageFailure("i18n-context.setItem", "language", new Error("full"));

    assert.deepEqual(
      toasts,
      [],
      "the next launch opens in the previous language; that is not 'changes aren't being saved'",
    );
  });

  it("still REPORTS the quiet writes, which is the other half of ignoring them", async () => {
    const module = await load();
    const tree = render(createElement(Listener));
    await drain(tree);

    // The filter is the OBSERVER's, not the reporter's, and the difference is
    // the whole diagnosis for three sites. A regression that moved
    // `losesUserData` into `reportStorageFailure` would pass the case above —
    // no toast, correctly — and silently stop sending Sentry anything about a
    // language, a currency or an FX table that will not persist.
    for (const site of module.PREFERENCE_WRITE_SITES) {
      reporting!.reportStorageFailure(site, `preference-${site}`, new Error("full"));
    }

    assert.deepEqual(toasts, [], "still nothing on screen");
    assert.deepEqual(
      captured.map((report) => report.context.scope),
      [...module.PREFERENCE_WRITE_SITES],
      "quiet to the user is not quiet to the crash report",
    );
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

  it("unsubscribes when its host unmounts, rather than outliving it", async () => {
    await load();
    const tree = render(createElement(Listener));
    await drain(tree);
    assert.equal(reporting!.__storageFailureObserverCountForTests(), 1);

    tree.unmount();

    assert.equal(
      reporting!.__storageFailureObserverCountForTests(),
      0,
      "an observer that outlives its toast host is a leak, and its toast reaches nobody",
    );
  });

  it("and says nothing after that, because the host that would show it is gone", async () => {
    await load();
    const tree = render(createElement(Listener));
    await drain(tree);
    tree.unmount();

    reporting!.reportStorageFailure("chat-context.setItem", "collectables-chats-v1", new Error("x"));

    assert.deepEqual(toasts, [], "the effect's cleanup is what makes this true");
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

/**
 * Which writes are worth a sentence, and which are a preference.
 *
 * The read filter always made this judgement — "a currency that could not be
 * read costs a default, not their data" — and the write half was applying it to
 * half the cases: a language that could not be SAVED raised "Changes aren't
 * being saved", which is a claim about the user's collections.
 */
describe("the write filter", () => {
  it("names every write site exactly once, across the two halves", async () => {
    const module = await load();
    const reportingModule = reporting!;
    const writes = reportingModule.STORAGE_FAILURE_SITES.filter(module.isWriteFailure);

    assert.deepEqual(
      [...module.DATA_WRITE_SITES, ...module.PREFERENCE_WRITE_SITES].sort(),
      [...writes].sort(),
      "a new .setItem site is a decision — loud by default, and this case is where somebody makes it",
    );
    assert.deepEqual(
      module.DATA_WRITE_SITES.filter((site) => module.PREFERENCE_WRITE_SITES.includes(site)),
      [],
      "the halves are disjoint",
    );
  });

  it("holds the three preferences and nothing else", async () => {
    const module = await load();

    assert.deepEqual(
      [...module.PREFERENCE_WRITE_SITES],
      ["i18n-context.setItem", "locale-helpers.setItem", "currency-rates.setItem"],
      "a language, a currency and a cached FX table — a default and a refetch, not data",
    );
  });

  it("does not silence a read on the same module as a quiet write", async () => {
    const module = await load();

    // `locale-helpers.setItem` is quiet; the gate half is what covers the reads,
    // and losesUserData must answer false for both halves of a read pair rather
    // than for the whole module.
    assert.equal(module.losesUserData("locale-helpers.getItem"), false);
    assert.equal(module.losesUserData("chat-context.getItem"), false);
    assert.equal(module.losesUserData("chat-context.setItem"), true);
  });
});

/**
 * `"full"` is one error class and two situations, and the fix is not the same.
 *
 * On a phone the store is the device's disk and "free up space" is a thing the
 * user can go and do. On web the quota is PER-ORIGIN: this site ran out of its
 * slice, and the phone's storage screen does not list this app at all. The
 * native sentence sends a browser user deleting photos over a limit that has
 * nothing to do with them, and web is the build this repo deploys.
 *
 * The key selection is a pure function taking the OS because the harness's
 * `react-native` stub reports `"web"` and cannot report anything else — a hook
 * reading `Platform` directly would leave the NATIVE sentence unreachable from
 * any case, which is the one this repo's own CI would never have run.
 */
describe("which full-storage sentence a platform gets", () => {
  it("sends a browser to its own quota and a phone to its storage screen", async () => {
    const module = await load();

    assert.equal(module.storageNoticeMessageKey("full", "web"), "storageFullWebMessage");
    assert.equal(module.storageNoticeMessageKey("full", "ios"), "storageFullMessage");
    assert.equal(module.storageNoticeMessageKey("full", "android"), "storageFullMessage");
  });

  it("gives every platform the same sentence when the store is merely blocked", async () => {
    const module = await load();

    // A `SecurityError` behind a privacy setting reads the same everywhere, and
    // splitting it would be two strings for one situation.
    for (const os of ["web", "ios", "android", "windows"]) {
      assert.equal(
        module.storageNoticeMessageKey("unavailable", os),
        "storagePersistRefusedMessage",
        `${os} must get the restart sentence for a store that is not full`,
      );
    }
  });

  it("never tells a web user to clear this site's data", () => {
    // The browser's own remedy for a full origin is exactly the action that
    // destroys what the toast is warning the user they might lose. Freeing
    // space on the DEVICE is the honest half — every engine sizes the origin
    // quota against free disk — so it is both true and safe.
    // Through the shared reader and the shared parser rather than a regex over
    // the whole file: a `key:[\s\S]*?SHAPE` match is satisfied by the shape
    // turning up under a LATER key, which is the mistake `findLocaleBlock` and
    // its `values` map exist to end.
    const source = readI18nSource();

    for (const language of ["en", "ru", "be", "pl", "de", "es"]) {
      const block = findLocaleBlock(source, language);
      assert.ok(block, `no \`const ${language}\` translation map in the source`);
      const sentence = block.values.get("storageFullWebMessage");
      assert.ok(
        sentence,
        `${language} does not write storageFullWebMessage — inheriting the English one would tell a browser user the wrong thing in their own language`,
      );
      assert.doesNotMatch(
        sentence.toLowerCase(),
        /clear|очист|ачыс|wyczy|löschen|borrar/,
        `${language}: ${sentence} tells the user to clear data — that is the one action that loses what this toast exists to warn about`,
      );
    }
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
