import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { installStorageSpy } from "./helpers/spy-async-storage";

/**
 * The AsyncStorage half of `lib/tombstones.ts`, run rather than read.
 *
 * `tombstones.test.ts` covers the pure helpers and asserts the wrappers'
 * SPELLING from source text, which is what could be checked before the render
 * harness existed. The two facts this suite pins are behavioural and are both
 * about a store that is failing:
 *
 *   1. `getTombstones` answers null for an unreadable store, never `[]`. Every
 *      caller merges new ids into what it read and writes the union back, so
 *      `[]` for a failed read replaces the persisted set with whatever one pull
 *      happened to see — permanently, since that write succeeds. The rows whose
 *      tombstones were dropped come back on the next hydrate and the user sees
 *      something they deleted.
 *
 *   2. `setTombstones` reports whether the stored set now covers the ids. It
 *      used to be `void`, under a comment saying a failed write just re-learns
 *      the tombstones from the next pull — which was not true, because the
 *      delta pull advanced its `updated_at` cursor immediately afterwards. A
 *      soft-delete is one UPDATE and nothing re-sends it, so the next pull
 *      asked for rows newer than the tombstone it had just failed to store.
 */

const spy = installStorageSpy();
const { scopes, keyspaces } = spy;

/**
 * A real Supabase auth id rather than "user-1": `storageKeyLabel` replaces a
 * UUID and keeps what surrounds it, which for a tombstone key is the ENTITY —
 * the part of a crash report that says which pull broke. A non-uuid id matches
 * no shape and is truncated at the version instead, so a fixture id would have
 * quietly asserted the fallback rather than the path the app takes.
 */
const USER = "11111111-2222-4333-8444-555555555555";

async function load() {
  return import("@/lib/tombstones");
}

beforeEach(async () => {
  await spy.reset();
});

describe("getTombstones", () => {
  it("reads back a stored set", async () => {
    const { getTombstones, setTombstones } = await load();
    await setTombstones("items", USER, ["a", "b"]);
    assert.deepEqual(await getTombstones("items", USER), ["a", "b"]);
  });

  it("answers [] when nothing was ever stored", async () => {
    const { getTombstones } = await load();
    assert.deepEqual(await getTombstones("items", USER), []);
  });

  it("answers null when the store cannot be read — not an empty set", async () => {
    const { getTombstones, setTombstones } = await load();
    await setTombstones("items", USER, ["a", "b"]);
    spy.readError = new Error("storage unavailable");
    assert.equal(await getTombstones("items", USER), null);
  });

  it("answers [] for stored garbage, which is unreadable content rather than an unreadable store", async () => {
    // The distinction the null is for: the store ANSWERED, and what it held is
    // not a tombstone set. There is nothing to preserve, so re-learning from
    // the next pull is right here and would be data loss one case up.
    const { getTombstones } = await load();
    spy.store.set(`collectables-tombstones-v1-items-${USER}`, "{not json");
    assert.deepEqual(await getTombstones("items", USER), []);
    spy.store.set(`collectables-tombstones-v1-items-${USER}`, '{"a":1}');
    assert.deepEqual(await getTombstones("items", USER), []);
  });

  it("drops non-string entries from a stored array", async () => {
    const { getTombstones } = await load();
    spy.store.set(`collectables-tombstones-v1-items-${USER}`, JSON.stringify(["a", 7, null, "b"]));
    assert.deepEqual(await getTombstones("items", USER), ["a", "b"]);
  });
});

describe("setTombstones", () => {
  it("reports true when the write lands, and the set is readable afterwards", async () => {
    const { getTombstones, setTombstones } = await load();
    assert.equal(await setTombstones("collections", USER, ["a"]), true);
    assert.deepEqual(await getTombstones("collections", USER), ["a"]);
  });

  it("reports true for the no-op — nothing to write means the store is already current", async () => {
    const { setTombstones } = await load();
    const ids = ["a", "b"];
    assert.equal(await setTombstones("items", USER, ids, ids), true);
    assert.equal(
      spy.store.size,
      0,
      "the same reference means the merge helpers changed nothing, so no write should have happened",
    );
  });

  it("reports false when the write fails, so the caller can hold its cursor", async () => {
    const { setTombstones } = await load();
    spy.writeError = new Error("quota exceeded");
    assert.equal(await setTombstones("items", USER, ["a"]), false);
  });

  it("does not throw out of a failed write", async () => {
    const { setTombstones } = await load();
    spy.writeError = new Error("quota exceeded");
    await assert.doesNotReject(() => setTombstones("items", USER, ["a"]));
  });

  it("keys per entity and per user", async () => {
    const { getTombstones, setTombstones } = await load();
    await setTombstones("items", USER, ["i"]);
    await setTombstones("collections", USER, ["c"]);
    await setTombstones("items", "user-2", ["other"]);
    assert.deepEqual(await getTombstones("items", USER), ["i"]);
    assert.deepEqual(await getTombstones("collections", USER), ["c"]);
    assert.deepEqual(await getTombstones("items", "user-2"), ["other"]);
  });
});

describe("a store that stays broken is reported, because holding the cursor has no ceiling", () => {
  /**
   * The safe answers this module gives — null for an unreadable read, false for
   * a failed write — both make the delta pull HOLD its `updated_at` cursor. That
   * is right, and it is also open-ended: the same window re-pulls on every
   * refresh until the store works, nothing counts the retries, and a device
   * whose store is permanently full looks from the outside exactly like one
   * that is quietly syncing. One report per session is what makes the loop
   * visible.
   */
  const KEYSPACE = "collectables-tombstones-v1-items-{id}";

  it("reports an unreadable store, with the keyspace and never the user id", async () => {
    const { getTombstones } = await load();
    spy.readError = new Error("storage unavailable");
    assert.equal(await getTombstones("items", USER), null);

    assert.deepEqual(scopes(), ["tombstones.getItem"]);
    assert.deepEqual(keyspaces(), [KEYSPACE]);
    assert.equal(spy.captured[0].error, spy.readError);
    assert.equal(
      JSON.stringify(spy.captured).includes(USER),
      false,
      "the key ends in the account's auth id and only the keyspace may travel",
    );
  });

  it("reports a failed write, which is the same hold from the other end", async () => {
    const { setTombstones } = await load();
    spy.writeError = new Error("quota exceeded");
    assert.equal(await setTombstones("items", USER, ["a"]), false);
    assert.deepEqual(scopes(), ["tombstones.setItem"]);
    assert.deepEqual(keyspaces(), [KEYSPACE]);
  });

  it("reports the read and the write separately — two diagnoses, two fixes", async () => {
    const { getTombstones, setTombstones } = await load();
    spy.readError = new Error("storage unavailable");
    await getTombstones("items", USER);
    spy.readError = null;
    spy.writeError = new Error("quota exceeded");
    await setTombstones("items", USER, ["a"]);
    assert.deepEqual(scopes(), ["tombstones.getItem", "tombstones.setItem"]);
  });

  it("reports once however many refreshes re-pull the same held window", async () => {
    const { getTombstones } = await load();
    spy.readError = new Error("storage unavailable");
    await getTombstones("items", USER);
    await getTombstones("items", USER);
    await getTombstones("items", USER);
    assert.equal(spy.captured.length, 1, "the point of the hold is that it repeats — the report is not");
  });

  it("says nothing about stored garbage, which is content rather than a broken store", async () => {
    // The store ANSWERED, so nothing is stuck: `[]` lets the next pull re-learn
    // the set. Reporting it would make a corrupt blob indistinguishable from
    // the unbounded case, which is the one worth waking somebody for.
    const { getTombstones } = await load();
    spy.store.set(`collectables-tombstones-v1-items-${USER}`, "{not json");
    assert.deepEqual(await getTombstones("items", USER), []);
    assert.deepEqual(spy.captured, []);
  });

  it("says nothing while the store works, including for the no-op write", async () => {
    const { getTombstones, setTombstones } = await load();
    const ids = ["a", "b"];
    await setTombstones("items", USER, ids, ids);
    await setTombstones("items", USER, ["a"]);
    await getTombstones("items", USER);
    assert.deepEqual(spy.captured, []);
  });
});

describe("the round trip a failing store must not corrupt", () => {
  it("a caller that treats an unreadable read as empty narrows the persisted set", async () => {
    // Not a test of the module — a demonstration of why the null exists, run
    // against the real helpers so it stays true. This is the shape every caller
    // had before: read, merge, write back.
    const { getTombstones, mergeTombstoneIds, setTombstones } = await load();
    await setTombstones("items", USER, ["old-1", "old-2"]);

    spy.readError = new Error("storage unavailable");
    const stored = await getTombstones("items", USER);
    spy.readError = null;

    const asIfEmpty = stored ?? [];
    await setTombstones("items", USER, mergeTombstoneIds(asIfEmpty, ["new-1"]), asIfEmpty);
    assert.deepEqual(
      await getTombstones("items", USER),
      ["new-1"],
      "two tombstones were replaced by one, and both deleted rows come back on the next hydrate",
    );
  });

  it("skipping the write on a null read leaves the stored set intact", async () => {
    const { getTombstones, mergeTombstoneIds, setTombstones } = await load();
    await setTombstones("items", USER, ["old-1", "old-2"]);

    spy.readError = new Error("storage unavailable");
    const stored = await getTombstones("items", USER);
    spy.readError = null;

    if (stored !== null) {
      await setTombstones("items", USER, mergeTombstoneIds(stored, ["new-1"]), stored);
    }
    assert.deepEqual(await getTombstones("items", USER), ["old-1", "old-2"]);
  });
});
