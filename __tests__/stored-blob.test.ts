import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  blobObject,
  blobRows,
  mayPersistHydration,
  readStoredArray,
  readStoredObject,
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

describe("readStoredObject", () => {
  it("reads a stored keyed queue", () => {
    assert.deepEqual(readStoredObject<Record<string, number[]>>('{"a":[1]}'), {
      status: "stored",
      value: { a: [1] },
    });
  });

  it("refuses an array and a null, which `typeof` calls objects", () => {
    // Both are the shape a different version of this app wrote, so both are
    // unusable rather than empty. `typeof null === "object"` is the one that
    // would otherwise pass through as a queue and crash the first read of it.
    assert.deepEqual(readStoredObject("[]"), { status: "unusable" });
    assert.deepEqual(readStoredObject("null"), { status: "unusable" });
  });

  it("agrees with the array reader about empty and unparseable", () => {
    assert.deepEqual(readStoredObject(""), { status: "empty" });
    assert.deepEqual(readStoredObject("{not json"), { status: "unusable" });
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

describe("blobObject", () => {
  it("hands back the stored object, and `whenEmpty` for everything else", () => {
    assert.deepEqual(blobObject({ status: "stored", value: { a: [1] } }, {}), { a: [1] });
    assert.deepEqual(blobObject({ status: "empty" }, {}), {});
    assert.deepEqual(blobObject(UNREADABLE_BLOB, {}), {});
    assert.deepEqual(blobObject({ status: "unusable" }, {}), {});
  });

  it("does not treat a fresh account and an unreadable store alike when they differ", () => {
    // `blobRows` copies its seed and answers [] for the two failures;
    // `blobObject` has ONE fallback for all three because no caller here has a
    // non-empty default. The day one does, this is the case that will be wrong,
    // which is why the asymmetry is written down rather than assumed.
    const fresh = { following: ["a"] };
    assert.deepEqual(blobObject({ status: "empty" }, fresh), fresh);
    assert.deepEqual(blobObject(UNREADABLE_BLOB, fresh), fresh);
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
    // The strict half, and the one the two CACHE providers deliberately do not
    // take: `premium-context` and `marketplace-context` gate on the read alone,
    // because a corrupt blob of cloud-owned rows has no future but to be
    // replaced and this rule would refuse to replace it forever. See the note
    // in `lib/stored-blob.ts`.
    assert.equal(mayPersistHydration([{ status: "unusable" }]), false);
  });

  it("allows an empty list — a caller that read nothing has nothing to lose", () => {
    assert.equal(mayPersistHydration([]), true);
  });
});

describe("the provider's hydrate adopts the rule", () => {
  const SOURCE = readRepoFile("lib/collections-context.tsx");

  it("gates persistence on the hydrate and on the account, as well as on ready", () => {
    // The three questions that were one boolean. `ready` says the UI may
    // render; `hydrationSafeToPersist` says the store was understood; and
    // `hydrationMatchesKey` says WHICH account the state in hand came from —
    // `!!user` was true on the render where the account changed, which is how
    // the previous user's five blobs reached the new user's keys.
    assert.match(
      SOURCE.replace(/\s+/g, " "),
      /const persistEnabled = ready && hydrationSafeToPersist && hydrationMatchesKey\(hydratedUserId, user\?\.id \?\? null\);/,
    );
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

describe("the three cache providers gate their persists too", () => {
  // Same shape, four blobs smaller each: a `catch` that installs a default, a
  // `finally` that flips `ready`, and a persist effect that follows `ready`.
  // Found by asking the collections question of every other provider.

  it("PremiumProvider no longer downgrades a payer from a failed READ", () => {
    const source = readRepoFile("lib/premium-context.tsx");
    assert.match(
      source.replace(/\s+/g, " "),
      /if \(!ready \|\| !hydrationSafeToPersist \|\| !hydrationMatchesKey\(hydratedKey, storageKey\)\) \{ return; \}/,
      "the persist effect must not run after a hydrate that could not read, or one that read a DIFFERENT account",
    );
    assert.match(source, /reportStorageFailure\("premium-context\.getItem"/);
    // The catch arm sets the flag and reports, and does NOT touch `state`.
    // Matched as a statement rather than by scanning a window, because the
    // comment in that arm names the call it removed.
    assert.match(
      source.replace(/\s+/g, " "),
      /catch \(error: unknown\) \{.{0,900}?setHydrationSafeToPersist\(false\); setHydratedKey\(null\); reportStorageFailure\("premium-context\.getItem"/,
    );
    assert.equal(
      source.match(/^\s*setState\(DEFAULT_PREMIUM_STATE\);$/gm)?.length,
      1,
      "the only remaining default-write is the signed-out branch, not the failed read",
    );
  });

  it("MarketplaceProvider actually falls back to the cache its comment promises", () => {
    // `await cloudFetchListings()` throwing jumped straight past the local read
    // to the catch, leaving an empty list that the persist effect then wrote
    // over the cache. An offline launch emptied the very cache it was for.
    const source = readRepoFile("lib/marketplace-context.tsx");
    assert.match(source, /cloudFetchListings\(\)\.catch\(\(\) => null\)/);
    assert.match(source, /if \(!ready \|\| !hydrationSafeToPersist\) return;/);
    assert.match(source, /reportStorageFailure\("marketplace-context\.getItem"/);
  });

  it("DiagnosticsProvider reports an unreadable opt-out and keeps the SDKs off", () => {
    // No persist effect here — the write is user-initiated — so the risk is the
    // other way round: a stored opt-out that cannot be read must not become an
    // opt-in, and nothing else would ever mention that it happened.
    const source = readRepoFile("lib/diagnostics-context.tsx");
    assert.match(source, /reportStorageFailure\("diagnostics-context\.getItem"/);
    const catchArm = source.slice(source.indexOf(".catch((error: unknown) => {"));
    assert.doesNotMatch(
      catchArm.slice(0, 600),
      /initSentry|initAnalytics|initClarity/,
      "a failed read must not start the SDKs the stored choice may have refused",
    );
  });

  it("SocialProvider gates all three of its persist effects", () => {
    // Named guards rather than a count of the identifier: a count moves when
    // anybody adds a dependency-array entry, and would then be "fixed" by
    // editing the number rather than by looking at what changed.
    const source = readRepoFile("lib/social-context.tsx");
    const flat = source.replace(/\s+/g, " ");
    const guards = flat.match(
      /if \((?:!user \|\| )?!ready \|\| !hydrationSafeToPersist(?: \|\| !hydrationMatchesKey\(hydratedUserId, user\.id\))?\)/g,
    );
    assert.equal(guards?.length, 3, "the social cache, the graph and the pending queue");
    // Two of the three write a key with the user id in it, and those two also
    // ask WHICH account the state was hydrated for — the third writes one
    // global graph key, where there is no other account's blob to land on.
    assert.equal(
      flat.match(/!hydrationMatchesKey\(hydratedUserId, user\.id\)/g)?.length,
      2,
      "the social cache and the pending queue are user-scoped; the graph key is not",
    );
    assert.match(source, /setHydrationSafeToPersist\(\s*mayPersistHydration\(/, "set by the hydrate");
    assert.match(source, /setReady\(false\);[\s\S]{0,400}?setHydrationSafeToPersist\(false\);/, "cleared on sign-out");
  });
});
