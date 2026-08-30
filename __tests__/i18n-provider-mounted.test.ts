import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";

import { installSpyCapture } from "./helpers/mount-provider";
import { installNativeModuleStubs, mockModule, render } from "./helpers/render";

/**
 * `I18nProvider`, mounted.
 *
 * Six providers were logged as "untested behaviourally" and this is the one
 * repeatedly named cheapest — one `setLanguage` call under a mounted provider,
 * no auth or social scaffolding — and also the one whose bug was the worst of
 * the six: `setLanguage` rejected into a `void` caller, so a device that could
 * not write dropped the choice as an UNHANDLED REJECTION, with the language
 * applied to the screen and nothing on disk. The fix is a year of source
 * comments and a `try`/`catch`; what nothing checked is the property those
 * comments are about, which is only visible by calling it: the promise this
 * provider hands a `void` caller must SETTLE, whatever the store did.
 *
 * `mockModule` stands in for AsyncStorage, Sentry (through
 * `reportStorageFailure`) and `trackEvent`. Nothing under `lib/` may be
 * imported at module scope — see `mock-module-import-order.test.ts`, which
 * sweeps for exactly that and exists because this harness's first suite got it
 * wrong.
 */

installNativeModuleStubs();

const reads: string[] = [];
const writes: { key: string; value: string }[] = [];
const events: { name: string; props: unknown }[] = [];
let stored: string | null = null;
let readError: Error | null = null;
let writeError: Error | null = null;

mockModule("@react-native-async-storage/async-storage", {
  default: {
    getItem: async (key: string) => {
      reads.push(key);
      if (readError) throw readError;
      return stored;
    },
    setItem: async (key: string, value: string) => {
      if (writeError) throw writeError;
      writes.push({ key, value });
      stored = value;
    },
  },
});

const captured = installSpyCapture();

mockModule("@/lib/analytics", {
  trackEvent: (name: string, props: unknown) => events.push({ name, props }),
});

type I18nModule = typeof import("../lib/i18n-context");
type ContextValue = ReturnType<I18nModule["useI18n"]>;

let i18n: I18nModule | null = null;
let seen: ContextValue | null = null;

function Probe() {
  seen = i18n!.useI18n();
  return createElement("View", null);
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function mount() {
  i18n ??= await import("../lib/i18n-context");
  (await import("../lib/report-storage-failure")).__resetStorageFailureReportsForTests();
  const tree = render(createElement(i18n.I18nProvider, null, createElement(Probe)));
  await settle();
  tree.rerender();
  return tree;
}

beforeEach(() => {
  reads.length = 0;
  writes.length = 0;
  events.length = 0;
  captured.length = 0;
  stored = null;
  readError = null;
  writeError = null;
  seen = null;
});

describe("I18nProvider — hydrating the stored language", () => {
  it("reads the language key and adopts a stored language", async () => {
    const { LANGUAGE_KEY } = await import("../lib/storage-keys");
    stored = "pl";
    await mount();

    assert.deepEqual(reads, [LANGUAGE_KEY]);
    assert.equal(seen?.language, "pl");
    assert.equal(seen?.ready, true);
  });

  it("defaults to ru with nothing stored, and writes nothing back", async () => {
    await mount();

    assert.equal(seen?.language, "ru");
    assert.equal(seen?.ready, true);
    assert.deepEqual(writes, [], "a read must not turn into a write");
  });

  it("ignores a stored value that is not one of the six languages", async () => {
    stored = "klingon";
    await mount();

    assert.equal(seen?.language, "ru");
    assert.deepEqual(captured, [], "an unknown language is not a storage failure");
  });

  it("a failed read still finishes startup, and reports once", async () => {
    readError = new Error("SecurityError: localStorage is not available");
    await mount();

    // `ready` still flips: the default language is a usable app, and blocking
    // the whole tree on a broken store is worse than starting in Russian.
    assert.equal(seen?.ready, true);
    assert.equal(seen?.language, "ru");
    assert.equal(captured.length, 1);
    assert.equal(captured[0].context.scope, "i18n-context.getItem");
  });
});

describe("I18nProvider — switching the language", () => {
  it("applies the choice, persists it, and reports the switch once", async () => {
    const { LANGUAGE_KEY } = await import("../lib/storage-keys");
    const tree = await mount();

    await seen!.setLanguage("en");
    tree.rerender();

    assert.equal(seen?.language, "en");
    assert.deepEqual(writes, [{ key: LANGUAGE_KEY, value: "en" }]);
    assert.deepEqual(events, [
      { name: "language_switched", props: { language: "en", previousLanguage: "ru" } },
    ]);
  });

  it("re-picking the language already in use tracks nothing", async () => {
    const tree = await mount();

    await seen!.setLanguage("ru");
    tree.rerender();

    assert.deepEqual(events, [], "the same language is not a switch");
    assert.equal(seen?.language, "ru");
  });

  it("switches what t() answers, per language", async () => {
    const tree = await mount();
    const ru = seen!.t("cancel");

    await seen!.setLanguage("de");
    tree.rerender();

    assert.notEqual(seen!.t("cancel"), ru);
    assert.equal(seen!.t("cancel"), "Abbrechen");
  });
});

describe("I18nProvider — a store that cannot be written", () => {
  beforeEach(() => {
    writeError = new Error("QuotaExceededError");
  });

  /**
   * The whole reason `setLanguage` holds a `try`/`catch` rather than letting
   * the write reject. Its one caller is `void setLanguage(...)`, and a `void`
   * on a rejecting promise is an unhandled rejection — a redbox in dev, a
   * silent drop in production. Asserting it by `await` is the strongest form
   * available here: `assert.doesNotReject` would pass on a promise that was
   * never returned at all.
   */
  it("settles rather than rejecting, because its caller is `void setLanguage(...)`", async () => {
    await mount();

    await assert.doesNotReject(() => seen!.setLanguage("es"));
  });

  it("keeps the language the user picked for this session", async () => {
    const tree = await mount();

    await seen!.setLanguage("es");
    tree.rerender();

    // The in-memory change already happened and stays: the screen is in
    // Spanish, and the next launch is the thing that has lost it.
    assert.equal(seen?.language, "es");
    assert.deepEqual(writes, []);
  });

  it("reports the failed write, because nothing else would mention it", async () => {
    await mount();

    await seen!.setLanguage("es");

    assert.equal(captured.length, 1);
    assert.equal(captured[0].context.scope, "i18n-context.setItem");
  });
});
