import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  catalogueSearchNeedle,
  collectionMatchesSearch,
  itemMatchesSearch,
  type SearchableCollection,
  type SearchableItem,
} from "@/lib/catalogue-search";

import { assertDeclaredInEveryLocale, localeStrings } from "./helpers/i18n-locales";
import { readI18nSource } from "./helpers/i18n-source-file";
import { readRepoFile } from "./helpers/repo-file";

const COLLECTION: SearchableCollection = {
  name: "Vinyl Records",
  description: "Pressings bought at Camden market",
};

const ITEM: SearchableItem = {
  title: "Kind of Blue",
  description: "First UK pressing, mono",
  acquiredFrom: "Camden market",
};

describe("catalogueSearchNeedle", () => {
  it("trims and lower-cases, which is the line both call sites wrote inline", () => {
    assert.equal(catalogueSearchNeedle("  Vinyl  "), "vinyl");
  });

  it("is empty for a whitespace-only query, which is the callers' cue to skip", () => {
    assert.equal(catalogueSearchNeedle("   "), "");
  });

  it("is idempotent, so a caller that needles twice gets the same answer", () => {
    // `components/search-overlay.tsx` passes its already-needled `q` on to
    // `profileSearchNeedle` for the people half; the same string reaching
    // here twice must not change meaning.
    const once = catalogueSearchNeedle(" Kind of Blue ");
    assert.equal(catalogueSearchNeedle(once), once);
  });

  it("keeps PostgREST metacharacters, because this half has no server", () => {
    // The deliberate difference from `sanitizeProfileSearchQuery`. Collections
    // and items are AsyncStorage-only, so a `%` or a `(` is a character
    // somebody typed because it is in the title they are looking for.
    assert.equal(catalogueSearchNeedle("Greatest Hits (1972)"), "greatest hits (1972)");
    assert.equal(catalogueSearchNeedle("50%"), "50%");
  });
});

describe("collectionMatchesSearch", () => {
  it("matches the name, case-insensitively", () => {
    assert.ok(collectionMatchesSearch(COLLECTION, catalogueSearchNeedle("VINYL")));
  });

  it("matches the description, which no row prints", () => {
    assert.ok(collectionMatchesSearch(COLLECTION, catalogueSearchNeedle("camden")));
  });

  it("does not match text in neither field", () => {
    assert.equal(collectionMatchesSearch(COLLECTION, catalogueSearchNeedle("stamps")), false);
  });

  it("matches everything on an empty needle", () => {
    assert.ok(collectionMatchesSearch(COLLECTION, ""));
    assert.ok(collectionMatchesSearch({ name: "", description: "" }, ""));
  });

  it("matches a substring mid-word, like the predicate it replaced", () => {
    assert.ok(collectionMatchesSearch(COLLECTION, catalogueSearchNeedle("ecord")));
  });
});

describe("itemMatchesSearch", () => {
  it("matches the title", () => {
    assert.ok(itemMatchesSearch(ITEM, catalogueSearchNeedle("kind of")));
  });

  it("matches the description", () => {
    assert.ok(itemMatchesSearch(ITEM, catalogueSearchNeedle("mono")));
  });

  it("matches acquiredFrom, which is where 'where did I get this' lives", () => {
    assert.ok(itemMatchesSearch(ITEM, catalogueSearchNeedle("Camden")));
  });

  it("does not match text in none of the three fields", () => {
    assert.equal(itemMatchesSearch(ITEM, catalogueSearchNeedle("trumpet")), false);
  });

  it("reads one field more than the collection predicate, and that is the only difference", () => {
    // Both are `includes` over a lower-cased field list; the lists are the
    // content of the module. A collection has no `acquiredFrom`, so a needle
    // that only that field answers is the one thing the two cannot agree on.
    const needle = catalogueSearchNeedle("camden market");
    assert.ok(itemMatchesSearch(ITEM, needle));
    assert.ok(
      collectionMatchesSearch(COLLECTION, needle),
      "this collection's description happens to carry it too",
    );
    assert.equal(
      itemMatchesSearch({ title: "x", description: "y", acquiredFrom: "Camden market" }, needle),
      true,
    );
    assert.equal(
      collectionMatchesSearch({ name: "x", description: "y" }, needle),
      false,
      "a collection has no acquiredFrom to answer with",
    );
  });
});

describe("the two readers, which used to be two copies", () => {
  // The claim the module exists for, made the way this repository's `lint:*`
  // guards make theirs: by reading the source. A call site that grows its own
  // `name.toLowerCase().includes(q)` back still compiles and still passes
  // every behavioural case above — it just stops being the same question.
  const READERS = ["components/search-overlay.tsx", "app/create.tsx"];

  it("both go through the shared predicate", () => {
    for (const file of READERS) {
      assert.match(
        readRepoFile(file),
        /collectionMatchesSearch\(/,
        `${file} does not use the shared collection predicate`,
      );
    }
  });

  it("neither carries a hand-rolled field comparison any more", () => {
    for (const file of READERS) {
      const source = readRepoFile(file);
      for (const field of ["name", "description", "title", "acquiredFrom"]) {
        assert.doesNotMatch(
          source,
          new RegExp(`\\.${field}\\.toLowerCase\\(\\)\\.includes\\(`),
          `${file} filters on ${field} inline instead of through lib/catalogue-search.ts`,
        );
      }
    }
  });

  it("neither spells the needle inline", () => {
    for (const file of READERS) {
      assert.doesNotMatch(
        readRepoFile(file),
        /query\.trim\(\)\.toLowerCase\(\)/,
        `${file} builds the needle itself`,
      );
    }
  });

  it("the overlay asks the item predicate too", () => {
    assert.match(readRepoFile("components/search-overlay.tsx"), /itemMatchesSearch\(/);
  });

  it("the module imports nothing, so a suite can run it without React Native", () => {
    // The reason the rule lives in `lib/` and not on the screen, same as
    // `lib/profile-search.ts` and `lib/profile-draft-sync.ts`.
    assert.doesNotMatch(readRepoFile("lib/catalogue-search.ts"), /^import /m);
  });
});

describe("the per-collection filter sheet, which asks a DIFFERENT question", () => {
  it("still matches title alone, under copy that says so", () => {
    // `applyItemFilters`' `query` is the filter sheet's field and its six
    // locales say "Search items by title". Pulling it into
    // `itemMatchesSearch` would silently widen a promise the UI makes
    // narrowly — the opposite of the profile-ID bug, and the labels are why.
    assert.match(readRepoFile("lib/item-filters.ts"), /item\.title\.toLowerCase\(\)\.includes\(queryNeedle\)/);
    assert.match(readRepoFile("lib/i18n/en.ts"), /searchInCollectionPlaceholder: "Search items by title"/);
  });
});

describe("the collection picker's own label, which promised two other sections", () => {
  // `app/create.tsx`'s sheet lists the user's collections and nothing else,
  // and its visible placeholder was `searchPlaceholder` — the GLOBAL box's
  // copy, "Search items, collections, people..." in all six locales. One
  // field with two labels that disagreed, the invisible one right.
  const I18N = readI18nSource();

  it("uses its own placeholder key, not the global box's", () => {
    const source = readRepoFile("app/create.tsx");
    assert.match(source, /placeholder=\{t\("searchCollectionsPlaceholder"\)\}/);
    assert.doesNotMatch(
      source,
      /placeholder=\{t\("searchPlaceholder"\)\}/,
      "the picker is back on the global search box's copy",
    );
  });

  it("is the global box alone that keeps the three-section placeholder", () => {
    assert.match(
      readRepoFile("components/search-overlay.tsx"),
      /placeholder=\{t\("searchPlaceholder"\)\}/,
    );
  });

  it("has the new key in every locale, and nobody left it in English", () => {
    assertDeclaredInEveryLocale(I18N, "searchCollectionsPlaceholder");
    const strings = localeStrings(I18N, "searchCollectionsPlaceholder");
    const english = strings.get("en");
    assert.equal(english, "Search collections");
    for (const [code, value] of strings) {
      if (code === "en") continue;
      assert.notEqual(value, english, `${code} carries the English string verbatim`);
    }
  });

  it("names both fields in the a11y label, because the filter reads both", () => {
    // It said "by name" while `collectionMatchesSearch` also reads the
    // description — the smaller half of the same mismatch.
    assert.match(
      readRepoFile("lib/i18n/en.ts"),
      /collectionPickerSearchA11y: "Search your collections by name or description"/,
    );
  });
});
