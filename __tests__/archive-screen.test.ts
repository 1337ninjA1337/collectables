import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isArchived } from "@/lib/collections-helpers";
import { stripComments } from "@/lib/strip-comments";
import { CollectableItem } from "@/lib/types";

import { readI18nSource } from "./helpers/i18n-source-file";
import { assertDeclaredInEveryLocale, localeValuesOf } from "./helpers/i18n-locales";
import { readRepoFile } from "./helpers/repo-file";

/**
 * The screen that makes the archive a place rather than a hole.
 *
 * `unarchiveItem` shipped with one caller — the Undo on the sold-listing
 * prompt's toast — which covers the accidental archive and nothing else: eight
 * seconds after the fact there was still no way to see what had been archived
 * or to get any of it back. `archivedItems` and `app/archive.tsx` are the
 * other half, and the home screen's banner is what makes the route reachable
 * without typing a URL.
 *
 * The ordering is the part worth pinning on values: this list is sorted by
 * `archivedAt` and not by `createdAt`, because what somebody opens it looking
 * for is the thing they archived a minute ago rather than the oldest item they
 * own.
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

/** The memo's body, applied to values. */
const archivedIn = (items: CollectableItem[]): CollectableItem[] =>
  items.filter(isArchived).sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));

describe("the archived list", () => {
  it("holds only archived rows", () => {
    const list = archivedIn([
      item({ id: "live" }),
      item({ id: "gone", archivedAt: "2026-02-01T00:00:00.000Z" }),
      item({ id: "legacy", archivedAt: null }),
    ]);

    assert.deepEqual(list.map((i) => i.id), ["gone"]);
  });

  it("puts the most recently archived first", () => {
    // Not `createdAt`: somebody opening this screen is looking for the thing
    // they archived a minute ago, which may be the oldest item they own.
    const list = archivedIn([
      item({ id: "old-item-archived-today", createdAt: "2020-01-01T00:00:00.000Z", archivedAt: "2026-03-01T00:00:00.000Z" }),
      item({ id: "new-item-archived-last-year", createdAt: "2026-02-01T00:00:00.000Z", archivedAt: "2025-01-01T00:00:00.000Z" }),
    ]);

    assert.deepEqual(list.map((i) => i.id), ["old-item-archived-today", "new-item-archived-last-year"]);
  });

  it("includes a wishlist row that was archived", () => {
    // `isArchived` and nothing else: an archived want is as unreachable as an
    // archived holding, and a filter that also asked `!isWishlist` would leave
    // it with no way back at all.
    const list = archivedIn([item({ id: "want", isWishlist: true, archivedAt: "2026-02-01T00:00:00.000Z" })]);

    assert.deepEqual(list.map((i) => i.id), ["want"]);
  });

  it("is empty rather than undefined when nothing is archived", () => {
    assert.deepEqual(archivedIn([item(), item({ id: "b" })]), []);
  });
});

describe("the provider exposes it", () => {
  const SRC = stripComments(readRepoFile("lib/collections-context.tsx"));

  it("filters the viewer's own items, not the merged list", () => {
    // An archive is a thing you did to your OWN rows: a friend's archived item
    // is neither yours to restore nor yours to be shown.
    assert.match(SRC, /const archivedItems = useMemo\(/);
    assert.match(SRC, /localItems\s*\.filter\(isArchived\)/);
  });

  it("sorts by archivedAt, newest first", () => {
    assert.match(
      SRC,
      /\.sort\(\(a, b\) => \(b\.archivedAt \?\? ""\)\.localeCompare\(a\.archivedAt \?\? ""\)\)/,
    );
  });

  it("memoises on localItems alone and puts the array on the value", () => {
    assert.match(SRC, /\.sort[\s\S]{0,120}?\n\s+\[localItems\],\n\s+\);/);
    assert.match(SRC, /^\s+archivedItems,$/m);
    assert.match(SRC, /wishlistItems, archivedItems, localCollections/);
  });

  it("declares it on the context type", () => {
    assert.match(SRC, /archivedItems: CollectableItem\[\];/);
  });
});

describe("the archive screen", () => {
  const SRC = stripComments(readRepoFile("app/archive.tsx"));

  it("reads the list and both resolutions from the context", () => {
    assert.match(
      SRC,
      /const \{ archivedItems, unarchiveItem, deleteItem, getCollectionById \} = useCollections\(\);/,
    );
  });

  it("offers Restore as the primary action on every row", () => {
    assert.match(SRC, /void handleRestore\(item\.id\)/);
    assert.match(SRC, /await unarchiveItem\(itemId\)/);
  });

  it("puts a confirm in front of the delete and nothing in front of the restore", () => {
    // Restore is reversible by archiving again; delete is not reversible by
    // anything, and this is the screen people arrive at having already made
    // one mistake.
    const restore = SRC.slice(SRC.indexOf("const handleRestore"), SRC.indexOf("const handleDelete"));
    assert.ok(!restore.includes("confirmDialog"), "a recovery path behind a confirm is a second obstacle");
    const del = SRC.slice(SRC.indexOf("const handleDelete"));
    assert.match(del, /const ok = await confirmDialog\(\{/);
    assert.match(del, /destructive: true,/);
    assert.match(del, /if \(!ok\) return;/);
  });

  it("offers no way to empty the whole archive at once", () => {
    // A screen whose purpose is recovering from a mistake is the worst place
    // to put a one-tap way to make a larger one.
    assert.ok(!SRC.includes("deleteItems"));
    assert.ok(!/deleteAll|clearArchive|emptyArchive/i.test(SRC));
  });

  it("says the restore happened out loud", () => {
    // The row leaves the list when it is restored, so a screen-reader user's
    // only other evidence is a list one shorter — which is what a delete looks
    // like too.
    assert.match(SRC, /announceMessage\(t\("archiveRestored"\)\)/);
  });

  it("names both row controls with the item's title", () => {
    // Ten identical "Restore" buttons in a column are ten identical
    // announcements without this.
    assert.match(SRC, /t\("archiveRestoreA11y", \{ title: item\.title \}\)/);
    assert.match(SRC, /t\("archiveDeleteA11y", \{ title: item\.title \}\)/);
  });

  it("says a disabled control is disabled rather than only looking it", () => {
    assert.match(SRC, /accessibilityState=\{\{ disabled: busy \}\}/);
  });

  it("renders an empty state rather than a blank screen", () => {
    // The route is reachable directly, and a banner that disappears when the
    // archive empties would otherwise leave a page with a heading and nothing
    // under it.
    assert.match(SRC, /archivedItems\.length === 0 \? \(/);
    assert.match(SRC, /<EmptyState/);
  });

  it("mounts a window rather than every row it is handed", () => {
    // Six rounds carried this as a suggestion and the bulk archive is what
    // made it real: one gesture can now put thirty rows on a screen that
    // mounts a remote cover photo per row, on a list nothing prunes.
    assert.match(SRC, /const \{ visibleItems, remaining, loadMore \} = useChunkedList\(archivedItems\);/);
    assert.match(SRC, /\{visibleItems\.map\(\(item\) => \{/);
    assert.ok(!SRC.includes("archivedItems.map("), "the unwindowed map is back");
  });

  it("grows the window through the shared button", () => {
    // `<LoadMoreButton>` renders nothing at `remaining <= 0`, so the gate and
    // the label are one number rather than a `hasMore` asked beside a
    // subtraction — see the component's own header.
    assert.match(SRC, /<LoadMoreButton remaining=\{remaining\} onPress=\{loadMore\} \/>/);
    assert.ok(!SRC.includes("hasMore"), "a second spelling of remaining > 0");
  });

  it("takes the window off the provider's memoised array", () => {
    // `useChunkedList` resets its window when the array's REFERENCE changes,
    // so a caller that filtered inline would snap back to one page on every
    // render and make loadMore a no-op. `archivedItems` is memoised on
    // `localItems` alone, which is what makes this safe.
    const PROVIDER = stripComments(readRepoFile("lib/collections-context.tsx"));
    assert.match(PROVIDER, /const archivedItems = useMemo\(/);
    assert.ok(!SRC.includes(".filter(isArchived)"), "the screen must not re-derive the list");
  });

  it("prints the archive date as its ISO prefix", () => {
    // `acquiredAt` is stored and rendered as YYYY-MM-DD everywhere else; a
    // date that reads one way here and another on the item it came from is
    // worse than one that is unambiguous in every locale.
    assert.match(SRC, /\(item\.archivedAt \?\? ""\)\.slice\(0, 10\)/);
    assert.ok(!SRC.includes("toLocaleDateString"));
  });
});

describe("the route is reachable", () => {
  const SRC = stripComments(readRepoFile("app/index.tsx"));

  it("the home screen banners it", () => {
    assert.match(SRC, /href="\/archive"/);
    assert.match(SRC, /title=\{t\("archiveTitle"\)\}/);
  });

  it("only when there is something in it", () => {
    // An archive is a recovery path, not a feature to advertise: a permanent
    // row pointing at an empty screen is noise on the surface every session
    // starts on.
    assert.match(SRC, /\{archivedItems\.length > 0 \? \(\s*<DashboardBanner/);
  });

  it("reads the list from the context rather than re-filtering items", () => {
    assert.match(SRC, /^\s+archivedItems,$/m);
  });
});

describe("the archive copy is translated everywhere", () => {
  const SRC = readI18nSource();
  const KEYS = [
    "archiveTitle",
    "archiveSubtitle",
    "archiveHint",
    "archiveEmptyTitle",
    "archiveEmptyHint",
    "archiveRestore",
    "archiveRestored",
    "archiveDeleted",
    "archiveArchivedOn",
    "archiveRestoreA11y",
    "archiveDeleteA11y",
  ] as const;

  for (const key of KEYS) {
    it(`${key} is declared by every locale`, () => {
      assertDeclaredInEveryLocale(SRC, key);
    });
  }

  it("every one says it with that locale's own words", () => {
    for (const key of KEYS) {
      const values = [...localeValuesOf(SRC, key).values()];
      assert.equal(
        new Set(values).size,
        values.length,
        `two locales carry the identical value for '${key}'`,
      );
    }
  });

  it("the three parameterised ones actually read their param", () => {
    for (const [key, param] of [
      ["archiveArchivedOn", "date"],
      ["archiveRestoreA11y", "title"],
      ["archiveDeleteA11y", "title"],
    ] as const) {
      for (const [code, value] of localeValuesOf(SRC, key)) {
        assert.ok(
          value.includes(`params?.${param}`),
          `${code}'s '${key}' drops the ${param} — an a11y label naming no item is ten identical announcements`,
        );
      }
    }
  });
});
