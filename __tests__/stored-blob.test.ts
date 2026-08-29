import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  blobRecord,
  blobRows,
  mayPersistHydration,
  readStoredArray,
  readStoredRecord,
  UNREADABLE_BLOB,
} from "@/lib/stored-blob";

import { readRepoFile } from "./helpers/repo-file";

/**
 * The rule that separates "the store holds nothing" from "the store did not
 * answer", and what a hydrate may write back afterwards.
 *
 * ## What it was extracted from
 *
 * `CollectionsProvider` hydrated seven sources in one `Promise.all` — five
 * AsyncStorage reads and two Supabase fetches — under a single `try`:
 *
 *     catch { setLocalCollections(seedCollections); setLocalItems(seedItems); }
 *     finally { setReady(true); }
 *
 * `ready` is what enables the five `usePersistedBlob` effects. So ANY rejection
 * in the batch put the DEMO SEED DATA into state and then persisted it over the
 * signed-in user's real collections and items — permanently, because those
 * writes succeed. Two of the seven sources are network calls, so an OFFLINE
 * LAUNCH was enough to do it. Nothing in the tree could see this: the storage
 * rules ask about a rejected write, and this is a successful write of the wrong
 * thing.
 *
 * ## Why the rule is a module rather than a fix in place
 *
 * The provider pulls React Native peers, so a rule left inline there can only
 * be asserted about its source text — which is exactly the coverage the batch
 * had while it was destroying data. Pure and called here.
 */

describe("readStoredArray", () => {
  it("reads a stored array", () => {
    assert.deepEqual(readStoredArray<number>("[1,2,3]"), { status: "stored", value: [1, 2, 3] });
  });

  it("calls null, undefined and the empty string EMPTY — a fresh account", () => {
    // The one case where seed data is the right answer, and the empty string is
    // in it because that is what a truncated write leaves behind.
    for (const raw of [null, undefined, ""]) {
      assert.deepEqual(readStoredArray(raw), { status: "empty" }, `for ${JSON.stringify(raw)}`);
    }
  });

  it("calls anything else UNUSABLE, never empty", () => {
    // The distinction the whole module is about. A blob of the wrong shape was
    // written by SOMETHING, and the one thing that must not follow is a write
    // over it — which is what treating it as a fresh account would produce.
    for (const raw of ["{not json", '{"a":1}', "42", '"a string"', "null", "true"]) {
      assert.deepEqual(readStoredArray(raw), { status: "unusable" }, `for ${raw}`);
    }
  });

  it("keeps an empty stored array distinct from an empty key", () => {
    // "The user deleted their last collection" and "this account is new" are
    // both an empty screen and are not the same fact: only the second may be
    // filled with seed data.
    assert.deepEqual(readStoredArray("[]"), { status: "stored", value: [] });
  });
});

describe("readStoredRecord", () => {
  it("reads a stored keyed queue", () => {
    assert.deepEqual(readStoredRecord<number[]>('{"a":[1]}'), {
      status: "stored",
      value: { a: [1] },
    });
  });

  it("refuses an array and a null, which `typeof` calls objects", () => {
    // Both are the shape a different version of this app wrote, so both are
    // unusable rather than empty. `typeof null === "object"` is the one that
    // would otherwise pass through as a queue and crash the first read of it.
    assert.deepEqual(readStoredRecord("[]"), { status: "unusable" });
    assert.deepEqual(readStoredRecord("null"), { status: "unusable" });
  });

  it("agrees with the array reader about empty and unparseable", () => {
    assert.deepEqual(readStoredRecord(""), { status: "empty" });
    assert.deepEqual(readStoredRecord("{not json"), { status: "unusable" });
  });
});

describe("blobRows", () => {
  const SEED = [{ id: "demo" }];

  it("hands back what was stored", () => {
    assert.deepEqual(blobRows({ status: "stored", value: [{ id: "real" }] }, SEED), [
      { id: "real" },
    ]);
  });

  it("hands back the seed for an empty key, COPIED", () => {
    const rows = blobRows({ status: "empty" }, SEED);
    assert.deepEqual(rows, SEED);
    assert.notEqual(rows, SEED, "a caller that mutates its rows must not edit the seed module");
  });

  it("hands back NOTHING for a blob it could not read or understand", () => {
    // The line that stops the seeds reaching a real account. An unreadable
    // store is not a new user, and neither is a corrupt blob.
    assert.deepEqual(blobRows(UNREADABLE_BLOB, SEED), []);
    assert.deepEqual(blobRows({ status: "unusable" }, SEED), []);
  });
});

describe("blobRecord", () => {
  it("hands back the stored queue, and an empty one for everything else", () => {
    assert.deepEqual(blobRecord({ status: "stored", value: { a: [1] } }), { a: [1] });
    assert.deepEqual(blobRecord({ status: "empty" }), {});
    assert.deepEqual(blobRecord(UNREADABLE_BLOB), {});
    assert.deepEqual(blobRecord({ status: "unusable" }), {});
  });
});

describe("mayPersistHydration", () => {
  it("allows a hydrate that read and understood everything", () => {
    assert.equal(
      mayPersistHydration([{ status: "stored", value: [] }, { status: "empty" }]),
      true,
    );
  });

  it("refuses on ONE unreadable blob among many", () => {
    // The blobs share one `enabled` flag and reference each other by id, so a
    // hydrate that could not read the items blob has no business rewriting the
    // collections one: a half-known pair written back is worse than neither.
    assert.equal(
      mayPersistHydration([
        { status: "stored", value: [] },
        UNREADABLE_BLOB,
        { status: "empty" },
      ]),
      false,
    );
  });

  it("refuses on an unusable blob too, because that one is still on disk", () => {
    assert.equal(mayPersistHydration([{ status: "unusable" }]), false);
  });

  it("allows an empty list — a caller that read nothing has nothing to lose", () => {
    assert.equal(mayPersistHydration([]), true);
  });
});

describe("the provider's hydrate adopts the rule", () => {
  const SOURCE = readRepoFile("lib/collections-context.tsx");

  it("gates persistence on the hydrate as well as on ready", () => {
    // The two questions that were one boolean. `ready` says the UI may render;
    // `hydrationSafeToPersist` says the store was understood. Collapsing them
    // is what let a `finally` that ran on failure enable five writes.
    assert.match(SOURCE, /const persistEnabled = ready && hydrationSafeToPersist && !!user;/);
    assert.match(SOURCE, /useState\(false\)/);
  });

  it("no longer installs the seed data from the hydrate's catch arm", () => {
    const catchArm = SOURCE.slice(SOURCE.indexOf("} catch (error: unknown) {", SOURCE.indexOf("async function hydrate")));
    assert.doesNotMatch(
      catchArm.slice(0, 900),
      /setLocalCollections\(seedCollections\)|setLocalItems\(seedItems\)/,
      "a failed hydrate must not put demo data where the user's data was",
    );
  });

  it("lets both hydrate fetches fail without taking the local reads down", () => {
    assert.match(SOURCE, /fetchFollowedCollectionIds\(activeUser\.id\)\.catch\(\(\) => null\)/);
    assert.match(SOURCE, /fetchWishlistItemsByUserId\(activeUser\.id\)\.catch\(\(\) => null\)/);
  });

  it("clears the gate on sign-out, so the next account earns it again", () => {
    // Otherwise the signed-out empty state is persisted over whatever the
    // incoming account has on disk, which is the same bug with a different
    // trigger.
    assert.match(SOURCE, /setReady\(false\);[\s\S]{0,400}?setHydrationSafeToPersist\(false\);/);
  });
});
