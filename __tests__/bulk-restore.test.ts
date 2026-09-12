import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { LISTING_RULE_BY_ITEM_PATH } from "@/lib/marketplace-helpers";
import { stripComments } from "@/lib/strip-comments";

import { readI18nSource } from "./helpers/i18n-source-file";
import { assertDeclaredInEveryLocale, localeValuesOf } from "./helpers/i18n-locales";
import { readRepoFile } from "./helpers/repo-file";

/**
 * The way back out, at the scale the way in already had.
 *
 * `archiveItems` gave the bulk bar a reversible resolution and the archive
 * screen took its rows out one at a time, so one gesture put thirty items in
 * the trash and thirty taps got them back. That asymmetry is not a missing
 * convenience — the whole argument for archiving over deleting is that the
 * way back is cheap, and it stops being true exactly at the scale the other
 * direction was built for.
 *
 * The provider half is `unarchiveItems`. The screen half is a selection mode
 * on `app/archive.tsx`, and the interesting part of it is what it does NOT
 * pass to `<BulkBar>`: the screen has refused a "delete all" since it was
 * written, and that refusal now has to survive mounting a bar that can render
 * one. Which is why the bar's actions became optional rather than the archive
 * screen passing four handlers and disabling three.
 */

const PROVIDER = stripComments(readRepoFile("lib/collections-context.tsx"));
const SCREEN = stripComments(readRepoFile("app/archive.tsx"));
const BAR = stripComments(readRepoFile("components/bulk-bar.tsx"));

/** One handler's body, bounded by the next handler's head. */
const bodyOf = (name: string): string => {
  const start = PROVIDER.indexOf(`\n      ${name}: async`);
  assert.ok(start >= 0, `could not find '${name}' on the provider`);
  const next = PROVIDER.slice(start + 1).search(/\n {6}[a-zA-Z]+: (?:async )?\(/);
  return PROVIDER.slice(start, next >= 0 ? start + 1 + next : PROVIDER.length);
};

describe("unarchiveItems on the provider", () => {
  it("exists alongside archiveItems, in both the type and the value", () => {
    assert.match(PROVIDER, /unarchiveItems: async \(itemIds\) => \{/);
    assert.match(PROVIDER, /unarchiveItems: \(itemIds: string\[\]\) => Promise<void>;/);
  });

  it("clears the flag with null and never with undefined", () => {
    // The bug the single-item path documents at length, at thirty times the
    // size: `updateRemoteItem` only writes a field whose key is PRESENT in
    // `updates`, so an `undefined` would clear thirty local flags, leave
    // thirty cloud rows archived, and let the next sync put the whole
    // selection back in the trash.
    const body = bodyOf("unarchiveItems");
    assert.match(body, /archivedAt: null/);
    assert.doesNotMatch(body, /archivedAt: undefined/);
    assert.match(body, /updateRemoteItem\(item\.id, \{ archivedAt: null \}\)/);
  });

  it("skips rows that are not archived", () => {
    // The mirror of `archiveItems` skipping the already-archived: an id that
    // is not in the trash has nothing to come back from, and syncing it would
    // write a field that already reads null.
    assert.match(bodyOf("unarchiveItems"), /idSet\.has\(item\.id\) && item\.archivedAt/);
  });

  it("resolves from localItems before the state write, like every other mutation", () => {
    assert.match(bodyOf("unarchiveItems"), /const restored = localItems\s*\.filter\(/);
  });

  it("returns early on an empty selection and on one that resolves to nothing", () => {
    const body = bodyOf("unarchiveItems");
    assert.match(body, /if \(itemIds\.length === 0\) return;/);
    assert.match(body, /if \(restored\.length === 0\) return;/);
  });

  it("syncs each restored row", () => {
    assert.match(bodyOf("unarchiveItems"), /restored\.forEach\(\(item\) =>/);
  });

  it("takes no clock, unlike the direction that sets a field", () => {
    // `archiveItems` stamps ONE timestamp for a whole selection so a single
    // act does not scatter across the top of the archive list. This one
    // clears a field, so there is nothing to stamp and no ordering to
    // protect — every row it touches leaves the list.
    assert.doesNotMatch(bodyOf("unarchiveItems"), /new Date\(\)/);
  });

  it("is bounded by the next handler, not by a name that contains it", () => {
    // The case that would have caught the slice bug this file's helper was
    // written for: "unarchiveItems: async" CONTAINS "archiveItems: async", so
    // an indexOf-based body for either one silently covers both.
    assert.ok(!bodyOf("archiveItems").includes("unarchiveItems"));
    assert.ok(!bodyOf("unarchiveItems").includes("deleteItems"));
  });

  it("is exempt from retiring listings, for the same reason the single path is", () => {
    const verdict = LISTING_RULE_BY_ITEM_PATH.unarchiveItems ?? "";
    assert.ok(verdict.startsWith("EXEMPT"), "an arrival that retires a listing withdraws an offer for no reason");
    assert.ok(verdict.length >= 60, "a verdict without an argument is the state moveItems was in for four rounds");
  });
});

describe("the archive screen's selection mode", () => {
  it("enters and leaves through the same two handlers the collection screen uses", () => {
    assert.match(SCREEN, /const enterSelectionMode = useCallback\(\(\) => \{/);
    assert.match(SCREEN, /const exitSelectionMode = useCallback\(\(\) => \{/);
    assert.match(SCREEN, /onPress=\{enterSelectionMode\}/);
  });

  it("offers the entry point only when there is something to select", () => {
    // A Select chip over an empty archive selects nothing, on the one screen
    // whose empty state is the good outcome.
    assert.match(SCREEN, /archivedItems\.length > 0 && !selectionMode \?/);
  });

  it("reads the count before the selection is cleared", () => {
    // `exitSelectionMode` empties `selectedIds`, and a count composed after
    // it reports zero items restored. The same ordering the bulk-archive
    // outcome needs, and the same way of getting it: a local read up front.
    const body = SCREEN.slice(SCREEN.indexOf("const performBulkRestore"), SCREEN.indexOf("const handleBulkRestore"));
    assert.ok(body.length > 0, "could not parse performBulkRestore");
    assert.ok(body.indexOf("const ids = Array.from(selectedIds)") < body.indexOf("await unarchiveItems(ids)"));
    assert.ok(body.indexOf('t("itemsRestored", { count: ids.length })') < body.indexOf("exitSelectionMode()"));
  });

  it("puts no confirm in front of the bulk restore", () => {
    // Nothing it does is destructive — every row goes back where it was, and
    // the way to undo it is the archive action that put it here. The single
    // restore takes no confirm either, and a bulk version inventing one would
    // be a stricter rule for the same act done thirty times.
    const body = SCREEN.slice(SCREEN.indexOf("const performBulkRestore"), SCREEN.indexOf("const handleBulkRestore"));
    assert.ok(!body.includes("confirmDialog"), "a recovery path behind a confirm is a second obstacle");
    assert.ok(!body.includes("Alert.alert"));
  });

  it("says the bulk restore happened out loud", () => {
    // Thirty rows leaving a list is what a bulk delete looks like too.
    assert.match(SCREEN, /announceMessage\(message\)/);
  });

  it("hands the bar Restore and Cancel and nothing else", () => {
    // The screen's oldest argument, now stated by omission: no bulk delete on
    // the screen people reach after a mistake. `<BulkBar>` can render one, so
    // the refusal has to be visible at the call site.
    const site = SCREEN.match(/<BulkBar[\s\S]*?\/>/)?.[0] ?? "";
    assert.ok(site.length > 0, "<BulkBar> call site not found");
    assert.match(site, /count=\{selectedIds\.size\}/);
    assert.match(site, /onRestore=\{handleBulkRestore\}/);
    assert.match(site, /onCancel=\{exitSelectionMode\}/);
    for (const forbidden of ["onDelete", "onArchive", "onMove"]) {
      assert.ok(!site.includes(forbidden), `the archive screen must not offer ${forbidden}`);
    }
  });

  it("still offers no way to empty the whole archive at once", () => {
    assert.ok(!SCREEN.includes("deleteItems"));
    assert.ok(!/deleteAll|clearArchive|emptyArchive/i.test(SCREEN));
  });

  it("hands the bar a stable reference rather than a fresh arrow", () => {
    // `<BulkBar>` is memoized; an inline `() => void performBulkRestore()`
    // would allocate a new prop every parent render and skip nothing.
    assert.match(SCREEN, /const handleBulkRestore = useCallback\(\(\) => \{\s*void performBulkRestore\(\);/);
  });

  it("makes a selected row a checkbox rather than a button", () => {
    // "button" announces the tap and says nothing about whether the row is in
    // the selection, which is the only state this mode has. Same call
    // `<SelectableItemRow>` makes on the collection screen.
    assert.match(SCREEN, /accessibilityRole="checkbox"/);
    assert.match(SCREEN, /accessibilityState=\{\{ checked: selected \}\}/);
  });

  it("keeps the selected row exactly as tall as the unselected one", () => {
    // `getItemLayout` promises every row is ROW_HEIGHT. A selection style
    // that added a border or padding would make that promise false for the
    // rows a user has touched — which reads as a scroll bug, and only for
    // them.
    const style = SCREEN.slice(SCREEN.indexOf("rowSelected: {"), SCREEN.indexOf("checkbox: {"));
    assert.ok(style.length > 0, "could not parse the rowSelected style");
    for (const growth of ["borderWidth", "padding", "height", "margin"]) {
      assert.ok(!style.includes(growth), `rowSelected changes '${growth}', so the fixed layout is a lie`);
    }
  });

  it("reserves scroll room under the floating bar", () => {
    assert.match(SCREEN, /selectionMode \? <View style=\{styles\.bulkBarSpacer\} \/> : null/);
  });

  it("tells the list the selection changed", () => {
    // `data={visibleItems}` keeps its reference across a toggle, so without
    // this virtualization has no reason to reconsider a row.
    assert.match(SCREEN, /extraData=\{selectedIds\}/);
  });
});

describe("the bulk bar renders the actions it is handed", () => {
  it("makes every action optional and Cancel required", () => {
    for (const action of ["onRestore", "onMove", "onArchive", "onDelete"]) {
      assert.match(BAR, new RegExp(`${action}\\?: \\(\\) => void;`), `${action} is still required`);
    }
    assert.match(BAR, /onCancel: \(\) => void;/);
  });

  it("guards each optional button on its own handler", () => {
    for (const action of ["onRestore", "onMove", "onArchive", "onDelete"]) {
      assert.match(BAR, new RegExp(`\\{${action} \\? \\(`), `${action} renders unconditionally`);
    }
  });

  it("labels the restore with the word the archive rows already use", () => {
    // The bar is doing the row's action to thirty rows; two words for one act
    // on one screen is the seam.
    assert.match(BAR, /t\("archiveRestore"\)/);
  });
});

describe("the restore outcome is translated everywhere", () => {
  const I18N = readI18nSource();

  it("itemsRestored is declared by every locale", () => {
    assertDeclaredInEveryLocale(I18N, "itemsRestored");
  });

  it("every locale actually reads the count", () => {
    for (const [code, value] of localeValuesOf(I18N, "itemsRestored")) {
      assert.ok(value.includes("params?.count"), `${code}'s 'itemsRestored' drops the count`);
    }
  });

  it("it is a different sentence from the archive outcome in every locale", () => {
    // The two toasts report opposite acts on the same screen family, and a
    // locale that reused one would tell somebody their thirty restored items
    // had been archived.
    for (const [code, restored] of localeValuesOf(I18N, "itemsRestored")) {
      assert.notEqual(
        restored,
        localeValuesOf(I18N, "itemsArchived").get(code),
        `${code} uses one sentence for both directions`,
      );
    }
  });
});
