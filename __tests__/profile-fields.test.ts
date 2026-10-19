import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PROFILE_FIELDS,
  profileFieldColumns,
  profileFieldNames,
  profileFieldSpellings,
} from "@/lib/profile-fields";
import { PROFILE_SEARCH_COLUMNS } from "@/lib/profile-search";
import { GUARDED_FIELDS } from "@/lib/check-profile-id-pii";

import { readRepoFile } from "./helpers/repo-file";

describe("PROFILE_FIELDS", () => {
  it("names each field exactly once, in both spellings", () => {
    // The premise every derivation below rests on: a duplicate row would make
    // a column searched twice in the `or=` list and guarded twice by the PII
    // scanner, which is a double finding rather than a wrong one — and so the
    // kind of thing that survives a long time unnoticed.
    const camel = PROFILE_FIELDS.map((field) => field.camel);
    const snake = PROFILE_FIELDS.map((field) => field.snake);
    assert.equal(new Set(camel).size, PROFILE_FIELDS.length);
    assert.equal(new Set(snake).size, PROFILE_FIELDS.length);
  });

  it("pairs the two spellings of one column", () => {
    // `displayName`/`display_name` is the only pair that actually differs, and
    // a row that mismatched them is exactly the defect this table exists to
    // make impossible: the camel half reaches the client predicate and the
    // snake half reaches the server filter, so a typo in one would be a
    // match that appears and disappears as the page scrolls.
    const toSnake = (camel: string) => camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    for (const field of PROFILE_FIELDS) {
      assert.equal(field.snake, toSnake(field.camel), `${field.camel} is not ${field.snake}`);
    }
  });

  it("holds the three fields the search box is about", () => {
    assert.deepEqual(
      PROFILE_FIELDS.map((field) => field.camel),
      ["username", "displayName", "publicId"],
    );
  });
});

describe("the lists derived from the table", () => {
  it("PROFILE_SEARCH_COLUMNS is the searchable snake columns, in table order", () => {
    // Order is load-bearing: `profilesSearchUrl` maps this list into the
    // `or=` clause list and three cases in `profiles-search.test.ts` read the
    // clause order out of the URL.
    assert.deepEqual([...PROFILE_SEARCH_COLUMNS], ["username", "display_name", "public_id"]);
    assert.deepEqual(
      [...PROFILE_SEARCH_COLUMNS],
      [...profileFieldColumns((field) => field.searchable)],
    );
  });

  it("GUARDED_FIELDS is both spellings of the piiGuarded fields", () => {
    // `lint:profile-id-pii` scans SOURCE, where the same column is written
    // `publicId:` in the app's objects and `public_id:` in a row literal.
    assert.deepEqual(
      [...GUARDED_FIELDS],
      [...profileFieldSpellings((field) => field.piiGuarded)],
    );
    for (const spelling of ["username", "publicId", "public_id"]) {
      assert.ok(
        (GUARDED_FIELDS as readonly string[]).includes(spelling),
        `${spelling} is the identifier the UI invites people to share`,
      );
    }
  });

  it("leaves displayName out of the guard, in both spellings", () => {
    // Deriving "ada" from `ada@example.com` is the intended behaviour here
    // (`resolveFallbackIdentity` does it), so a rule covering a display name
    // would fire on live, reviewed code — and a rule that fires on correct
    // code is one somebody exempts and then ignores. The row says so with a
    // `piiGuarded: false` rather than by not being written down.
    for (const spelling of ["displayName", "display_name"]) {
      assert.ok(!(GUARDED_FIELDS as readonly string[]).includes(spelling));
    }
    const displayName = PROFILE_FIELDS.find((field) => field.camel === "displayName");
    assert.equal(displayName?.piiGuarded, false);
  });

  it("UNIQUE search fields are the searchable ones with a unique index", () => {
    assert.deepEqual(
      [...profileFieldNames((field) => field.searchable && field.unique)],
      ["username", "publicId"],
    );
  });

  it("dedupes a field whose two spellings coincide", () => {
    // `username` spells the same both ways, so the guard's list is three
    // entries and not four. Without the dedupe a scanner would run the same
    // regex twice and report one site as two findings.
    const spellings = profileFieldSpellings((field) => field.camel === "username");
    assert.deepEqual([...spellings], ["username"]);
  });

  it("answers nothing for a predicate nothing matches", () => {
    // An empty derivation rather than the whole table, which is the shape a
    // mis-written filter would otherwise hide behind.
    assert.deepEqual([...profileFieldColumns(() => false)], []);
    assert.deepEqual([...profileFieldSpellings(() => false)], []);
  });
});

describe("the three lists are derived rather than restated", () => {
  // The point of the change. A list written out next to the table reads as a
  // derivation to anybody skimming, and drifts the first time a field is
  // added to the table only.
  it("lib/profile-search.ts derives both of its lists", () => {
    const module = readRepoFile("lib/profile-search.ts");
    assert.match(module, /PROFILE_SEARCH_COLUMNS[^=]*= profileFieldColumns\(/);
    assert.match(module, /UNIQUE_SEARCH_FIELDS[^=]*= profileFieldNames\(/);
    assert.ok(
      !/PROFILE_SEARCH_COLUMNS[^;]*"display_name"/.test(module),
      "the search columns are written out again",
    );
  });

  it("lib/check-profile-id-pii.ts derives its guarded list", () => {
    const module = readRepoFile("lib/check-profile-id-pii.ts");
    assert.match(module, /GUARDED_FIELDS = profileFieldSpellings\(/);
    assert.ok(
      !/GUARDED_FIELDS = \[/.test(module),
      "the guarded fields are written out again",
    );
  });

  it("SearchableProfile is keyed by the table rather than by three properties", () => {
    // The interface and the table used to be two statements of which fields
    // exist. A mapped type makes the compiler ask the question a contributor
    // adding a fourth row would otherwise be free to skip.
    const module = readRepoFile("lib/profile-search.ts");
    assert.match(module, /SearchableProfile = \{ readonly \[K in ProfileFieldCamel\]: string \}/);
  });
});

describe("the ranking's two field lists partition the searchable ones", () => {
  // `rankProfileMatch`'s prefix band is the union of the unique and the
  // ambiguous lists, so the partition IS the claim that band 2 looks at every
  // field `profileMatchesSearch` admits. A searchable field in neither list
  // would match and then rank 3 — a weak match rather than a missing row,
  // which is the reading that survives longest unnoticed.
  const unique = profileFieldNames((field) => field.searchable && field.unique);
  const ambiguous = profileFieldNames((field) => field.searchable && !field.unique);

  it("covers every searchable field between them", () => {
    assert.deepEqual(
      [...unique, ...ambiguous].sort(),
      [...profileFieldNames((field) => field.searchable)].sort(),
    );
  });

  it("overlaps nowhere", () => {
    for (const field of unique) assert.ok(!ambiguous.includes(field));
  });

  it("neither half is empty, so neither band is unreachable", () => {
    // Band 0 with no unique field, or band 1 with no ambiguous one, would be
    // dead code that still typechecks and still reads as a decision.
    assert.ok(unique.length > 0);
    assert.ok(ambiguous.length > 0);
  });

  it("the predicate and the ranking read the table, not three properties", () => {
    const module = readRepoFile("lib/profile-search.ts");
    assert.match(module, /SEARCHABLE_FIELDS[^=]*= profileFieldNames\(/);
    assert.match(module, /AMBIGUOUS_SEARCH_FIELDS[^=]*= profileFieldNames\(/);
    assert.ok(
      !/profile\.username\.toLowerCase\(\)/.test(module),
      "profileMatchesSearch enumerates its fields by hand again",
    );
  });
});
