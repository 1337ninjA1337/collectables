import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { openListingsForItems } from "@/lib/marketplace-helpers";
import { stripComments } from "@/lib/strip-comments";
import type { MarketplaceListing } from "@/lib/types";

import { readI18nSource } from "./helpers/i18n-source-file";
import { assertDeclaredInEveryLocale, localeValuesOf } from "./helpers/i18n-locales";
import { readRepoFile } from "./helpers/repo-file";

/**
 * The bulk bar's reversible resolution, and the listings its irreversible one
 * had been ignoring.
 *
 * Two things, because they are one piece of machinery. `deleteItems` was the
 * bar's only way to make a selection go away, so somebody retiring thirty sold
 * items either deleted them — permanently — or opened thirty screens; and it
 * asked nothing about listings, so those thirty rows left storage while thirty
 * standing offers stayed on every buyer's device with the confirm saying
 * nothing. The single-item archive and the single-item delete had each been
 * fixed for exactly this; the bulk path is where nobody would have noticed.
 */

const listing = (over: Partial<MarketplaceListing> = {}): MarketplaceListing =>
  ({
    id: "l-1",
    itemId: "i-1",
    ownerUserId: "u-1",
    mode: "sell",
    askingPrice: 10,
    currency: "USD",
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  }) as MarketplaceListing;

describe("openListingsForItems", () => {
  it("finds the open listings inside a selection", () => {
    const found = openListingsForItems(
      [listing({ id: "a", itemId: "i-1" }), listing({ id: "b", itemId: "i-9" })],
      ["i-1"],
    );

    assert.deepEqual(found.map((l) => l.id), ["a"]);
  });

  it("skips a sold listing, which the single-item paths also leave standing", () => {
    const found = openListingsForItems(
      [listing({ id: "a", itemId: "i-1", soldAt: "2026-02-01T00:00:00.000Z" })],
      ["i-1"],
    );

    assert.deepEqual(found, []);
  });

  it("answers empty for a selection with nothing listed", () => {
    assert.deepEqual(openListingsForItems([listing({ itemId: "i-9" })], ["i-1", "i-2"]), []);
    assert.deepEqual(openListingsForItems([], ["i-1"]), []);
    assert.deepEqual(openListingsForItems([listing()], []), []);
  });

  it("walks the selection's order, not the listing store's", () => {
    // The warning a user reads and the removals that follow should walk the
    // selection in the order it was made.
    const found = openListingsForItems(
      [listing({ id: "a", itemId: "i-1" }), listing({ id: "b", itemId: "i-2" })],
      ["i-2", "i-1"],
    );

    assert.deepEqual(found.map((l) => l.id), ["b", "a"]);
  });

  it("returns one listing per item, first match winning", () => {
    // `findListingByItemId` answers the first match too, so a duplicate pair
    // has to resolve the same way here as it does on the item screen.
    const found = openListingsForItems(
      [listing({ id: "a", itemId: "i-1" }), listing({ id: "b", itemId: "i-1" })],
      ["i-1"],
    );

    assert.deepEqual(found.map((l) => l.id), ["a"]);
  });

  it("names an id once even when the selection repeats it", () => {
    const found = openListingsForItems([listing({ id: "a", itemId: "i-1" })], ["i-1"]);
    assert.equal(found.length, 1);
  });
});

describe("archiveItems on the provider", () => {
  const SRC = stripComments(readRepoFile("lib/collections-context.tsx"));

  it("exists alongside deleteItems", () => {
    assert.match(SRC, /archiveItems: async \(itemIds\) => \{/);
    assert.match(SRC, /archiveItems: \(itemIds: string\[\]\) => Promise<void>;/);
  });

  it("stamps ONE timestamp for the whole selection", () => {
    // The archive screen sorts on `archivedAt`, and thirty timestamps a
    // millisecond apart would scatter a single act across the top of that
    // list in an order nobody chose.
    const body = SRC.slice(SRC.indexOf("archiveItems: async"), SRC.indexOf("deleteItems: async"));
    assert.ok(body.length > 0, "could not parse archiveItems");
    const stamps = body.match(/new Date\(\)\.toISOString\(\)/g) ?? [];
    assert.equal(stamps.length, 1);
  });

  it("resolves from localItems before the state write, like every other mutation", () => {
    const body = SRC.slice(SRC.indexOf("archiveItems: async"), SRC.indexOf("deleteItems: async"));
    assert.match(body, /const archived = localItems\s*\.filter\(/);
    assert.doesNotMatch(body, /let \w+ = null;/);
  });

  it("skips rows that are already archived", () => {
    // Re-stamping one would move it to the top of the archive list for an act
    // that changed nothing.
    const body = SRC.slice(SRC.indexOf("archiveItems: async"), SRC.indexOf("deleteItems: async"));
    assert.match(body, /idSet\.has\(item\.id\) && !item\.archivedAt/);
  });

  it("returns early on an empty selection and on a selection that resolves to nothing", () => {
    const body = SRC.slice(SRC.indexOf("archiveItems: async"), SRC.indexOf("deleteItems: async"));
    assert.match(body, /if \(itemIds\.length === 0\) return;/);
    assert.match(body, /if \(archived\.length === 0\) return;/);
  });

  it("syncs each archived row", () => {
    const body = SRC.slice(SRC.indexOf("archiveItems: async"), SRC.indexOf("deleteItems: async"));
    assert.match(body, /syncItem\(item, \(\) => updateRemoteItem\(item\.id, \{ archivedAt \}\)\)/);
  });
});

describe("the bulk bar", () => {
  const SRC = stripComments(readRepoFile("components/bulk-bar.tsx"));

  it("offers Archive between Move and Delete", () => {
    const move = SRC.indexOf("onPress={onMove}");
    const archive = SRC.indexOf("onPress={onArchive}");
    const del = SRC.indexOf("onPress={onDelete}");
    assert.ok(move > 0 && archive > 0 && del > 0, "one of the three is missing");
    assert.ok(move < archive && archive < del, "the reversible action must not sit past the permanent one");
  });

  it("gives it the neutral treatment, not the danger one", () => {
    // Archiving is reversible; styling it like Delete would say otherwise.
    const button = SRC.slice(SRC.indexOf("onPress={onArchive}") - 400, SRC.indexOf("onPress={onArchive}"));
    assert.ok(!button.includes("bulkBarButtonDanger"));
  });

  it("disables it on an empty selection and says so", () => {
    const button = SRC.slice(SRC.indexOf("onPress={onArchive}") - 400, SRC.indexOf("onPress={onArchive}"));
    assert.match(button, /disabled=\{empty\}/);
    assert.match(button, /accessibilityState=\{\{ disabled: empty \}\}/);
  });
});

describe("the collection screen's bulk resolutions", () => {
  const SRC = stripComments(readRepoFile("app/collection/[id].tsx"));

  it("computes the selection's open listings once, for both", () => {
    assert.match(
      SRC,
      /const selectedOpenListings = useMemo\(\s*\(\) => openListingsForItems\(myListings, Array\.from\(selectedIds\)\),/,
    );
  });

  it("retires them before the delete and before the archive", () => {
    // An item removed first is one whose listing removal can be lost — the
    // same ordering the two single-item paths hold.
    const del = SRC.slice(SRC.indexOf("const performBulkDelete"), SRC.indexOf("const handleBulkDelete"));
    assert.ok(del.indexOf("retireSelectedListings()") < del.indexOf("await deleteItems(ids)"));
    const arc = SRC.slice(SRC.indexOf("const performBulkArchive"), SRC.indexOf("const handleBulkArchive"));
    assert.ok(arc.indexOf("retireSelectedListings()") < arc.indexOf("await archiveItems(ids)"));
  });

  it("warns about the listings in both confirms, and only when there are some", () => {
    assert.match(SRC, /const message = `\$\{t\("deleteItemsText"\)\}\$\{listedWarning\(\)\}`;/);
    assert.match(SRC, /const message = `\$\{t\("archiveItemsText"\)\}\$\{listedWarning\(\)\}`;/);
    assert.match(SRC, /selectedOpenListings\.length > 0\s*\?\s*` \$\{t\("bulkListedWarning", \{ count: selectedOpenListings\.length \}\)\}`\s*:\s*""/);
  });

  const archiveHandler = (() => {
    const start = SRC.indexOf("const handleBulkArchive");
    const end = SRC.indexOf("performBulkArchive]);", start);
    return start >= 0 && end > start ? SRC.slice(start, end) : "";
  })();

  it("parsed the bulk-archive handler (guards the two cases below)", () => {
    assert.ok(archiveHandler.length > 0);
  });

  it("asks before a bulk archive only when a listing would go with it", () => {
    // The single-item action takes no confirm for an unlisted item —
    // archiving is reversible from the banner and from the archive screen —
    // and the bulk version keeps that rule rather than inventing a stricter
    // one for the same act done thirty times. The listing removal is what is
    // not reversible, and that is exactly when it asks.
    assert.match(archiveHandler, /if \(selectedOpenListings\.length === 0\) \{\s*void performBulkArchive\(\);\s*return;\s*\}/);
  });

  it("does not style the archive confirm as destructive", () => {
    // Bounded by the handler's own dep array rather than by the next JSX
    // tag: a slice that ran to `<BulkBar>` swept up the DELETE confirm, whose
    // destructive styling is correct, and passed for the wrong reason.
    assert.match(archiveHandler, /\{ text: t\("archiveAction"\), onPress: \(\) => void performBulkArchive\(\) \}/);
    assert.ok(!archiveHandler.includes('style: "destructive"'));
  });

  it("passes the handler to the bar", () => {
    assert.match(SRC, /onArchive=\{handleBulkArchive\}/);
  });
});

describe("the four bulk strings are translated everywhere", () => {
  const I18N = readI18nSource();
  const KEYS = ["itemsArchived", "archiveItemsTitle", "archiveItemsText", "bulkListedWarning"] as const;

  for (const key of KEYS) {
    it(`${key} is declared by every locale`, () => {
      assertDeclaredInEveryLocale(I18N, key);
    });
  }

  it("the three counted ones actually read the count", () => {
    for (const key of ["itemsArchived", "archiveItemsTitle", "bulkListedWarning"] as const) {
      for (const [code, value] of localeValuesOf(I18N, key)) {
        assert.ok(value.includes("params?.count"), `${code}'s '${key}' drops the count`);
      }
    }
  });

  it("the Slavic locales decline the counted nouns rather than pinning one form", () => {
    // "3 предмета" and "5 предметов" are different words, and a bulk confirm
    // is where a wrong one is read most carefully.
    for (const code of ["ru", "be", "pl"]) {
      const value = localeValuesOf(I18N, "archiveItemsTitle").get(code) ?? "";
      assert.match(value, /slavicPlural\(/, `${code} pins one noun form in a counted title`);
    }
  });

  it("each locale writes its own words", () => {
    for (const key of KEYS) {
      const values = [...localeValuesOf(I18N, key).values()];
      assert.equal(new Set(values).size, values.length, `two locales share a value for '${key}'`);
    }
  });
});
