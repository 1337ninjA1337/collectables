import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { SORT_OPTIONS } from "@/lib/item-filters";
import {
  EMPTY_SORT_PREFS,
  isItemSortMode,
  parseSortPrefs,
  pruneSortPrefs,
  sortPrefFor,
  withSortPref,
} from "@/lib/item-sort-prefs";
import { STORAGE_FAILURE_SITES } from "@/lib/report-storage-failure";
import { ITEM_SORT_KEY } from "@/lib/storage-keys";
import { readRepoFile } from "./helpers/repo-file";

/**
 * The sort a collection is remembered by.
 *
 * `itemFilters` reset to `EMPTY_FILTERS` on every mount, so a user who prefers
 * A→Z re-picked it on every visit — two taps behind a sheet, every time. Only
 * the sort persists: a query or a tag filter is the question being asked right
 * now, and restoring one would hide items with no visible cause.
 */
describe("isItemSortMode", () => {
  it("accepts every mode the picker offers", () => {
    for (const option of SORT_OPTIONS) {
      assert.ok(isItemSortMode(option.mode), `${option.mode} is not recognised`);
    }
  });

  it("rejects a mode no build offers any more, and every non-string", () => {
    // The blob outlives the build that wrote it: a retired mode would sort
    // nothing while showing no chip, which reads as a broken picker.
    assert.equal(isItemSortMode("rarity-desc"), false);
    assert.equal(isItemSortMode(""), false);
    assert.equal(isItemSortMode(undefined), false);
    assert.equal(isItemSortMode(null), false);
    assert.equal(isItemSortMode(3), false);
    assert.equal(isItemSortMode({ mode: "name-asc" }), false);
  });
});

describe("parseSortPrefs", () => {
  it("reads a stored blob", () => {
    const prefs = parseSortPrefs(JSON.stringify({ c1: "name-asc", c2: "cost-desc" }));
    assert.deepEqual(prefs, { c1: "name-asc", c2: "cost-desc" });
  });

  it("keeps the good entries when one is unusable", () => {
    // One collection whose mode was retired must not cost the user every
    // other collection's sort.
    const prefs = parseSortPrefs(
      JSON.stringify({ c1: "name-asc", c2: "rarity-desc", c3: 7, "": "cost-asc" }),
    );
    assert.deepEqual(prefs, { c1: "name-asc" });
  });

  it("reads nothing from an absent, empty, malformed or wrong-shaped blob", () => {
    for (const raw of [null, undefined, "", "{oops", "[]", '"name-asc"', "42"]) {
      assert.deepEqual(parseSortPrefs(raw), {}, `raw: ${String(raw)}`);
    }
  });
});

describe("sortPrefFor", () => {
  it("answers the remembered mode", () => {
    assert.equal(sortPrefFor({ c1: "cost-asc" }, "c1"), "cost-asc");
  });

  it("answers default for a collection nobody sorted, and for no collection at all", () => {
    assert.equal(sortPrefFor({ c1: "cost-asc" }, "c2"), "default");
    assert.equal(sortPrefFor(EMPTY_SORT_PREFS, "c1"), "default");
    assert.equal(sortPrefFor({ c1: "cost-asc" }, undefined), "default");
  });

  it("answers default for a stored value it does not recognise", () => {
    // parseSortPrefs drops these, but the getter is also called with prefs
    // held in memory across a version change.
    assert.equal(sortPrefFor({ c1: "rarity-desc" } as never, "c1"), "default");
  });
});

describe("withSortPref", () => {
  it("remembers a chosen mode", () => {
    assert.deepEqual(withSortPref(EMPTY_SORT_PREFS, "c1", "name-desc"), { c1: "name-desc" });
  });

  it("leaves the other collections alone", () => {
    assert.deepEqual(withSortPref({ c1: "name-asc" }, "c2", "cost-asc"), {
      c1: "name-asc",
      c2: "cost-asc",
    });
  });

  it("deletes the entry rather than storing the default", () => {
    // "cleared it" and "never had one" behave identically, so they are one
    // state; storing "default" would grow the blob for every sheet the user
    // opened and backed out of.
    assert.deepEqual(withSortPref({ c1: "name-asc", c2: "cost-asc" }, "c1", "default"), {
      c2: "cost-asc",
    });
  });

  it("returns the same object when it has nothing new to say", () => {
    const prefs = { c1: "name-asc" } as const;
    assert.equal(withSortPref(prefs, "c1", "name-asc"), prefs, "re-picking the active sort wrote");
    assert.equal(withSortPref(prefs, "c2", "default"), prefs, "clearing an absent entry wrote");
    assert.equal(withSortPref(prefs, undefined, "cost-asc"), prefs, "wrote without a collection");
  });

  it("never mutates the preferences it was given", () => {
    const prefs = { c1: "name-asc" } as const;
    withSortPref(prefs, "c1", "cost-desc");
    withSortPref(prefs, "c1", "default");
    assert.deepEqual(prefs, { c1: "name-asc" });
  });
});

describe("pruneSortPrefs", () => {
  it("drops entries for collections that no longer exist", () => {
    assert.deepEqual(pruneSortPrefs({ c1: "name-asc", gone: "cost-asc" }, new Set(["c1"])), {
      c1: "name-asc",
    });
  });

  it("returns the same object when every entry is still reachable", () => {
    const prefs = { c1: "name-asc" } as const;
    assert.equal(pruneSortPrefs(prefs, new Set(["c1", "c2"])), prefs);
    assert.equal(pruneSortPrefs(EMPTY_SORT_PREFS, new Set()), EMPTY_SORT_PREFS);
  });
});

describe("the hook and the screen wire it up", () => {
  it("reports both storage failures through the shared budget", () => {
    // A sort preference that cannot persist is a cache miss, not data loss —
    // but a device store that rejects one write rejects all of them, and this
    // is the budgeted way to say so once.
    assert.ok(STORAGE_FAILURE_SITES.includes("use-item-sort-pref.getItem"));
    assert.ok(STORAGE_FAILURE_SITES.includes("use-item-sort-pref.setItem"));
  });

  it("keys the blob under the namespace every other preference uses", () => {
    assert.match(ITEM_SORT_KEY, /^collectables-[a-z-]+-v\d+$/);
  });

  it("reads and writes the whole blob, never just this collection's entry", () => {
    // A write that serialised `{ [collectionId]: sort }` would drop every
    // other collection's remembered sort on each pick — the bug a per-key
    // storage layout would have made impossible and a shared blob invites.
    const hook = readRepoFile("lib/use-item-sort-pref.ts");
    assert.match(hook, /withSortPref\(prefsRef\.current, collectionId, sort\)/);
    assert.match(hook, /AsyncStorage\.setItem\(ITEM_SORT_KEY, JSON\.stringify\(next\)\)/);
  });

  it("skips the write when the pick says nothing new", () => {
    const hook = readRepoFile("lib/use-item-sort-pref.ts");
    assert.match(hook, /if \(next === prefsRef\.current\) return;/);
  });

  it("answers 'default' rather than hanging when the store cannot be read", () => {
    // `null` means "still reading" to the screen, so a rejected read that left
    // it null would block the restore effect forever.
    const hook = readRepoFile("lib/use-item-sort-pref.ts");
    const failure = hook.match(/\.catch\(\(error: unknown\) => \{[\s\S]*?\}\);/)?.[0] ?? "";
    assert.match(failure, /setRestored\("default"\)/);
  });

  it("remembers the sort from every surface that can change it", () => {
    // Three surfaces change the sort — the picker sheet, the empty-search
    // reset, and the reorder notice's reset — and one that skipped the
    // remember step would stop persisting from that surface only, which is
    // the kind of gap nobody reports as a bug.
    const source = readRepoFile("app/collection/[id].tsx");
    assert.match(source, /<ItemFilterBar filters=\{itemFilters\} onChange=\{applyFilters\} \/>/);
    assert.match(source, /onAction=\{\(\) => applyFilters\(EMPTY_FILTERS\)\}/);
    // The notice's reset and the reorder handoff go through `applySort`, which
    // keeps the functional updater (it must not clobber an active query) and
    // remembers the mode on the same line.
    assert.match(source, /const resetSort = useCallback\(\(\) => applySort\("default"\), \[applySort\]\);/);
    assert.match(source, /action: \{ label: t\("undo"\), onPress: \(\) => applySort\(previous\) \}/);
    const direct = source.match(/setItemFilters\(/g) ?? [];
    assert.equal(
      direct.length,
      3,
      `expected setItemFilters called only by applyFilters, the restore effect and resetSort, found ${direct.length}`,
    );
  });

  it("applies the restored sort once, and never over the user's own pick", () => {
    // The read is async: a user who picks a sort while it is in flight must
    // not have it replaced by the one the store was still fetching.
    const source = readRepoFile("app/collection/[id].tsx");
    assert.match(source, /if \(restoredSort === null \|\| sortRestoredRef\.current\) return;/);
    assert.match(source, /sortRestoredRef\.current = true;\n\s*setItemFilters\(next\);/);
  });
});
