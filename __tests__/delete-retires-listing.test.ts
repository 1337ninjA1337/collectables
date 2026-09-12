import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { stripComments } from "@/lib/strip-comments";

import { readI18nSource } from "./helpers/i18n-source-file";
import { assertDeclaredInEveryLocale, localeValuesOf } from "./helpers/i18n-locales";
import { readRepoFile } from "./helpers/repo-file";

/**
 * Deleting an item takes its open listing down too.
 *
 * The archive round fixed one half of this and left the worse half standing:
 * an open listing is a standing offer to strangers, it lives on every buyer's
 * device, and nothing the seller does to the item reaches it. Archiving at
 * least left a row somebody could restore and look at; deleting removes it
 * from storage entirely, so the buyer who claims the surviving listing gets a
 * purchase pointing at nothing the seller can even open.
 *
 * The rule is the same one — `isOpenListing` — and that is why it stopped
 * being called `shouldRetireListingOnArchive` when this landed. What the two
 * callers do NOT share is the warning: an archive is reversible and asks about
 * the listing it is about to withdraw; a delete is reversible by nothing, so
 * its existing confirm gains a sentence rather than a second dialog.
 */

const SRC = stripComments(readRepoFile("app/item/[id].tsx"));

describe("the delete path", () => {
  const commit = SRC.slice(
    SRC.indexOf("async function confirmAndDeleteItem"),
    SRC.indexOf("function openListingSheet"),
  );

  it("parsed the committing function (guards the assertions below)", () => {
    assert.ok(commit.length > 0);
  });

  it("asks the shared rule rather than reading soldAt itself", () => {
    assert.match(commit, /if \(isOpenListing\(existingListing\) && existingListing\) \{/);
    assert.ok(!commit.includes("soldAt"));
  });

  it("removes the listing before it deletes the item", () => {
    const remove = commit.indexOf("removeListing(existingListing.id)");
    const del = commit.indexOf("await deleteItem(activeItem.id)");
    assert.ok(remove > 0 && del > 0, "could not find both calls");
    assert.ok(remove < del, "an item deleted first is one whose listing removal can be lost");
  });

  it("still navigates away afterwards", () => {
    // The screen is about an item that no longer exists by this point; the
    // realistic slip in adding a branch above the delete is to return early
    // out of the whole function.
    assert.match(commit, /router\.replace\(collection \? `\/collection\/\$\{collection\.id\}` : "\/"\)/);
  });

  it("leaves a sold listing alone", () => {
    // `isOpenListing` is the only gate, and it answers false for a sold row —
    // a delete does not un-sell a thing that was sold, and the buyer's
    // purchase list, the transfer log and "recently sold" all read that
    // record. Asserted on the helper's own rule rather than restated here.
    const HELPERS = stripComments(readRepoFile("lib/marketplace-helpers.ts"));
    assert.match(HELPERS, /export function isOpenListing\([\s\S]{0,160}?return !listing\.soldAt;/);
  });
});

describe("the delete confirm", () => {
  const handler = SRC.slice(SRC.indexOf("function handleDelete"), SRC.indexOf("if (editing)"));

  it("parsed the handler (guards the assertions below)", () => {
    assert.ok(handler.length > 0);
  });

  it("says the listing goes too, but only when there is one to lose", () => {
    // A confirm naming only the item would be describing half of what the
    // button does, on the one action in this family nothing can undo — and a
    // confirm that mentioned a listing for every item would be noise on the
    // overwhelming majority that have none.
    assert.match(
      handler,
      /const body = isOpenListing\(existingListing\)\s*\?\s*`\$\{t\("deleteItemText"\)\} \$\{t\("deleteItemListedText"\)\}`\s*:\s*t\("deleteItemText"\);/,
    );
  });

  it("uses that body on both platforms", () => {
    // The web branch builds its own string from title + body and the native
    // branch passes body to Alert.alert — the realistic slip is to change one
    // and leave the other saying less.
    assert.match(handler, /const message = `\$\{t\("deleteItemTitle"\)\} \$\{body\}`;/);
    assert.match(handler, /Alert\.alert\(t\("deleteItemTitle"\), body, \[/);
    assert.ok(!handler.includes('Alert.alert(t("deleteItemTitle"), t("deleteItemText")'));
  });

  it("keeps the destructive styling and the cancel", () => {
    assert.match(handler, /style: "destructive",/);
    assert.match(handler, /text: t\("cancel"\), style: "cancel"/);
  });
});

describe("deleteItemListedText is translated everywhere", () => {
  const I18N = readI18nSource();

  it("is declared by every locale", () => {
    assertDeclaredInEveryLocale(I18N, "deleteItemListedText");
  });

  it("each locale writes its own words", () => {
    const values = [...localeValuesOf(I18N, "deleteItemListedText").values()];
    assert.ok(values.length > 0);
    assert.equal(new Set(values).size, values.length, "two locales share the string");
  });

  it("reads as a second sentence rather than a replacement", () => {
    // It is appended to `deleteItemText`, so it has to stand after it: a
    // string starting lowercase or repeating the first sentence's subject
    // would read as a fragment in the one dialog that must be read.
    for (const [code, value] of localeValuesOf(I18N, "deleteItemListedText")) {
      const first = value.replace(/^"/, "").trimStart()[0] ?? "";
      assert.equal(first, first.toUpperCase(), `${code}'s sentence does not start a sentence`);
      assert.notEqual(
        value,
        localeValuesOf(I18N, "deleteItemText").get(code),
        `${code} repeats deleteItemText`,
      );
    }
  });
});
