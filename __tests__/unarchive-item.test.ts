import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveLocalItem } from "@/lib/collections-helpers";
import { stripComments } from "@/lib/strip-comments";
import { CollectableItem } from "@/lib/types";

import { readI18nSource } from "./helpers/i18n-source-file";
import { assertDeclaredInEveryLocale, localeValuesOf } from "./helpers/i18n-locales";
import { readRepoFile } from "./helpers/repo-file";

/**
 * Getting an archived item back, and the read that made the archive unreliable
 * in the first place.
 *
 * `archiveItem` is offered by the sold-listing prompt as the SAFE answer next
 * to Delete — "keep it for stats and audit history" — and it was the
 * irreversible one. An archived item leaves every listing, total, count,
 * recent-items strip and search in the app, no screen lists archived rows, and
 * there was no `unarchiveItem` anywhere in the tree. The row stayed in
 * storage and kept syncing: not gone, not reachable, and counted by nothing.
 *
 * The second half of this suite is a bug found while reading the first: five
 * mutations learned what they had changed by assigning to a `let` from inside
 * a `setLocalItems` updater and reading it on the next line, which React does
 * not promise to have run.
 */

const item = (over: Partial<CollectableItem> = {}): CollectableItem => ({
  id: "i-1",
  collectionId: "c-1",
  title: "An item",
  acquiredAt: "",
  acquiredFrom: "",
  description: "",
  variants: "",
  photos: [],
  createdBy: "u-1",
  createdByUserId: "u-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("resolveLocalItem", () => {
  const items = [item({ id: "a" }), item({ id: "b", title: "Second" })];

  it("finds the item a mutation is about to change", () => {
    assert.equal(resolveLocalItem(items, "b")?.title, "Second");
  });

  it("answers undefined for an id the list does not hold", () => {
    // The mutations early-return on this, which is what keeps a sync write
    // from being issued for a row that is not there.
    assert.equal(resolveLocalItem(items, "nope"), undefined);
  });

  it("answers undefined on an empty list rather than throwing", () => {
    assert.equal(resolveLocalItem([], "a"), undefined);
  });

  it("hands back the stored object, not a copy", () => {
    // The callers spread it into a new object themselves; a helper that copied
    // would make `===` comparisons in a caller quietly false.
    assert.equal(resolveLocalItem(items, "a"), items[0]);
  });
});

describe("the five mutations read before they write", () => {
  const SRC = stripComments(readRepoFile("lib/collections-context.tsx"));

  it("no mutation assigns to a let from inside a setState updater", () => {
    // The pattern: `let updated = null; setLocalItems((c) => c.map(... updated
    // = next ...)); if (updated) sync(updated)`. React computes a `useState`
    // update eagerly only while the hook has no work queued, so this holds
    // until something else has queued one — a landing realtime row, a second
    // tap, a sync flush — and then the sync is skipped, the local state
    // changes, the remote row does not, and the next sync hands the old value
    // back. An edit that reverts itself, only under load.
    assert.doesNotMatch(SRC, /let \w+: CollectableItem \| null = null;/);
    assert.doesNotMatch(SRC, /let \w+: Collection \| null = null;/);
    assert.doesNotMatch(SRC, /const moved: CollectableItem\[\] = \[\];/);
  });

  it("each of the five resolves its subject from the local list first", () => {
    const resolves = SRC.match(/resolveLocalItem\(localItems, itemId\)/g) ?? [];
    // updateItem, promoteWishlistItem, archiveItem, unarchiveItem.
    assert.equal(resolves.length, 4);
    // updateCollection is the fifth and works on the other list.
    assert.match(SRC, /const current = localCollections\.find\(\(col\) => col\.id === collectionId\);/);
    // moveItems is plural, so it filters rather than finds.
    assert.match(SRC, /const moved = localItems\s*\.filter\(/);
  });

  it("every one of them bails when the subject is gone", () => {
    const guards = SRC.match(/if \(!current\) return;/g) ?? [];
    assert.equal(guards.length, 5, "a mutation that skips this would sync a row it never had");
    assert.match(SRC, /if \(moved\.length === 0\) return;/);
  });

  it("moveItems still writes each moved row exactly once", () => {
    // It used to push into an array from inside the updater; now it builds the
    // list up front and the state write indexes it. A `map` that rebuilt the
    // object per row would give the sync a different reference than the state.
    assert.match(SRC, /const movedById = new Map\(moved\.map\(\(item\) => \[item\.id, item\]\)\);/);
    assert.match(SRC, /setLocalItems\(\(items\) => items\.map\(\(item\) => movedById\.get\(item\.id\) \?\? item\)\);/);
  });
});

describe("unarchiveItem", () => {
  const SRC = stripComments(readRepoFile("lib/collections-context.tsx"));

  it("exists, which it did not", () => {
    assert.match(SRC, /unarchiveItem: async \(itemId\) => \{/);
    assert.match(SRC, /unarchiveItem: \(itemId: string\) => Promise<void>;/);
  });

  it("clears archivedAt with null rather than undefined", () => {
    // `updateRemoteItem` writes the column only when the key is PRESENT in
    // `updates` (`"archivedAt" in updates`), and the row coercer reads `null`
    // for "not archived". An `undefined` would clear the local flag and leave
    // the cloud row archived — so the next sync would put the item straight
    // back in the trash, which is a worse bug than the one this fixes.
    assert.match(SRC, /const restored: CollectableItem = \{ \.\.\.current, archivedAt: null \};/);
    assert.match(SRC, /updateRemoteItem\(itemId, \{ archivedAt: null \}\)/);
  });

  it("is the exact inverse of what archiveItem writes", () => {
    assert.match(SRC, /updateRemoteItem\(itemId, \{ archivedAt \}\)/);
  });

  it("still writes the field when the key is present, which is the contract it relies on", () => {
    const REMOTE = stripComments(readRepoFile("lib/supabase-profiles.ts"));
    assert.match(REMOTE, /if \("archivedAt" in updates\) body\.archived_at = updates\.archivedAt \?\? null;/);
  });
});

describe("the restore is reachable from where the archive happened", () => {
  const SRC = stripComments(readRepoFile("components/sold-listing-prompt.tsx"));

  it("offers Undo on the archive toast", () => {
    // A success toast has no action slot, so this had to become a `show`.
    assert.match(SRC, /toast\.show\(\{/);
    assert.match(SRC, /message: t\("marketplaceSoldPromptItemArchived"\)/);
    assert.match(SRC, /label: t\("undo"\)/);
    assert.match(SRC, /void unarchiveItem\(archivedId\)/);
  });

  it("captures the id before the await rather than reading item inside the handler", () => {
    // `item` is recomputed on every render of the prompt from the head of the
    // notification queue, and the queue is dismissed on the next line. An undo
    // that closed over `item` would read whatever the NEXT notification is
    // about.
    assert.match(SRC, /const archivedId = item\.id;/);
    assert.match(SRC, /await archiveItem\(archivedId\);/);
  });

  it("says the restore happened out loud", () => {
    // The restore shows no toast of its own, so a screen-reader user who
    // presses Undo and hears nothing has only the lists they cannot see as
    // evidence. Same argument as the reorder undo.
    assert.match(SRC, /announceMessage\(t\("marketplaceSoldPromptItemRestored"\)\)/);
    assert.match(SRC, /import \{ announceMessage \} from "@\/lib\/announce";/);
  });

  it("does not offer Undo beside Delete", () => {
    // Delete is a hard remove behind a confirm dialog; an undo label there
    // would promise something `deleteItem` cannot do.
    const deleteHandler = SRC.slice(SRC.indexOf("async function handleDelete"), SRC.indexOf("function handleKeep"));
    assert.ok(!deleteHandler.includes('t("undo")'));
  });
});

describe("marketplaceSoldPromptItemRestored is translated everywhere", () => {
  const SRC = readI18nSource();

  it("is declared by every locale rather than inherited from en", () => {
    assertDeclaredInEveryLocale(SRC, "marketplaceSoldPromptItemRestored");
  });

  it("says it with that locale's own words", () => {
    const values = [...localeValuesOf(SRC, "marketplaceSoldPromptItemRestored").values()];
    assert.ok(values.length > 0);
    assert.equal(new Set(values).size, values.length, "two locales carry the identical string");
  });

  it("sits beside the archived string it undoes", () => {
    // Not cosmetic: the pair is read together, and a restore string that
    // drifts away from the archive string it answers is the one that gets
    // translated differently in the next sweep.
    const pairs =
      SRC.match(
        /marketplaceSoldPromptItemArchived: "[^"]+",\s*\n\s+marketplaceSoldPromptItemRestored:/g,
      ) ?? [];
    assert.equal(pairs.length, [...localeValuesOf(SRC, "marketplaceSoldPromptItemRestored")].length);
  });
});
