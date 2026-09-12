import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isArchived } from "@/lib/collections-helpers";
import { stripComments } from "@/lib/strip-comments";

import { readI18nSource } from "./helpers/i18n-source-file";
import { assertDeclaredInEveryLocale, localeValuesOf } from "./helpers/i18n-locales";
import { readRepoFile } from "./helpers/repo-file";

/**
 * Archiving from the screen the item is actually on, and saying so when it is
 * already archived.
 *
 * Two holes the archive rounds left, both on `app/item/[id].tsx`:
 *
 * `archiveItem` had exactly ONE caller, the sold-listing prompt, so the only
 * route into the archive was selling something through the marketplace. A
 * collector who wanted to retire an item they still own — broken, loaned,
 * lent to a show — could only delete it, and delete is the one action in this
 * family that nothing can undo.
 *
 * And an archived item rendered here exactly like a live one: no banner, no
 * restore, nothing saying why it had disappeared from every list. The deep
 * link and the marketplace transfer log both land on this screen, which makes
 * it the place somebody most often meets an archived row without having gone
 * looking for one.
 */

const SRC = stripComments(readRepoFile("app/item/[id].tsx"));

describe("the archive action", () => {
  it("reads both halves of the pair from the context", () => {
    assert.match(SRC, /archiveItem, unarchiveItem,/);
  });

  it("is offered to the owner of a live item", () => {
    assert.match(SRC, /\{isOwner && !isArchived\(activeItem\) \? \(/);
    assert.match(SRC, /onPress=\{handleArchive\}/);
    assert.match(SRC, /t\("archiveAction"\)/);
  });

  it("disappears once the item is archived, so it cannot be archived twice", () => {
    // A second archive would restamp `archivedAt` and move the row to the top
    // of a list sorted by it, which is a confusing no-op rather than a
    // destructive one — and the button beside a banner saying "this is
    // archived" reads as a contradiction either way.
    const action = SRC.slice(SRC.indexOf("handleArchive}"), SRC.indexOf("handleDelete}"));
    assert.ok(action.length > 0);
    assert.match(SRC, /!isArchived\(activeItem\)/);
  });

  it("takes no confirm on an unlisted item, and carries an undo instead", () => {
    // Archiving is reversible in two places (this screen's banner and the
    // archive screen), so a confirm would be an obstacle in front of a
    // reversible action. The undo covers the tap that was a mistake — the
    // same shape the sold-listing prompt uses.
    //
    // The LISTED branch is the exception and came later: archiving an item
    // that is on the marketplace withdraws something other people can see,
    // and `addListing` mints a new id so it cannot be put back. That branch
    // asks first and offers no undo — see `archive-retires-listing.test.ts`.
    // This case is about the ordinary one, so it reads the ordinary branch
    // rather than the whole handler.
    const handler = SRC.slice(SRC.indexOf("function handleArchive"), SRC.indexOf("function handleRestore"));
    const plain = handler.slice(handler.indexOf("void archiveItem(archivedId).then"));
    assert.ok(plain.length > 0, "could not parse the unlisted branch");
    assert.ok(!plain.includes("confirmDialog"));
    assert.ok(!plain.includes("Alert.alert"));
    assert.match(plain, /label: t\("undo"\)/);
    assert.match(plain, /void unarchiveItem\(archivedId\)/);
  });

  it("captures the id before the await", () => {
    // `activeItem` is recomputed from `getItemById` on every render and the
    // row leaves that list the moment it is archived, so an undo closing over
    // the object rather than the id would be reading a value that has moved.
    assert.match(SRC, /const archivedId = activeItem\.id;/);
    assert.match(SRC, /const restoredId = activeItem\.id;/);
  });

  it("leaves delete exactly as it was, behind its confirm", () => {
    assert.match(SRC, /function handleDelete\(\) \{/);
    assert.match(SRC, /Alert\.alert\(t\("deleteItemTitle"\), t\("deleteItemText"\)/);
  });
});

describe("the archived banner", () => {
  it("renders when the item is archived and not otherwise", () => {
    assert.match(SRC, /\{isArchived\(activeItem\) \? \(\s*<View style=\{styles\.archivedBanner\}>/);
  });

  it("says what archived means rather than only that it is", () => {
    // "Archived" alone answers none of the three questions somebody arriving
    // by deep link has: where did it go, is it gone, can I get it back.
    assert.match(SRC, /t\("archiveBannerTitle"\)/);
    assert.match(SRC, /t\("archiveBannerHint"\)/);
  });

  it("offers Restore to the owner and to nobody else", () => {
    // `unarchiveItem` resolves from `localItems` and returns early for a row
    // it does not hold, so a non-owner's press would be a button that does
    // nothing — worse than no button.
    const banner = SRC.slice(SRC.indexOf("styles.archivedBanner"), SRC.indexOf("{activeItem.description"));
    assert.match(banner, /\{isOwner \? \(/);
    assert.match(banner, /onPress=\{handleRestore\}/);
    assert.match(banner, /t\("archiveRestore"\)/);
  });

  it("says the restore happened out loud", () => {
    // The banner disappears when the item is restored, and a banner going
    // away is not a sentence.
    assert.match(SRC, /announceMessage\(t\("archiveRestored"\)\)/);
  });
});

describe("isArchived is the one question asked", () => {
  it("the screen imports the shared predicate rather than reading the field", () => {
    assert.match(SRC, /import \{ isArchived \} from "@\/lib\/collections-helpers";/);
    assert.doesNotMatch(SRC, /activeItem\.archivedAt/);
  });

  it("answers a boolean for both shapes of absence", () => {
    // `archivedAt` is `string | null | undefined`, and a predicate that handed
    // back the timestamp is one somebody eventually compares with `===`.
    assert.equal(isArchived({ archivedAt: "2026-01-01T00:00:00.000Z" } as never), true);
    assert.equal(isArchived({ archivedAt: null } as never), false);
    assert.equal(isArchived({} as never), false);
  });
});

describe("the four new keys are translated everywhere", () => {
  const I18N = readI18nSource();
  const KEYS = ["archiveAction", "archiveActionDone", "archiveBannerTitle", "archiveBannerHint"] as const;

  for (const key of KEYS) {
    it(`${key} is declared by every locale`, () => {
      assertDeclaredInEveryLocale(I18N, key);
    });
  }

  it("each says it with that locale's own words", () => {
    for (const key of KEYS) {
      const values = [...localeValuesOf(I18N, key).values()];
      assert.equal(new Set(values).size, values.length, `two locales share a value for '${key}'`);
    }
  });

  it("the banner hint answers where it went and whether it can come back", () => {
    // The one key here whose whole job is reassurance: a hint that only
    // repeats the title leaves the reader exactly where they were.
    for (const [code, value] of localeValuesOf(I18N, "archiveBannerHint")) {
      const title = localeValuesOf(I18N, "archiveBannerTitle").get(code) ?? "";
      assert.notEqual(value, title, `${code}'s hint repeats its title`);
      assert.ok(value.length > title.length, `${code}'s hint says less than its title`);
    }
  });
});
