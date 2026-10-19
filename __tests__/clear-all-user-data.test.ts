import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { installStorageSpy } from "./helpers/spy-async-storage";
import { readRepoFile } from "./helpers/repo-file";

/**
 * The production account-deletion wipe, run rather than read.
 *
 * `clearAllUserData` removes every key this device holds for one account, and
 * `lib/delete-account-flow.ts` runs it after the Edge Function has deleted the
 * auth user — so a key it forgets is residue of an account that no longer
 * exists, sitting in storage while the app navigates away looking signed out.
 * The next person to open the app on that device sees it.
 *
 * ## Why this suite exists
 *
 * The list was twenty-odd entries written by hand, and the dev-only wipe
 * beside it (`clearAllCollectablesStorage`) is a `collectables-*` SWEEP. So a
 * new storage key joined the sweep automatically and the production wipe only
 * if somebody remembered — and `ITEM_SORT_KEY` is the one that did not. Its
 * own comment argues a sort mode is "a view preference rather than anything a
 * signed-out user should not see", which is true about VISIBILITY and says
 * nothing about deletion: the blob is keyed by the deleted account's
 * collection ids.
 *
 * The exemption list below is the half an "every key is wiped" assertion
 * cannot have on its own: a key deliberately kept and a key forgotten look
 * identical from outside, which is the two-readings shape this repository
 * keeps removing.
 */
const spy = installStorageSpy();

/** Keys this module can produce that the wipe deliberately does NOT remove. */
const KEPT: Readonly<Record<string, string>> = {
  "collectables-diagnostics-v1":
    "a device setting, not account data: `{ enabled }` for the Sentry opt-in, chosen on this phone and carrying nothing about who was signed in. Wiping it would silently re-decide diagnostics for the device's next user",
};

/**
 * The entities `syncCursorKey` / `tombstoneKey` are instantiated for.
 *
 * The two-argument builders take an entity as well as a user, and the wipe
 * enumerates these two itself. A third entity would have to be added in both
 * places, which is the one thing this suite cannot discover — named here
 * rather than left implicit in a loop.
 */
const SCOPED_ENTITIES = ["collections", "items"] as const;

/**
 * Every `collectables-*` key the module exports, user-scoped ones resolved.
 *
 * Arity-driven: a builder's own `length` says whether it takes a user or an
 * entity AND a user, so the suite cannot invent a key by passing the wrong
 * arguments — `syncCursorKey("u1")` would produce
 * `collectables-sync-cursor-v1-u1-undefined`, a string that looks like a key
 * nothing writes and would fail this case with a name no reader could place.
 */
async function allKeysFor(userId: string): Promise<string[]> {
  const keys = (await import("@/lib/storage-keys")) as unknown as Record<string, unknown>;
  const found = new Set<string>();
  const keep = (produced: unknown) => {
    if (typeof produced === "string" && produced.startsWith("collectables-")) found.add(produced);
  };
  for (const [name, value] of Object.entries(keys)) {
    if (name === "COLLECTABLES_STORAGE_PREFIX" || name === "STORAGE_KEY_ID_PLACEHOLDER") continue;
    if (typeof value === "string") {
      keep(value);
      continue;
    }
    if (typeof value !== "function" || !name.endsWith("Key")) continue;
    const builder = value as (...args: string[]) => unknown;
    if (builder.length === 1) keep(builder(userId));
    else if (builder.length === 2) {
      for (const entity of SCOPED_ENTITIES) keep(builder(entity, userId));
    }
  }
  return [...found];
}

describe("clearAllUserData removes what it says it removes", () => {
  beforeEach(() => spy.reset());

  it("wipes every key it was given", async () => {
    // The premise: a spy whose `multiRemove` did nothing would make every
    // assertion below vacuously agreeable.
    const { clearAllUserData, collectionsKey, itemsKey } = await import("@/lib/storage-keys");
    spy.store.set(collectionsKey("u1"), "[]");
    spy.store.set(itemsKey("u1"), "[]");
    await clearAllUserData("u1");
    assert.equal(spy.store.size, 0);
  });

  it("leaves another account's rows alone", async () => {
    // The per-user half of the key names is the whole reason they are
    // per-user: two accounts on one device, one deletion.
    const { clearAllUserData, collectionsKey } = await import("@/lib/storage-keys");
    spy.store.set(collectionsKey("u1"), "mine");
    spy.store.set(collectionsKey("u2"), "theirs");
    await clearAllUserData("u1");
    assert.deepEqual([...spy.store.keys()], [collectionsKey("u2")]);
  });

  it("removes every key the module can produce, except the ones named above", async () => {
    // The case the hand-written list never had. A key added to
    // `lib/storage-keys.ts` and forgotten here fails with its own name.
    const { clearAllUserData } = await import("@/lib/storage-keys");
    for (const key of await allKeysFor("u1")) spy.store.set(key, "x");
    const before = spy.store.size;
    assert.ok(before >= 20, `only ${String(before)} keys were derived — the module read has broken`);

    await clearAllUserData("u1");
    assert.deepEqual(
      [...spy.store.keys()].sort(),
      Object.keys(KEPT).sort(),
      "a key this module can write survived an account deletion and is not in KEPT with a reason",
    );
  });

  it("the exemption list is not stale", async () => {
    // The other direction: a key exempted that the module no longer writes is
    // a reason nobody will re-read, and one the wipe HAS started removing is
    // an exemption that reads as a decision it is not.
    const all = new Set(await allKeysFor("u1"));
    for (const key of Object.keys(KEPT)) {
      assert.ok(all.has(key), `${key} is exempted and is not a key this module writes any more`);
    }
  });

  it("wipes the sort-mode blob, which is keyed by the deleted account's collections", async () => {
    // The key that was missing. Not user-scoped, so nothing about its NAME
    // said it belonged to anybody — and its contents are a map from the
    // deleted account's collection ids to a sort mode.
    const { clearAllUserData, ITEM_SORT_KEY } = await import("@/lib/storage-keys");
    spy.store.set(ITEM_SORT_KEY, JSON.stringify({ "col-1": "newest" }));
    await clearAllUserData("u1");
    assert.equal(spy.store.has(ITEM_SORT_KEY), false);
  });

  it("is all-or-nothing when the store refuses, which is what localDataRemains rests on", async () => {
    // `lib/delete-account-flow.ts` reports "the account is gone and this
    // device still holds its rows" off this one failure, and the sentence is
    // only true because a failed `multiRemove` removes NONE of the keys
    // rather than some.
    const { clearAllUserData, collectionsKey, ITEM_SORT_KEY } = await import("@/lib/storage-keys");
    spy.store.set(collectionsKey("u1"), "[]");
    spy.store.set(ITEM_SORT_KEY, "{}");
    spy.removeError = new Error("storage full");
    await assert.rejects(() => clearAllUserData("u1"), /storage full/);
    assert.equal(spy.store.size, 2, "a partial wipe would make localDataRemains' sentence a half-truth");
  });
});

describe("the two wipes and what each is for", () => {
  const src = readRepoFile("lib/storage-keys.ts");

  it("the dev-only wipe is a sweep and the production one is a list", () => {
    // Both are correct and they are correct for different reasons, which is
    // the thing nothing used to say: the sweep cannot be wrong about a new key
    // and cannot be run in production (it would take the device settings with
    // it); the list can be wrong about a new key, which is why the case above
    // exists.
    assert.match(src, /clearAllCollectablesStorage[\s\S]*?getAllCollectablesKeys\(\)/);
    assert.match(src, /dev-only reset/);
    assert.match(src, /export async function clearAllUserData\(userId: string\)/);
  });

  it("the production wipe says a case holds its list to the module", () => {
    assert.match(src, /clear-all-user-data\.test\.ts/);
  });
});
