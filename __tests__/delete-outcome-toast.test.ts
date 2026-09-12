import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { stripComments } from "@/lib/strip-comments";

import { readI18nSource } from "./helpers/i18n-source-file";
import { assertDeclaredInEveryLocale, localeValuesOf } from "./helpers/i18n-locales";
import { readRepoFile } from "./helpers/repo-file";

/**
 * Deleting one item said nothing at all.
 *
 * Every other resolution in this family reports itself: the bulk delete counts
 * rows and the listings that went with them, the bulk archive does the same,
 * the single-item archive composes both halves, and the archive screen's own
 * delete says `archiveDeleted`. The item screen's delete removed the listing,
 * removed the item, and navigated away — so a seller who deleted a listed item
 * withdrew a standing offer from every buyer's device and was told nothing, on
 * the one action in the family nothing can undo.
 *
 * The confirm before it DOES say so (`deleteItemListedText`), which is what
 * made the silence afterwards easy to miss: the sentence a user reads is a
 * warning about what will happen, and nothing confirmed that it did.
 */

const SRC = stripComments(readRepoFile("app/item/[id].tsx"));
const commit = SRC.slice(
  SRC.indexOf("async function confirmAndDeleteItem"),
  SRC.indexOf("function openListingSheet"),
);

describe("the delete outcome", () => {
  it("parsed the committing function (guards the assertions below)", () => {
    assert.ok(commit.length > 0);
  });

  it("says the item went", () => {
    assert.match(commit, /composeOutcome\(\s*t\("archiveDeleted"\),/);
  });

  it("reuses the sentence the archive screen already says for this act", () => {
    // `archiveDeleted` is "Item deleted" in all six locales and it is the
    // permanent delete of one item — the same act, from the other screen. A
    // second key would have been that sentence translated twice.
    const ARCHIVE = stripComments(readRepoFile("app/archive.tsx"));
    assert.match(ARCHIVE, /toast\.success\(t\("archiveDeleted"\)\)/);
    assertDeclaredInEveryLocale(readI18nSource(), "archiveDeleted");
  });

  it("adds the listing clause only when there was a listing to lose", () => {
    assert.match(
      commit,
      /retiring \? t\("bulkListingsRemoved", \{ count: 1 \}\) : null,/,
    );
  });

  it("composes rather than joining by hand", () => {
    // The third caller of the shared composer, and the reason it takes a
    // nullable clause: the unlisted delete is the common case and it must not
    // trail a separator.
    assert.match(SRC, /import \{ composeOutcome \} from "@\/lib\/outcome-message";/);
    assert.ok(!commit.includes(" · "), "the delete path punctuates by hand");
  });

  it("reads the outcome before anything is removed", () => {
    // `existingListing` is recomputed from the marketplace store on every
    // render and `activeItem` from `getItemById`; both stop describing
    // anything two lines below. Composing after the removal would ask a store
    // that has already forgotten.
    const composed = commit.indexOf("const outcome = composeOutcome");
    const removed = commit.indexOf("removeListing(existingListing.id)");
    const deleted = commit.indexOf("await deleteItem(activeItem.id)");
    assert.ok(composed > 0 && removed > 0 && deleted > 0, "could not find all three");
    assert.ok(composed < removed, "the outcome is composed after the listing is gone");
    assert.ok(composed < deleted, "the outcome is composed after the item is gone");
  });

  it("shows it after the delete resolves and before the navigation", () => {
    // After, because a delete that threw should not claim to have happened;
    // before the replace, because queueing the message while this screen is
    // still mounted is the ordering that does not depend on where the toast
    // provider sits.
    const deleted = commit.indexOf("await deleteItem(activeItem.id)");
    const shown = commit.indexOf("toast.success(outcome)");
    const gone = commit.indexOf("router.replace(");
    assert.ok(shown > deleted, "the toast must not announce a delete that has not happened");
    assert.ok(shown < gone, "the toast is queued before the screen is replaced");
  });

  it("still navigates away afterwards", () => {
    // The realistic slip in adding lines above a `router.replace` is to return
    // early out of the whole function, leaving the screen on an item that no
    // longer exists.
    assert.match(commit, /router\.replace\(collection \? `\/collection\/\$\{collection\.id\}` : "\/"\)/);
  });

  it("the two halves are different sentences in every locale", () => {
    // One says the row is gone; the other says something other people could
    // see was withdrawn. A locale that wrote them the same way would report
    // the second outcome as a repetition of the first.
    const I18N = readI18nSource();
    const clauses = localeValuesOf(I18N, "bulkListingsRemoved");
    for (const [code, deleted] of localeValuesOf(I18N, "archiveDeleted")) {
      const clause = clauses.get(code) ?? "";
      assert.ok(clause.length > 0, `${code} declares no listing clause`);
      assert.notEqual(clause, deleted, `${code} says the same thing twice`);
    }
  });

  it("the confirm before it still warns, which is the other half of the pair", () => {
    // The warning and the outcome are different claims — "this will happen"
    // and "this happened" — and the round that added the first is why the
    // absence of the second was invisible.
    const handler = SRC.slice(SRC.indexOf("function handleDelete"), SRC.indexOf("if (editing)"));
    assert.match(handler, /t\("deleteItemListedText"\)/);
    assert.match(handler, /isOpenListing\(existingListing\)/);
  });
});
