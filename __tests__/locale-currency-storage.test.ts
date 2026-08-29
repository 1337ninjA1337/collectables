import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { installNativeModuleStubs, mockModule } from "./helpers/render";

/**
 * The AsyncStorage half of `lib/locale-helpers.ts` and `lib/currency-rates.ts`,
 * run rather than read.
 *
 * ## Why these two modules
 *
 * Sixteen storage-failure sites exist and six of them had a behavioural case.
 * `tombstones`, `sync-cursors` and `use-persisted-blob` are run against a spy
 * AsyncStorage; the rest are pinned by SOURCE TEXT — the adoption sweep in
 * `report-storage-failure.test.ts` asserts that each module passes the site it
 * declares, which says the call is written and not that a rejection ever
 * reaches it. A `catch` arm guarding the wrong statement, or a `return` above
 * it, is invisible to a rule that greps for the call.
 *
 * These four sites are the cheapest to convert and the ones where a spy
 * actually runs: both modules are plain async functions with no React around
 * them, so there is nothing to mount. The ten remaining sites are inside
 * providers.
 *
 * ## The behaviour that had no case at all
 *
 * `pinCurrency` returns early on an unreadable store. It used to fall through
 * to a write of `mergePinnedCurrencies([], validated)` — the user's other pins
 * replaced by one entry, permanently, because that write succeeds. The fix was
 * made a day before this suite and was protected only by having been written
 * that way once; the doc comment beside it still described the fall-through it
 * had stopped doing.
 *
 * `getPinnedCurrencies` reads the SAME key and reported nothing until this
 * suite asked it to, which is the shape a source-text rule cannot see: the
 * module passes `locale-helpers.getItem` (from the other path), so every
 * adoption check was green while one of its two reads onto one store was
 * silent.
 */

installNativeModuleStubs();

const store = new Map<string, string>();
let readError: Error | null = null;
let writeError: Error | null = null;

const captured: { error: unknown; context: unknown }[] = [];

mockModule("@react-native-async-storage/async-storage", {
  default: {
    getItem: async (key: string) => {
      if (readError) throw readError;
      return store.get(key) ?? null;
    },
    setItem: async (key: string, value: string) => {
      if (writeError) throw writeError;
      store.set(key, value);
    },
  },
});

mockModule("@/lib/sentry", {
  captureException: (error: unknown, context: unknown) => captured.push({ error, context }),
});

const CURRENCY_KEY = "collectables-currency-v1";
const PINNED_KEY = "collectables-pinned-currencies-v1";
const RATES_KEY = "collectables-currency-rates-v1";

/**
 * Both modules are imported lazily, for the reason the rest of these suites
 * are: `mockModule` only takes effect for a module not yet evaluated, and a
 * static import would pull the real AsyncStorage and the real Sentry through
 * before the shims registered.
 */
async function locale() {
  return import("@/lib/locale-helpers");
}

async function rates() {
  return import("@/lib/currency-rates");
}

beforeEach(async () => {
  store.clear();
  readError = null;
  writeError = null;
  captured.length = 0;
  (await import("@/lib/report-storage-failure")).__resetStorageFailureReportsForTests();
});

function scopes(): string[] {
  return captured.map((c) => (c.context as { scope: string }).scope);
}

function keyspaces(): string[] {
  return captured.map((c) => (c.context as { extra: { keyspace: string } }).extra.keyspace);
}

describe("the preferred-currency pair", () => {
  it("round-trips a validated code", async () => {
    const { getUserPreferredCurrency, setUserPreferredCurrency } = await locale();
    await setUserPreferredCurrency("jpy");
    assert.equal(store.get(CURRENCY_KEY), "JPY");
    assert.equal(await getUserPreferredCurrency(), "JPY");
  });

  it("writes nothing for a malformed code, so junk never reaches the store", async () => {
    const { setUserPreferredCurrency } = await locale();
    await setUserPreferredCurrency("not-a-currency");
    assert.equal(store.size, 0);
  });

  it("answers null for stored junk — the store answered and what it held is not a code", async () => {
    const { getUserPreferredCurrency } = await locale();
    store.set(CURRENCY_KEY, "US");
    assert.equal(await getUserPreferredCurrency(), null);
    assert.deepEqual(captured, [], "unreadable CONTENT is not an unreadable store");
  });

  it("reports an unreadable store and still answers null", async () => {
    // Null is the same answer as "never chosen one" and the language-default
    // fallback is right either way, which is exactly why the read has to
    // report: the caller cannot tell the two apart and nothing else would ever
    // mention that this device's store is broken.
    const { getUserPreferredCurrency } = await locale();
    readError = new Error("storage unavailable");
    assert.equal(await getUserPreferredCurrency(), null);
    assert.deepEqual(scopes(), ["locale-helpers.getItem"]);
    assert.deepEqual(keyspaces(), [CURRENCY_KEY]);
    assert.equal(captured[0].error, readError);
  });

  it("reports a failed write and does not reject, so the form submit survives", async () => {
    const { setUserPreferredCurrency } = await locale();
    writeError = new Error("quota exceeded");
    await assert.doesNotReject(() => setUserPreferredCurrency("EUR"));
    assert.deepEqual(scopes(), ["locale-helpers.setItem"]);
    assert.deepEqual(keyspaces(), [CURRENCY_KEY]);
  });
});

describe("pinCurrency", () => {
  it("puts the newest pick at the front and keeps the rest", async () => {
    const { getPinnedCurrencies, pinCurrency } = await locale();
    await pinCurrency("USD");
    await pinCurrency("EUR");
    assert.deepEqual(await getPinnedCurrencies(), ["EUR", "USD"]);
  });

  it("writes nothing at all for a malformed code", async () => {
    const { pinCurrency } = await locale();
    await pinCurrency("€");
    assert.equal(store.size, 0);
  });

  it("does NOT replace the stored list when the read fails", async () => {
    // The case the early return exists for, and the one nothing covered. The
    // old code fell through to `mergePinnedCurrencies([], validated)`: a read
    // that failed would write ONE entry over a list of four that is still
    // there and still correct — permanently, because that write succeeds.
    const { pinCurrency } = await locale();
    store.set(PINNED_KEY, JSON.stringify(["USD", "EUR", "GBP", "JPY"]));

    readError = new Error("storage unavailable");
    await pinCurrency("CHF");

    readError = null;
    assert.deepEqual(
      JSON.parse(store.get(PINNED_KEY) ?? "null"),
      ["USD", "EUR", "GBP", "JPY"],
      "an unreadable store is not an empty one — the pins must survive the failed read",
    );
  });

  it("reports the failed read rather than merging into what it could not read", async () => {
    const { pinCurrency } = await locale();
    readError = new Error("storage unavailable");
    await pinCurrency("CHF");
    assert.deepEqual(scopes(), ["locale-helpers.getItem"]);
    assert.deepEqual(keyspaces(), [PINNED_KEY]);
  });

  it("reports the read and the write separately — two diagnoses on one key", async () => {
    // The reason the budget is keyed by SITE as well as keyspace. "The pin list
    // could not be read" and "could not be written" have different fixes, and
    // one entry for both would let whichever happened first hide the other for
    // the rest of the session.
    const { getPinnedCurrencies, pinCurrency } = await locale();
    readError = new Error("storage unavailable");
    await getPinnedCurrencies();
    readError = null;
    writeError = new Error("quota exceeded");
    await pinCurrency("CHF");
    assert.deepEqual(scopes(), ["locale-helpers.getItem", "locale-helpers.setItem"]);
    assert.deepEqual(keyspaces(), [PINNED_KEY, PINNED_KEY]);
  });

  it("does not reject when the write fails, and reports it", async () => {
    const { pinCurrency } = await locale();
    writeError = new Error("quota exceeded");
    await assert.doesNotReject(() => pinCurrency("CHF"));
    assert.deepEqual(scopes(), ["locale-helpers.setItem"]);
  });
});

describe("getPinnedCurrencies", () => {
  it("answers [] when nothing is stored", async () => {
    const { getPinnedCurrencies } = await locale();
    assert.deepEqual(await getPinnedCurrencies(), []);
    assert.deepEqual(captured, []);
  });

  it("answers [] for stored junk without reporting — the store answered", async () => {
    const { getPinnedCurrencies } = await locale();
    store.set(PINNED_KEY, "{not json");
    assert.deepEqual(await getPinnedCurrencies(), []);
    assert.deepEqual(captured, []);
  });

  it("reports an unreadable store, like the read one function down does", async () => {
    // The gap the source-text adoption sweep could not see: the module passes
    // `locale-helpers.getItem` from `pinCurrency`, so every adoption check was
    // green while THIS read onto the same key was silent. Which of a module's
    // two paths reports would otherwise be decided by which one ran first.
    const { getPinnedCurrencies } = await locale();
    readError = new Error("storage unavailable");
    assert.deepEqual(await getPinnedCurrencies(), []);
    assert.deepEqual(scopes(), ["locale-helpers.getItem"]);
    assert.deepEqual(keyspaces(), [PINNED_KEY]);
  });

  it("spends ONE budget entry across both reads of the key", async () => {
    // Why fixing the silent read costs no extra event volume: the shared budget
    // is keyed by site and keyspace, and both paths pass the same pair.
    const { getPinnedCurrencies, pinCurrency } = await locale();
    readError = new Error("storage unavailable");
    await getPinnedCurrencies();
    await pinCurrency("CHF");
    await getPinnedCurrencies();
    assert.equal(captured.length, 1);
  });
});

describe("the rates cache", () => {
  const PAYLOAD = { rates: Object.freeze({ EUR: 0.9, GBP: 0.8 }), fetchedAt: 1_700_000_000_000 };

  it("round-trips a payload", async () => {
    const { getCachedRates, setCachedRates } = await rates();
    await setCachedRates(PAYLOAD);
    assert.deepEqual(await getCachedRates(), { rates: { EUR: 0.9, GBP: 0.8 }, fetchedAt: PAYLOAD.fetchedAt });
  });

  it("answers null for a payload with no usable rates in it", async () => {
    const { getCachedRates } = await rates();
    store.set(RATES_KEY, JSON.stringify({ rates: { EUR: -1, GBP: "x" }, fetchedAt: 1 }));
    assert.equal(await getCachedRates(), null);
  });

  it("reports a failed write, because the cost lands on somebody else's API", async () => {
    // A cache that never persists turns one request per TTL into one request
    // per launch against a third-party rate API, and every screen still looks
    // right — which is why this write is worth an event at all.
    const { setCachedRates } = await rates();
    writeError = new Error("quota exceeded");
    await assert.doesNotReject(() => setCachedRates(PAYLOAD));
    assert.deepEqual(scopes(), ["currency-rates.setItem"]);
    assert.deepEqual(keyspaces(), [RATES_KEY]);
    assert.equal(captured[0].error, writeError);
  });

  it("reports the write once per session however many times it fails", async () => {
    const { setCachedRates } = await rates();
    writeError = new Error("quota exceeded");
    await setCachedRates(PAYLOAD);
    await setCachedRates({ ...PAYLOAD, fetchedAt: PAYLOAD.fetchedAt + 1 });
    assert.equal(captured.length, 1, "one full disk is one fact about the device");
  });

  it("still answers null on an unreadable store, and says nothing — a read this module has not been asked about", async () => {
    // NOT an assertion that silence is right. `getCachedRates` swallows its
    // read where `setCachedRates` reports its write, and whether a swallowed
    // READ is the same offence is an open question filed against the whole
    // tree, not a decision this module made. Pinned so that answering it
    // changes a case rather than slipping past one.
    const { getCachedRates } = await rates();
    readError = new Error("storage unavailable");
    assert.equal(await getCachedRates(), null);
    assert.deepEqual(captured, []);
  });
});
