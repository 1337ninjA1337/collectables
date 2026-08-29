import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { installStorageSpy } from "./helpers/spy-async-storage";

/**
 * The AsyncStorage half of `lib/sync-cursors.ts`, run rather than read.
 *
 * `sync-cursors.test.ts` covers the two pure reducers (`maxUpdatedAt`,
 * `overlapCursor`) and asserts the wrappers' wiring from source text. What
 * neither could reach is the behaviour of the wrappers against a store that is
 * failing, which is the only interesting thing they do:
 *
 *   - `getSyncCursor` answers null for an unreadable store AND for a cold
 *     start, deliberately. Unlike `getTombstones` — where the same collapse
 *     narrowed a persisted set and resurrected deleted rows — the caller does
 *     not merge this value into anything it writes back. It is a lower bound
 *     handed to PostgREST, and no bound is the safe bound.
 *
 *   - `setSyncCursor` swallows a failed write, because the next pull asking for
 *     a wider window is the whole recovery.
 *
 * Both are correct and both are UNBOUNDED: a store that stays unreadable
 * re-fetches both whole tables on every refresh, which is exactly the
 * behaviour BE-14 was written to replace, with every screen still looking
 * right and the only symptom on somebody's egress bill. So both report once
 * per session through the shared budget.
 */

const spy = installStorageSpy();
const { scopes, keyspaces } = spy;

/** A real auth id, so `storageKeyLabel` keeps the entity instead of truncating. */
const USER = "11111111-2222-4333-8444-555555555555";
const ITEMS_KEYSPACE = "collectables-sync-cursor-v1-items-{id}";

async function load() {
  return import("@/lib/sync-cursors");
}

beforeEach(async () => {
  await spy.reset();
});

describe("getSyncCursor / setSyncCursor round trip", () => {
  it("reads back a stored cursor", async () => {
    const { getSyncCursor, setSyncCursor } = await load();
    await setSyncCursor("items", USER, "2026-08-29T10:00:00.000Z");
    assert.equal(await getSyncCursor("items", USER), "2026-08-29T10:00:00.000Z");
  });

  it("answers null before anything was ever synced", async () => {
    const { getSyncCursor } = await load();
    assert.equal(await getSyncCursor("items", USER), null);
  });

  it("keys per entity and per user", async () => {
    const { getSyncCursor, setSyncCursor } = await load();
    await setSyncCursor("items", USER, "2026-01-01T00:00:00.000Z");
    await setSyncCursor("collections", USER, "2026-02-02T00:00:00.000Z");
    await setSyncCursor("items", "user-2", "2026-03-03T00:00:00.000Z");
    assert.equal(await getSyncCursor("items", USER), "2026-01-01T00:00:00.000Z");
    assert.equal(await getSyncCursor("collections", USER), "2026-02-02T00:00:00.000Z");
    assert.equal(await getSyncCursor("items", "user-2"), "2026-03-03T00:00:00.000Z");
  });

  it("writes nothing for a null cursor or one equal to `previous`", async () => {
    const { setSyncCursor } = await load();
    await setSyncCursor("items", USER, null);
    await setSyncCursor("items", USER, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    assert.equal(spy.store.size, 0, "a delta pull that returned nothing newer must not write");
  });

  it("does not throw out of a failing store", async () => {
    const { getSyncCursor, setSyncCursor } = await load();
    spy.readError = new Error("storage unavailable");
    await assert.doesNotReject(() => getSyncCursor("items", USER));
    spy.readError = null;
    spy.writeError = new Error("quota exceeded");
    await assert.doesNotReject(() => setSyncCursor("items", USER, "2026-01-01T00:00:00.000Z"));
  });
});

describe("a cursor store that stays broken is reported", () => {
  it("reports an unreadable read with the keyspace, never the user id", async () => {
    const { getSyncCursor } = await load();
    spy.readError = new Error("storage unavailable");
    assert.equal(await getSyncCursor("items", USER), null);

    assert.deepEqual(scopes(), ["sync-cursors.getItem"]);
    assert.deepEqual(keyspaces(), [ITEMS_KEYSPACE]);
    assert.equal(spy.captured[0].error, spy.readError);
    assert.equal(
      JSON.stringify(spy.captured).includes(USER),
      false,
      "the key ends in the account's auth id and only the keyspace may travel",
    );
  });

  it("reports a failed write", async () => {
    const { setSyncCursor } = await load();
    spy.writeError = new Error("quota exceeded");
    await setSyncCursor("items", USER, "2026-01-01T00:00:00.000Z");
    assert.deepEqual(scopes(), ["sync-cursors.setItem"]);
    assert.deepEqual(keyspaces(), [ITEMS_KEYSPACE]);
  });

  it("reports once however many refreshes re-pull the whole table", async () => {
    const { getSyncCursor } = await load();
    spy.readError = new Error("storage unavailable");
    await getSyncCursor("items", USER);
    await getSyncCursor("items", USER);
    await getSyncCursor("items", USER);
    assert.equal(spy.captured.length, 1);
  });

  it("reports the two entities separately — they are two stores", async () => {
    const { getSyncCursor } = await load();
    spy.readError = new Error("storage unavailable");
    await getSyncCursor("items", USER);
    await getSyncCursor("collections", USER);
    assert.deepEqual(keyspaces(), [
      ITEMS_KEYSPACE,
      "collectables-sync-cursor-v1-collections-{id}",
    ]);
  });

  it("says nothing for a cold start, which is the OTHER null", async () => {
    // The collapse `getTombstones` refuses is safe here, so an absent cursor
    // must not look like a broken store on the dashboard.
    const { getSyncCursor } = await load();
    assert.equal(await getSyncCursor("items", USER), null);
    assert.deepEqual(spy.captured, []);
  });

  it("says nothing for the no-op write or while the store works", async () => {
    const { getSyncCursor, setSyncCursor } = await load();
    await setSyncCursor("items", USER, null);
    await setSyncCursor("items", USER, "2026-01-01T00:00:00.000Z");
    await getSyncCursor("items", USER);
    assert.deepEqual(spy.captured, []);
  });
});
