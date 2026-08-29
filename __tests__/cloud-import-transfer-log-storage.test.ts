import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { installStorageSpy } from "./helpers/spy-async-storage";

import type { MarketplaceTransferLogEntry } from "@/lib/marketplace-transfer-log";

/**
 * The AsyncStorage halves of `lib/cloud-import.ts` and
 * `lib/marketplace-transfer-log.ts`, run rather than read — the last two
 * storage-failure sites outside a provider.
 *
 * Both modules already had suites, and both covered only the PURE halves:
 * `selectOwnedForImport`, `mergeTransferLogEntry`, `isTransferLogEntry`, plus
 * source-text assertions about the wrappers' wiring. That is the split the
 * previous four conversions kept finding, and it is where the bug below was
 * living.
 *
 * ## `appendTransferLogEntry` used to delete the log it could not read
 *
 * `loadTransferLog` answered `[]` for an unreadable store, and its one caller
 * merges into what it read and writes the union back — so a transient read
 * failure persisted a ONE-ENTRY log over the buyer's whole acquisition
 * history, permanently, because that write succeeds. This is the store the app
 * keeps precisely because nothing upstream can rebuild it: the seller's
 * `MarketplaceListing` row is deleted by then, which is the reason the
 * provenance log exists at all.
 *
 * It is the third instance of one shape. `getTombstones` refuses it (a lost
 * tombstone resurrects a deleted row), `pinCurrency` was fixed the same day as
 * this suite (a lost pin list), and this one was the most expensive of the
 * three and the last one anybody looked at, because it is the only one whose
 * loss is invisible until somebody opens a history nobody has built a screen
 * for yet.
 */

const spy = installStorageSpy();
const { scopes, keyspaces } = spy;

/** Real auth ids: `storageKeyLabel` keeps a keyspace and drops a uuid. */
const USER = "11111111-2222-4333-8444-555555555555";
const OTHER = "22222222-3333-4444-8555-666666666666";

const IMPORT_KEYSPACE = "collectables-cloud-imported-v1-{id}";
const LOG_KEYSPACE = "collectables-marketplace-transfer-log-v1-{id}";

async function cloudImport() {
  return import("@/lib/cloud-import");
}

async function transferLog() {
  return import("@/lib/marketplace-transfer-log");
}

beforeEach(async () => {
  await spy.reset();
});

function entry(overrides: Partial<MarketplaceTransferLogEntry> = {}): MarketplaceTransferLogEntry {
  return {
    id: "listing-1-2026-08-29T10:00:00.000Z",
    listingId: "listing-1",
    listingCreatedAt: "2026-08-29T10:00:00.000Z",
    sellerUserId: OTHER,
    itemId: "item-1",
    collectionId: "collection-1",
    title: "A thing",
    photo: null,
    mode: "sell",
    price: 12,
    currency: "USD",
    acquiredFrom: "seller-name",
    acquiredAt: "2026-08-29T10:05:00.000Z",
    ...overrides,
  };
}

describe("the one-time import flag", () => {
  it("is false before the import and true after it", async () => {
    const { hasCloudImported, markCloudImported } = await cloudImport();
    assert.equal(await hasCloudImported(USER), false);
    await markCloudImported(USER);
    assert.equal(await hasCloudImported(USER), true);
  });

  it("is per user, so a second account on the device still imports", async () => {
    const { hasCloudImported, markCloudImported } = await cloudImport();
    await markCloudImported(USER);
    assert.equal(await hasCloudImported(OTHER), false);
  });

  it("answers false on an unreadable store, because a re-run is harmless", async () => {
    // The deliberate collapse, and the reason it is safe HERE where the same
    // shape is a bug two describes down: the import's upserts are by id, so a
    // duplicate run costs a round trip and changes nothing. Nothing is merged
    // into and written back.
    const { hasCloudImported, markCloudImported } = await cloudImport();
    await markCloudImported(USER);
    spy.readError = new Error("storage unavailable");
    assert.equal(await hasCloudImported(USER), false);
  });

  it("reports a failed flag write, because the cost is a cloud round trip per boot", async () => {
    const { markCloudImported } = await cloudImport();
    spy.writeError = new Error("quota exceeded");
    await assert.doesNotReject(() => markCloudImported(USER));
    assert.deepEqual(scopes(), ["cloud-import.setItem"]);
    assert.deepEqual(keyspaces(), [IMPORT_KEYSPACE]);
    assert.equal(spy.captured[0].error, spy.writeError);
  });

  it("never lets the account id out with the report", async () => {
    const { markCloudImported } = await cloudImport();
    spy.writeError = new Error("quota exceeded");
    await markCloudImported(USER);
    assert.equal(
      JSON.stringify(spy.captured).includes(USER),
      false,
      "the key ends in the auth id and only the keyspace may travel",
    );
  });
});

describe("the transfer log round trip", () => {
  it("appends newest-first and dedupes a retried claim", async () => {
    const { appendTransferLogEntry, loadTransferLog } = await transferLog();
    await appendTransferLogEntry(USER, entry());
    await appendTransferLogEntry(USER, entry({ id: "listing-2-x", listingId: "listing-2" }));
    await appendTransferLogEntry(USER, entry({ title: "A thing (retried)" }));

    const log = await loadTransferLog(USER);
    assert.equal(log?.length, 2);
    assert.deepEqual(
      log?.map((e) => e.listingId),
      ["listing-1", "listing-2"],
      "the retried claim replaces its earlier row and moves to the front",
    );
  });

  it("answers [] for no user, for nothing stored, and for content that is not a log", async () => {
    // All three are the store ANSWERING, which is what separates them from the
    // null below: there is nothing to preserve and nothing is stuck.
    const { loadTransferLog } = await transferLog();
    assert.deepEqual(await loadTransferLog(""), []);
    assert.deepEqual(await loadTransferLog(USER), []);
    spy.store.set(`collectables-marketplace-transfer-log-v1-${USER}`, "{not json");
    assert.deepEqual(await loadTransferLog(USER), []);
    spy.store.set(`collectables-marketplace-transfer-log-v1-${USER}`, '{"not":"an array"}');
    assert.deepEqual(await loadTransferLog(USER), []);
    assert.deepEqual(spy.captured, [], "unreadable CONTENT is not an unreadable store");
  });

  it("drops malformed rows and keeps the rest, so one bad entry is not the whole log", async () => {
    const { loadTransferLog } = await transferLog();
    spy.store.set(
      `collectables-marketplace-transfer-log-v1-${USER}`,
      JSON.stringify([entry(), { id: "half-a-row" }, entry({ id: "b", listingId: "listing-2" })]),
    );
    assert.deepEqual((await loadTransferLog(USER))?.map((e) => e.id), [
      "listing-1-2026-08-29T10:00:00.000Z",
      "b",
    ]);
  });
});

describe("a transfer log that could not be read is not an empty one", () => {
  const KEY = `collectables-marketplace-transfer-log-v1-${USER}`;

  it("does NOT overwrite the stored history when the read fails", async () => {
    // The bug. `loadTransferLog` answered [], the merge produced a one-entry
    // list, and the write landed — the buyer's provenance for every earlier
    // purchase deleted by one transient read error, in the store that exists
    // because the seller's listing row is already gone.
    const { appendTransferLogEntry } = await transferLog();
    const history = [entry({ id: "old-1" }), entry({ id: "old-2" })];
    spy.store.set(KEY, JSON.stringify(history));

    spy.readError = new Error("storage unavailable");
    await appendTransferLogEntry(USER, entry({ id: "new" }));

    spy.readError = null;
    assert.deepEqual(
      JSON.parse(spy.store.get(KEY) ?? "null"),
      history,
      "the audit history must survive a read that failed",
    );
  });

  it("answers null rather than a list it did not persist", async () => {
    // A caller told "here is the log after appending" would be holding a list
    // that is not in the store and never was. Null is the one honest answer,
    // and the type makes a future caller decide what to do about it.
    const { appendTransferLogEntry, loadTransferLog } = await transferLog();
    spy.readError = new Error("storage unavailable");
    assert.equal(await loadTransferLog(USER), null);
    assert.equal(await appendTransferLogEntry(USER, entry()), null);
  });

  it("reports the unreadable read, because an audit log that stops growing is invisible", async () => {
    const { loadTransferLog } = await transferLog();
    spy.readError = new Error("storage unavailable");
    await loadTransferLog(USER);
    assert.deepEqual(scopes(), ["marketplace-transfer-log.getItem"]);
    assert.deepEqual(keyspaces(), [LOG_KEYSPACE]);
  });

  it("reports the read and the write separately — two diagnoses on one log", async () => {
    const { appendTransferLogEntry, loadTransferLog } = await transferLog();
    spy.readError = new Error("storage unavailable");
    await loadTransferLog(USER);
    spy.readError = null;
    spy.writeError = new Error("quota exceeded");
    await appendTransferLogEntry(USER, entry());
    assert.deepEqual(scopes(), [
      "marketplace-transfer-log.getItem",
      "marketplace-transfer-log.setItem",
    ]);
    assert.deepEqual(keyspaces(), [LOG_KEYSPACE, LOG_KEYSPACE]);
  });

  it("still answers the merged list when only the WRITE fails", async () => {
    // The other half of the pair, and the reason the null is about the READ
    // alone: a failed write loses the new entry and nothing else, and the
    // caller's copy of the merge is the truth it was going to render.
    const { appendTransferLogEntry } = await transferLog();
    spy.store.set(KEY, JSON.stringify([entry({ id: "old" })]));
    spy.writeError = new Error("quota exceeded");
    const next = await appendTransferLogEntry(USER, entry({ id: "new" }));
    assert.deepEqual(next?.map((e) => e.id), ["new", "old"]);
    assert.deepEqual(scopes(), ["marketplace-transfer-log.setItem"]);
  });

  it("does not reject out of either failure, so a claim is never blocked by storage", async () => {
    const { appendTransferLogEntry } = await transferLog();
    spy.readError = new Error("storage unavailable");
    await assert.doesNotReject(() => appendTransferLogEntry(USER, entry()));
    spy.readError = null;
    spy.writeError = new Error("quota exceeded");
    await assert.doesNotReject(() => appendTransferLogEntry(USER, entry()));
  });
});
