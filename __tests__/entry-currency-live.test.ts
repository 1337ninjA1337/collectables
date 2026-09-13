import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactElement } from "react";

import { settle } from "./helpers/mount-provider";
import { autoUnmount, render } from "./helpers/render";
import { installStorageSpy } from "./helpers/spy-async-storage";

/**
 * One preference, four mounted readers, and a read taken once at mount.
 *
 * `app/settings.tsx`, `app/create.tsx`, `app/wishlist.tsx` and the listing
 * sheet in `app/item/[id].tsx` all ask which currency a cost is typed in, and
 * each held its own `useState` plus a `getEntryCurrency()` effect with an
 * empty dep array. A stack keeps the screen underneath MOUNTED, so a collector
 * who opens the wishlist, walks to settings, changes the currency and comes
 * back finds the add sheet still offering the old one. Nothing was wrong on
 * disk; the screen had simply read the slot once and never again.
 *
 * IT BECAME ORDINARY THE DAY SETTINGS GREW A PICKER (2026-09-13). Before that,
 * settings could only CLEAR the preference and the forms wrote it themselves,
 * so the two mounted readers rarely disagreed. Giving the card a way to create
 * the preference is what made "the other screen is stale" a normal Tuesday.
 *
 * ## Why a notification and not a value
 *
 * An empty entry slot means "follow the display currency" — `getEntryCurrency`
 * reads through — so a change to the DISPLAY currency moves the effective
 * entry currency for everybody who has never chosen one. A store publishing a
 * VALUE would have to know which of the two keys it is speaking for; a nudge
 * lets the one function that knows the rule answer the question.
 *
 * ## Why not the provider
 *
 * `CollectionsProvider` owns the display currency and every total re-renders
 * on it. The entry currency re-renders no total, so putting it there would
 * re-render all of them on a change that cannot affect any — the argument the
 * settings card was written under, unchanged.
 */

const spy = installStorageSpy();
autoUnmount();

const ENTRY_KEY = "collectables-entry-currency-v1";
const CURRENCY_KEY = "collectables-currency-v1";

/**
 * Lazy, like every storage suite here: `mockModule` only takes effect for a
 * module not yet evaluated, and a static import would pull the real
 * AsyncStorage through before the shim registered.
 */
async function store() {
  return import("@/lib/entry-currency-store");
}

async function locale() {
  return import("@/lib/locale-helpers");
}

async function hooks() {
  return import("@/lib/use-entry-currency");
}

beforeEach(async () => {
  await spy.reset();
});

describe("the store", () => {
  it("tells a subscriber, and stops when it unsubscribes", async () => {
    const { subscribeToEntryCurrency, notifyEntryCurrencyChanged } = await store();
    let heard = 0;
    const unsubscribe = subscribeToEntryCurrency(() => {
      heard += 1;
    });
    notifyEntryCurrencyChanged();
    assert.equal(heard, 1);
    unsubscribe();
    notifyEntryCurrencyChanged();
    assert.equal(heard, 1);
  });

  it("still tells the rest when one listener unsubscribes mid-notification", async () => {
    // A screen unmounting on the same tick as a write. Iterating the live set
    // would skip whichever listener happened to be next.
    const { subscribeToEntryCurrency, notifyEntryCurrencyChanged } = await store();
    const heard: string[] = [];
    const first = subscribeToEntryCurrency(() => {
      heard.push("first");
      first();
      second();
    });
    const second = subscribeToEntryCurrency(() => {
      heard.push("second");
    });
    notifyEntryCurrencyChanged();
    assert.deepEqual(heard, ["first", "second"]);
    // And both are gone afterwards, rather than the copy re-adding them.
    notifyEntryCurrencyChanged();
    assert.deepEqual(heard, ["first", "second"]);
  });

  it("does not let one broken listener silence the others", async () => {
    // A screen that has gone wrong is not a reason for every other screen to
    // keep a stale currency, so every listener runs and the failures are
    // raised together at the end — on the caller, which is the write that just
    // happened. Deferring the re-throw to a timer was the first draft: it
    // turns a bug in one screen into an uncaught exception with nothing in the
    // stack to say where it came from.
    const { subscribeToEntryCurrency, notifyEntryCurrencyChanged } = await store();
    let heard = 0;
    const stopThrower = subscribeToEntryCurrency(() => {
      throw new Error("listener blew up");
    });
    const stopReader = subscribeToEntryCurrency(() => {
      heard += 1;
    });
    try {
      assert.throws(() => {
        notifyEntryCurrencyChanged();
      }, (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors.length, 1);
        assert.match(String(error.errors[0]), /listener blew up/);
        return true;
      });
      assert.equal(heard, 1, "the second listener was told despite the first throwing");
    } finally {
      stopThrower();
      stopReader();
    }
  });

  it("counts its listeners, so a leak is a number somebody can assert", async () => {
    const { subscribeToEntryCurrency, entryCurrencyListenerCount } = await store();
    const before = entryCurrencyListenerCount();
    const unsubscribe = subscribeToEntryCurrency(() => undefined);
    assert.equal(entryCurrencyListenerCount(), before + 1);
    unsubscribe();
    assert.equal(entryCurrencyListenerCount(), before);
  });
});

describe("what publishes a change", () => {
  it("setEntryCurrency tells the readers, after the value is on disk", async () => {
    // Order matters: a listener re-reads on the notification, so publishing
    // first would hand every screen the value that was just replaced.
    const { setEntryCurrency, getEntryCurrency } = await locale();
    const { subscribeToEntryCurrency } = await store();
    let seen: string | null = null;
    const unsubscribe = subscribeToEntryCurrency(() => {
      seen = spy.store.get(ENTRY_KEY) ?? null;
    });
    await setEntryCurrency("JPY");
    unsubscribe();
    assert.equal(seen, "JPY");
    assert.equal(await getEntryCurrency(), "JPY");
  });

  it("clearEntryCurrency tells them too", async () => {
    const { clearEntryCurrency } = await locale();
    const { subscribeToEntryCurrency } = await store();
    spy.store.set(ENTRY_KEY, "JPY");
    let heard = 0;
    const unsubscribe = subscribeToEntryCurrency(() => {
      heard += 1;
    });
    await clearEntryCurrency();
    unsubscribe();
    assert.equal(heard, 1);
  });

  it("setUserPreferredCurrency tells them, because most people read through it", async () => {
    // The DISPLAY slot. With no entry currency chosen, `getEntryCurrency`
    // answers with this one — so a mounted cost form that missed this write
    // would open in the currency the user had just stopped using.
    const { setUserPreferredCurrency, getEntryCurrency } = await locale();
    const { subscribeToEntryCurrency } = await store();
    let heard = 0;
    const unsubscribe = subscribeToEntryCurrency(() => {
      heard += 1;
    });
    await setUserPreferredCurrency("EUR");
    unsubscribe();
    assert.equal(heard, 1);
    assert.equal(spy.store.get(CURRENCY_KEY), "EUR");
    assert.equal(await getEntryCurrency(), "EUR");
  });

  it("says nothing when the write failed", async () => {
    // The slot did not move, so there is nothing to tell anybody. A
    // notification here would make every screen re-read and land on the value
    // it already had — noise that looks exactly like a successful change.
    const { setEntryCurrency } = await locale();
    const { subscribeToEntryCurrency } = await store();
    spy.writeError = new Error("quota");
    let heard = 0;
    const unsubscribe = subscribeToEntryCurrency(() => {
      heard += 1;
    });
    await setEntryCurrency("JPY");
    unsubscribe();
    spy.writeError = null;
    assert.equal(heard, 0);
    assert.deepEqual(spy.scopes(), ["locale-helpers.setItem"]);
  });

  it("says nothing for a code it refused to store", async () => {
    // Malformed input is dropped rather than stored, so nothing changed.
    const { setEntryCurrency } = await locale();
    const { subscribeToEntryCurrency } = await store();
    let heard = 0;
    const unsubscribe = subscribeToEntryCurrency(() => {
      heard += 1;
    });
    await setEntryCurrency("not-a-currency");
    unsubscribe();
    assert.equal(heard, 0);
    assert.equal(spy.store.has(ENTRY_KEY), false);
  });
});

describe("useEntryCurrency", () => {
  async function mountProbe() {
    const { useEntryCurrency } = await hooks();
    let seen: string | null = null;
    function Probe() {
      seen = useEntryCurrency();
      return null;
    }
    const tree = render(createElement(Probe) as ReactElement);
    const drain = async () => {
      for (let pass = 0; pass < 3; pass += 1) {
        await settle();
        tree.rerender(createElement(Probe) as ReactElement);
      }
    };
    await drain();
    return { tree, drain, read: () => seen };
  }

  it("reads the slot on mount", async () => {
    spy.store.set(ENTRY_KEY, "JPY");
    const probe = await mountProbe();
    assert.equal(probe.read(), "JPY");
  });

  it("falls through to the display currency, like the helper it reads", async () => {
    spy.store.set(CURRENCY_KEY, "EUR");
    const probe = await mountProbe();
    assert.equal(probe.read(), "EUR");
  });

  it("re-reads when another screen writes the slot", async () => {
    // The whole point. This is the wishlist sitting mounted under settings.
    spy.store.set(ENTRY_KEY, "USD");
    const probe = await mountProbe();
    assert.equal(probe.read(), "USD");

    const { setEntryCurrency } = await locale();
    await setEntryCurrency("JPY");
    await probe.drain();
    assert.equal(probe.read(), "JPY");
  });

  it("follows a display-currency change while no entry currency is chosen", async () => {
    spy.store.set(CURRENCY_KEY, "USD");
    const probe = await mountProbe();
    assert.equal(probe.read(), "USD");

    const { setUserPreferredCurrency } = await locale();
    await setUserPreferredCurrency("PLN");
    await probe.drain();
    assert.equal(probe.read(), "PLN");
  });

  it("lets go on unmount", async () => {
    // A subscription that outlives its tree holds the closure — and the
    // component tree it captured — for the life of the process.
    const { entryCurrencyListenerCount } = await store();
    const before = entryCurrencyListenerCount();
    const probe = await mountProbe();
    assert.equal(entryCurrencyListenerCount(), before + 1);
    probe.tree.unmount();
    assert.equal(entryCurrencyListenerCount(), before);
  });
});

describe("useEntryCurrencyEffect", () => {
  it("hands each answer to the form's own setter", async () => {
    const { useEntryCurrencyEffect } = await hooks();
    spy.store.set(ENTRY_KEY, "USD");
    const applied: string[] = [];
    function Probe() {
      useEntryCurrencyEffect((code) => {
        applied.push(code);
      });
      return null;
    }
    const tree = render(createElement(Probe) as ReactElement);
    const drain = async () => {
      for (let pass = 0; pass < 3; pass += 1) {
        await settle();
        tree.rerender(createElement(Probe) as ReactElement);
      }
    };
    await drain();
    assert.deepEqual(applied, ["USD"]);

    const { setEntryCurrency } = await locale();
    await setEntryCurrency("JPY");
    await drain();
    // Once per distinct answer, not once per render: a form being typed into
    // re-renders constantly and re-applying a preference over a half-made
    // choice is the bug the ref in the hook exists to avoid.
    assert.deepEqual(applied, ["USD", "JPY"]);
  });

  it("says nothing while there is nothing stored", async () => {
    const { useEntryCurrencyEffect } = await hooks();
    const applied: string[] = [];
    function Probe() {
      useEntryCurrencyEffect((code) => {
        applied.push(code);
      });
      return null;
    }
    const tree = render(createElement(Probe) as ReactElement);
    for (let pass = 0; pass < 3; pass += 1) {
      await settle();
      tree.rerender(createElement(Probe) as ReactElement);
    }
    // The form keeps the language default it opened with, which is exactly
    // what `null` has to leave alone.
    assert.deepEqual(applied, []);
  });
});
