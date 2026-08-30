import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactElement } from "react";

import { autoUnmount, installNativeModuleStubs, mockModule, render } from "./helpers/render";

/**
 * Integration coverage for the `language_switched` no-op guard.
 *
 * `I18nProvider.setLanguage` fires `trackEvent("language_switched", …)` only
 * when `nextLanguage !== language`. That inequality is one line, it looks
 * redundant next to `setLanguageState` (which React would no-op anyway), and
 * it is exactly the kind of line a "simplification" pass deletes — at which
 * point every settings-screen tap on the ALREADY-selected language starts
 * charging the analytics quota and skewing the switch-rate metric.
 *
 * `analytics-auth-flow.test.ts` pins the guard structurally. This suite pins
 * the behaviour: drive the real provider through en → ru → ru and count.
 *
 * Parked for a month as `[needs-dev-dep]` because `<I18nProvider>` pulls
 * AsyncStorage and react-native through its import graph. Both are aliased by
 * `__tests__/helpers/render.ts`, so no dependency was needed after all.
 */

installNativeModuleStubs();
// Ends every tree a case rendered, including the cases that fail early.
autoUnmount();

type TrackedEvent = { name: string; props: unknown };

const trackedEvents: TrackedEvent[] = [];

mockModule("@/lib/analytics", {
  trackEvent: (name: string, props?: unknown) => trackedEvents.push({ name, props }),
  identifyUser: () => {},
  resetUser: () => {},
});

type I18nValue = {
  language: string;
  ready: boolean;
  setLanguage: (next: string) => Promise<void>;
  t: (key: string) => string;
  languageOptions: { code: string; label: string }[];
};

/**
 * Mounts the real provider with a probe inside it, and returns a handle that
 * re-renders after each `setLanguage` so the next call sees the updated
 * `language`. The harness does not auto-flush a `setState` fired outside a
 * render pass — which makes the re-render explicit here, and that is the point
 * at which the provider's `useMemo` rebuilds the context value.
 */
async function mountProvider() {
  const { I18nProvider, useI18n } = await import("@/lib/i18n-context");

  let latest: I18nValue | null = null;
  function Probe() {
    latest = useI18n() as unknown as I18nValue;
    return null;
  }

  const tree = render(
    createElement(I18nProvider, null, createElement(Probe)) as ReactElement,
  );

  return {
    tree,
    get value(): I18nValue {
      assert.ok(latest, "the probe must have rendered inside the provider");
      return latest;
    },
    async setLanguage(next: string) {
      await this.value.setLanguage(next);
      tree.rerender();
    },
  };
}

function languageSwitches(): TrackedEvent[] {
  return trackedEvents.filter((event) => event.name === "language_switched");
}

beforeEach(async () => {
  trackedEvents.length = 0;
  // `setLanguage` persists to AsyncStorage, and the stub's store is module
  // scope — without this, the fourth test's mount would find the third test's
  // language waiting in storage. The provider's hydration effect is async so
  // it never lands inside a synchronous render pass, but "it happens to be too
  // late to matter" is not a thing to leave a suite resting on.
  const storage = (await import("@react-native-async-storage/async-storage")) as unknown as {
    __resetAsyncStorage: () => void;
  };
  storage.__resetAsyncStorage();
});

describe("<I18nProvider> — language_switched round trip", () => {
  it("fires exactly twice for en → ru → ru (the repeat is a no-op)", async () => {
    const provider = await mountProvider();
    assert.equal(provider.value.language, "ru", "the provider defaults to ru");

    await provider.setLanguage("en");
    await provider.setLanguage("ru");
    await provider.setLanguage("ru");

    assert.equal(
      languageSwitches().length,
      2,
      "the third call selects the language already active — nothing switched",
    );
  });

  it("carries the previous language on each event, so the switch direction is recoverable", async () => {
    const provider = await mountProvider();

    await provider.setLanguage("en");
    await provider.setLanguage("de");

    assert.deepEqual(
      languageSwitches().map((event) => event.props),
      [
        { language: "en", previousLanguage: "ru" },
        { language: "de", previousLanguage: "en" },
      ],
    );
  });

  it("does not fire on mount — a provider appearing is not a user switching", async () => {
    await mountProvider();
    assert.deepEqual(languageSwitches(), []);
  });

  it("still applies the language on the no-op repeat, so the UI cannot desync from the event count", async () => {
    const provider = await mountProvider();

    await provider.setLanguage("pl");
    assert.equal(provider.value.language, "pl");

    await provider.setLanguage("pl");
    assert.equal(provider.value.language, "pl", "suppressing the EVENT must not suppress the STATE");
    assert.equal(languageSwitches().length, 1);
  });

  it("switches the strings t() returns, not just the language code", async () => {
    const provider = await mountProvider();
    const russian = provider.value.t("filterReset");

    await provider.setLanguage("en");
    const english = provider.value.t("filterReset");

    assert.notEqual(english, russian, "a language switch that changes no copy is not a switch");
    assert.ok(english.length > 0);
  });

  it("fires once per hop across every offered language, with no repeats slipping through", async () => {
    const provider = await mountProvider();
    const codes = provider.value.languageOptions.map((option) => option.code);
    assert.ok(codes.length >= 6, "all six locales are offered");

    // Walk the full list, then immediately re-select each one. Only the walk
    // may produce events; the second pass is every hop's own no-op.
    const hops = codes.filter((code) => code !== "ru");
    for (const code of hops) {
      await provider.setLanguage(code);
      await provider.setLanguage(code);
    }

    assert.equal(languageSwitches().length, hops.length);
  });
});
