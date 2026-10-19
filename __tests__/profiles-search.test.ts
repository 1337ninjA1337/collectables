import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PROFILE_SEARCH_COLUMNS,
  mergeProfileMatches,
  profileMatchesSearch,
  profileSearchNeedle,
  profileSearchUnion,
  rankProfileMatch,
  sanitizeProfileSearchQuery,
} from "@/lib/profile-search";
import { GUARDED_FIELDS } from "@/lib/check-profile-id-pii";
import { PROFILE_FIELDS, profileFieldNames } from "@/lib/profile-fields";
import {
  PROFILE_EXACT_SEARCH_LIMIT,
  profilesExactSearchUrl,
  profilesSearchUrl,
} from "@/lib/supabase-profiles-shapes";

import { columnsOf, uniqueIndexesOn } from "./helpers/migration-schema";
import { stripComments } from "@/lib/strip-comments";

import { readRepoFile } from "./helpers/repo-file";


describe("sanitizeProfileSearchQuery", () => {
  it("strips a leading @ so pasted handles match", () => {
    assert.equal(sanitizeProfileSearchQuery("@antoxa"), "antoxa");
  });

  it("removes PostgREST/ilike metacharacters", () => {
    assert.equal(sanitizeProfileSearchQuery("a,b(c)d%e*f\\g\"h'i"), "abcdefghi");
  });

  it("trims whitespace", () => {
    assert.equal(sanitizeProfileSearchQuery("  juno  "), "juno");
  });

  it("returns empty string for a query of only metacharacters", () => {
    assert.equal(sanitizeProfileSearchQuery("%()*,"), "");
  });

  it("strips the @ AFTER the metacharacters, so %@anna is a handle", () => {
    // The order used to be the other way round and `%@anna` came out as
    // `@anna` — which matched nothing on either half, consistently.
    assert.equal(sanitizeProfileSearchQuery("%@anna"), "anna");
  });

  it("leaves case alone, because the server's half is ilike", () => {
    assert.equal(sanitizeProfileSearchQuery("@Anna"), "Anna");
  });
});

describe("profilesSearchUrl", () => {
  const BASE = "https://proj.supabase.co";

  it("builds an or=() over every searchable column", () => {
    const url = profilesSearchUrl(BASE, sanitizeProfileSearchQuery("juno"), 20);
    assert.match(url, /\/rest\/v1\/profiles\?select=/);
    assert.match(
      url,
      /or=\(username\.ilike\.\*juno\*,display_name\.ilike\.\*juno\*,public_id\.ilike\.\*juno\*\)/,
    );
    assert.match(url, /limit=20$/);
  });

  it("derives the or= list from PROFILE_SEARCH_COLUMNS rather than restating it", () => {
    // The point of the shared list. This `or=` and the two client filters are
    // halves of one question, and until 2026-10-13 all three left `public_id`
    // out — under a field the UI labels "search by profile ID".
    const url = profilesSearchUrl(BASE, sanitizeProfileSearchQuery("juno"), 5);
    for (const column of PROFILE_SEARCH_COLUMNS) {
      assert.ok(url.includes(`${column}.ilike.*juno*`), `${column} is not searched`);
    }
    assert.equal(
      url.split(".ilike.").length - 1,
      PROFILE_SEARCH_COLUMNS.length,
      "the or= list is exactly the shared column list",
    );
  });

  it("searches the public_id a user is invited to share", () => {
    // `profileIdPlaceholder` is `my-collectables-id`, which is a `publicId`.
    // Somebody who passed theirs to a friend was unfindable by it.
    assert.ok(profilesSearchUrl(BASE, sanitizeProfileSearchQuery("my-collectables-id"), 20).includes("public_id.ilike."));
  });

  it("takes a needle already sanitised, so nothing strips the query twice", () => {
    const url = profilesSearchUrl(BASE, sanitizeProfileSearchQuery("@ju,no(1)"), 10);
    // The user's parens/commas must not survive into the boolean tree — only
    // the or=()'s own two parens and one comma remain.
    assert.match(url, /ilike\.\*juno1\*/);
    assert.ok(!url.includes("no(1)"), "unsanitized query leaked into the URL");
  });
});

describe("people/search UI uses the server-side search", () => {
  it("app/people.tsx queries searchProfiles when the box is non-empty", () => {
    const src = readRepoFile("app/people.tsx");
    assert.match(src, /import \{ fetchProfiles, searchProfiles \} from "@\/lib\/supabase-profiles"/);
    // The needle is the settled value from `useDebouncedValue`; the trimming
    // it used to do inline now happens at the hook's input.
    assert.match(src, /searchProfiles\(debouncedQuery, SEARCH_RESULT_LIMIT\)/);
    assert.match(src, /useDebouncedValue\(query\.trim\(\), PROFILE_SEARCH_DEBOUNCE_MS\)/);
  });

  it("components/search-overlay.tsx queries searchProfiles for the people section", () => {
    const src = readRepoFile("components/search-overlay.tsx");
    assert.match(src, /searchProfiles\(debouncedQuery, SECTION_LIMIT\)/);
    assert.match(src, /useDebouncedValue\(q, PROFILE_SEARCH_DEBOUNCE_MS\)/);
  });

  it("the sheet asks for exactly as many profiles as it will show", () => {
    // The claim that makes the cut safe, and the reason the request size and
    // the display size are one constant rather than two literals: a request
    // larger than the cut pays for rows the slice throws away, and a request
    // smaller than it leaves the section short with nothing saying why.
    const src = readRepoFile("components/search-overlay.tsx");
    assert.match(src, /const SECTION_LIMIT = 20;/);
    assert.match(src, /searchProfiles\(debouncedQuery, SECTION_LIMIT\)/);
    assert.match(src, /profileSearchUnion\([^)]*\)\.slice\(0, SECTION_LIMIT\)/);
  });

  it("all three sections of the sheet cut at the same number", () => {
    // Items, collections and people are three sections of one sheet, so a
    // section showing more rows than its neighbours would be a layout
    // decision nobody made. Three slices, one constant.
    //
    // Comment-stripped, because `SECTION_LIMIT`'s own header quotes the four
    // `.slice(0, 20)` literals it replaced — prose about a rule is the
    // commonest way a source scan reports its own documentation.
    const code = stripComments(readRepoFile("components/search-overlay.tsx"));
    assert.equal(
      code.split(".slice(0, SECTION_LIMIT)").length - 1,
      3,
      "a section of the sheet cuts at a number of its own",
    );
    assert.ok(
      !/\.slice\(0, \d+\)/.test(code),
      "a section still slices at a bare literal",
    );
  });

  it("the people screen's request limit is named and is NOT the sheet's cut", () => {
    // Two readers, two numbers, and the difference is the surface: the sheet
    // slices what it shows, the screen renders every row it gets, so its
    // limit is the only cap on how much of the table a search reaches. The
    // numbers are allowed to differ; what is not allowed is their being two
    // literals with nothing saying they were different decisions.
    const src = readRepoFile("app/people.tsx");
    assert.match(src, /const SEARCH_RESULT_LIMIT = 50;/);
    assert.ok(
      !/searchProfiles\(debouncedQuery, \d+\)/.test(src),
      "the people screen asks for a bare literal again",
    );
    assert.ok(
      !/\.slice\(0, SEARCH_RESULT_LIMIT\)/.test(src),
      "the screen now cuts its union, which is the sheet's shape and needs the sheet's reason",
    );
  });

  it("app/people.tsx catches fetchProfiles failures instead of blanking silently", () => {
    const src = readRepoFile("app/people.tsx");
    assert.match(src, /const result = await fetchProfiles\(pageNum, PAGE_SIZE\);[\s\S]*?\} catch \{/);
  });
});

describe("the client half of the same question", () => {
  const ANNA = {
    username: "anna_2",
    displayName: "Anna Petrova",
    publicId: "my-collectables-id",
  };

  describe("profileSearchNeedle", () => {
    it("strips a leading @, because every handle is printed with one", () => {
      assert.equal(profileSearchNeedle("@Anna"), "anna");
    });

    it("trims and lower-cases, because the client comparison is includes()", () => {
      assert.equal(profileSearchNeedle("  ANNA  "), "anna");
    });

    it("gives the empty string for a blank query, which is the callers' cue to skip", () => {
      assert.equal(profileSearchNeedle("   "), "");
      assert.equal(profileSearchNeedle("@"), "");
    });

    it("is the server's sanitiser lower-cased, and nothing else", () => {
      // Case is the one thing the two halves may handle differently, because
      // `ilike` is case-insensitive by definition. Everything else they have
      // to agree on, or a match appears and disappears as the page scrolls.
      for (const typed of ["anna*", "50%", "a,b(c)", "  @Anna_2  ", "%@anna", "", "@"]) {
        assert.equal(
          profileSearchNeedle(typed),
          sanitizeProfileSearchQuery(typed).toLowerCase(),
          `the two halves disagree about ${JSON.stringify(typed)}`,
        );
      }
    });

    it("drops the wildcards the server drops, so a typed * is not a dead search", () => {
      // The bug: the client kept `%` and `*` and compared them with
      // `includes`, so `anna*` searched `*anna*` on the server and matched
      // nothing on the loaded page — and with Supabase unconfigured, where
      // the server half returns nothing by design, it matched nobody at all.
      assert.equal(profileSearchNeedle("anna*"), "anna");
      assert.equal(profileSearchNeedle("50%"), "50");
    });
  });

  describe("profileMatchesSearch", () => {
    it("matches the public_id, which is what the field is labelled for", () => {
      // The bug. Both client readers filtered on username and displayName
      // only, so a shared profile ID matched nothing on the loaded page —
      // and the server did not search it either, so nothing rescued it.
      assert.ok(profileMatchesSearch(ANNA, profileSearchNeedle("collectables")));
      assert.ok(profileMatchesSearch(ANNA, profileSearchNeedle("MY-COLLECTABLES-ID")));
    });

    it("still matches the handle and the display name", () => {
      assert.ok(profileMatchesSearch(ANNA, profileSearchNeedle("@anna_2")));
      assert.ok(profileMatchesSearch(ANNA, profileSearchNeedle("petrova")));
    });

    it("does not match text that is in none of the three fields", () => {
      assert.ok(!profileMatchesSearch(ANNA, profileSearchNeedle("boris")));
    });

    it("matches everything on an empty needle, which is why callers skip it", () => {
      assert.ok(profileMatchesSearch(ANNA, ""));
    });
  });

  it("both client readers go through the shared predicate", () => {
    // Two identical five-line filters is how `publicId` came to be missing
    // from one of them — in fact from both, which is worse: nothing
    // disagreed, so nothing looked wrong. The readers reach the predicate
    // through `profileSearchUnion` since 2026-10-17, which is the same claim
    // one level up: neither screen decides what a match is, and neither
    // decides WHICH HALF gets asked.
    for (const file of ["app/people.tsx", "components/search-overlay.tsx"]) {
      const src = readRepoFile(file);
      const importList = /import \{([^}]+)\} from "@\/lib\/profile-search";/.exec(src);
      assert.ok(importList, `${file} does not import from lib/profile-search`);
      for (const name of ["profileSearchNeedle", "profileSearchUnion"]) {
        assert.ok(
          importList[1].includes(name),
          `${file} does not import ${name} from the shared module`,
        );
      }
      assert.match(src, /profileSearchUnion\(/, `${file} builds the union itself`);
      assert.ok(
        !/\.filter\(\(p\) => profileMatchesSearch\(p, needle\)\)/.test(src),
        `${file} filters a half by hand — which half is the question that went wrong`,
      );
      assert.ok(
        !/p\.displayName\.toLowerCase\(\)\.includes\(needle\)/.test(src),
        `${file} still has the hand-rolled filter the predicate replaced`,
      );
    }
  });
});

describe("the seam the last three defects were on", () => {
  // Three in a row: the fields the two halves searched (`public_id` in
  // neither), the text they searched for (the client sanitised nothing), and
  // the query being stripped twice off one raw string. All three were a
  // client filter and a server `or=` answering one question differently, and
  // none of them could be stated by a case about either half alone.
  //
  // This is the closest a suite with no database can get: the row the client
  // predicate sees, run against a pattern derived from the URL the server
  // would be sent.
  const ROW = {
    username: "anna_2",
    displayName: "Anna Petrova",
    publicId: "my-collectables-id",
  };
  const COLUMN_OF: Readonly<Record<string, keyof typeof ROW>> = {
    username: "username",
    display_name: "displayName",
    public_id: "publicId",
  };

  /** Whether the `or=` this URL carries would match the row, column by column. */
  function serverWouldMatch(url: string): boolean {
    const or = /&or=\(([^)]*)\)/.exec(url);
    assert.ok(or, "no or= filter in the search URL");
    return or[1].split(",").some((clause) => {
      const [column, operator, pattern] = clause.split(".");
      const field = COLUMN_OF[column];
      assert.ok(field, `the or= names a column this case does not know: ${column}`);
      // The model's own premise, checked rather than assumed: everything
      // below is what `ilike` with `*` either side means. A clause using any
      // other operator would be simulated wrongly and silently.
      assert.equal(operator, "ilike", `this case cannot simulate ${operator}`);
      assert.match(pattern, /^\*.*\*$/, "the pattern is not an unanchored substring");
      // `ilike` with `*` wildcards either side is a case-insensitive
      // substring match, which is what the client's `includes` is.
      // Lower-cased on BOTH sides, because `ilike` is case-insensitive — which
      // is the one difference the client's `includes` is allowed to have, and
      // the reason `profileSearchNeedle` is the sanitiser plus a lower-case.
      const substring = decodeURIComponent(pattern).replace(/^\*|\*$/g, "").toLowerCase();
      return ROW[field].toLowerCase().includes(substring);
    });
  }

  for (const typed of [
    "anna",
    "@anna_2",
    "ANNA",
    "Petrova",
    "my-collectables-id",
    "MY-COLLECTABLES-ID",
    "collectables",
    "anna*",
    "50%",
    "a,b(c)",
    "boris",
    "nobody-here",
  ]) {
    it(`answers ${JSON.stringify(typed)} the same on the page and on the server`, () => {
      const needle = sanitizeProfileSearchQuery(typed);
      const client = profileMatchesSearch(ROW, profileSearchNeedle(typed));
      if (needle.length === 0) {
        // `searchProfiles` returns [] without asking the server, and both
        // client readers skip the filter. There is nothing to compare.
        assert.ok(client, "an empty needle matches everything by construction");
        return;
      }
      assert.equal(
        client,
        serverWouldMatch(profilesSearchUrl("https://proj.supabase.co", needle, 20)),
        "the loaded page and the rest of the table disagree about this query",
      );
    });
  }
});

describe("the brand, which is a compile error nothing here can assert", () => {
  // `SanitizedProfileQuery`'s whole value is that `profilesSearchUrl` cannot
  // be handed a raw string — and a case that tried would not fail, it would
  // fail to BUILD, because `tsc --noEmit` runs over this file. So the claim
  // is made the way the repository's `lint:*` guards make theirs: by reading
  // the source.
  const SOURCES = [
    "lib/supabase-profiles.ts",
    "app/people.tsx",
    "components/search-overlay.tsx",
  ];

  it("has exactly one producer, and it is the sanitiser", () => {
    const module = readRepoFile("lib/profile-search.ts");
    assert.equal(
      module.split("as SanitizedProfileQuery").length - 1,
      1,
      "a second cast into the brand is a second place the characters can be stripped",
    );
    assert.match(module, /\.trim\(\) as SanitizedProfileQuery;/);
  });

  it("is never cast into outside the module that defines it", () => {
    for (const file of SOURCES) {
      assert.doesNotMatch(
        readRepoFile(file),
        /as SanitizedProfileQuery/,
        `${file} casts into the brand instead of sanitising`,
      );
    }
  });

  it("is what the URL builder takes, so nothing sanitises twice", () => {
    const shapes = readRepoFile("lib/supabase-profiles-shapes.ts");
    assert.match(shapes, /needle: SanitizedProfileQuery,/);
    assert.doesNotMatch(
      shapes,
      /sanitizeProfileSearchQuery\(/,
      "the URL builder strips the query again, off a needle that is already stripped",
    );
  });
});

describe("rankProfileMatch", () => {
  const ROW = { username: "anna", displayName: "Anna Petrova", publicId: "anna-collects" };

  it("ranks a UNIQUE identifier that IS the needle first", () => {
    assert.equal(rankProfileMatch(ROW, "anna"), 0);
    assert.equal(rankProfileMatch(ROW, "anna-collects"), 0);
  });

  it("ranks an exact display name second, because it is not a single answer", () => {
    // `displayName` is the one searchable column with no unique index: two
    // people may both be called "Anna Petrova". It was band 0 until
    // 2026-10-17, which made the band's own description ("the one case where
    // there is a single right answer") untrue.
    assert.equal(rankProfileMatch(ROW, "anna petrova"), 1);
  });

  it("ranks a prefix third, whichever field it is a prefix of", () => {
    // A guess about a unique column is still a guess.
    assert.equal(rankProfileMatch(ROW, "ann"), 2);
    assert.equal(rankProfileMatch(ROW, "anna-coll"), 2);
    assert.equal(rankProfileMatch(ROW, "anna pet"), 2);
  });

  it("ranks a substring last", () => {
    assert.equal(rankProfileMatch(ROW, "petrova"), 3);
    assert.equal(rankProfileMatch(ROW, "collects"), 3);
  });

  it("puts the handle's owner above every namesake", () => {
    // The ordering the split exists for, over the rows it goes wrong on: one
    // person whose handle IS `anna`, two people called Anna. All three are
    // exact matches on some field; only one of them is THE answer.
    const owner = { id: "owner", username: "anna", displayName: "A. Petrova", publicId: "x-id" };
    const namesakes = [
      { id: "n1", username: "anna_k", displayName: "Anna", publicId: "n1-id" },
      { id: "n2", username: "anna_v", displayName: "Anna", publicId: "n2-id" },
    ];
    assert.deepEqual(
      // The namesakes lead the input, so a tie would leave them leading.
      mergeProfileMatches(namesakes, [owner], "anna").map((p) => p.id),
      ["owner", "n1", "n2"],
    );
  });

  it("is case-insensitive, like both halves of the search", () => {
    // The needle arrives lower-cased from `profileSearchNeedle`; the ROW does
    // not, because a stored displayName keeps its capitals.
    assert.equal(rankProfileMatch(ROW, profileSearchNeedle("ANNA")), 0);
    assert.equal(rankProfileMatch(ROW, profileSearchNeedle("@Anna-Collects")), 0);
    assert.equal(rankProfileMatch(ROW, profileSearchNeedle("ANNA PETROVA")), 1);
  });

  it("is 0 for an empty needle, consistent with matching everything", () => {
    // Answered before the comparisons rather than falling out of them: every
    // field starts with "", so without the early return a row would be a
    // prefix match (2) while a row with an empty username would be exact (0),
    // and the two would sort against each other for no reason.
    assert.equal(rankProfileMatch(ROW, ""), 0);
    assert.equal(rankProfileMatch({ username: "", displayName: "", publicId: "" }, ""), 0);
  });

  it("names the unique fields from the columns the schema makes unique", () => {
    // The band split is an argument about uniqueness, and the uniqueness is
    // in a migration (see the PROFILE_EXACT_SEARCH_LIMIT cases below). This
    // is the same claim from the other end: the fields band 0 is about are
    // the camel-case spellings of those columns, and `displayName` is not
    // among them.
    // Derived from `PROFILE_FIELDS` since 2026-10-19, so the claim is about
    // the table's `unique` flags (tied to the migrations by the cases below)
    // rather than about two words somebody typed into an array literal.
    assert.deepEqual(
      [...profileFieldNames((field) => field.searchable && field.unique)],
      ["username", "publicId"],
    );
    const module = readRepoFile("lib/profile-search.ts");
    assert.match(module, /UNIQUE_SEARCH_FIELDS[^=]*= profileFieldNames\(/);
    assert.ok(
      !/UNIQUE_SEARCH_FIELDS[^;]*displayName/.test(module),
      "displayName has no unique index — an exact match on it is band 1",
    );
  });
});

describe("mergeProfileMatches", () => {
  const row = (id: string, username: string, publicId: string) => ({
    id,
    username,
    displayName: username,
    publicId,
  });

  it("puts the exact match first even when it only came from the server", () => {
    // The bug. The loaded page held a substring match and the exact row was
    // past it, so pasting a whole profile ID answered with somebody else —
    // under a field labelled "search by profile ID".
    const local = [row("1", "banna-fan", "banna-fan-id")];
    const remote = [row("2", "anna", "anna-id")];
    const merged = mergeProfileMatches(local, remote, "anna");
    assert.deepEqual(
      merged.map((p) => p.id),
      ["2", "1"],
    );
  });

  it("keeps the loaded page first among equally good matches", () => {
    // The half of the old behaviour worth keeping: a row already on screen
    // should not be pushed down by a server row that answers no better.
    const local = [row("1", "anna-one", "one-id")];
    const remote = [row("2", "anna-two", "two-id")];
    const merged = mergeProfileMatches(local, remote, "anna");
    assert.deepEqual(
      merged.map((p) => p.id),
      ["1", "2"],
    );
  });

  it("dedupes by id and lets the local copy win", () => {
    const local = [row("1", "anna", "anna-id")];
    const remote = [row("1", "anna-stale", "anna-id"), row("2", "annabel", "annabel-id")];
    const merged = mergeProfileMatches(local, remote, "anna");
    assert.deepEqual(
      merged.map((p) => p.id),
      ["1", "2"],
    );
    assert.equal(merged[0].username, "anna", "the server's copy replaced the page's");
  });

  it("preserves the server's own order within a band", () => {
    const remote = [
      row("a", "x-anna", "x-id"),
      row("b", "y-anna", "y-id"),
      row("c", "z-anna", "z-id"),
    ];
    assert.deepEqual(
      mergeProfileMatches([], remote, "anna").map((p) => p.id),
      ["a", "b", "c"],
    );
  });

  it("returns every input row — ordering is not filtering", () => {
    const local = [row("1", "anna", "anna-id")];
    const remote = [row("2", "bob", "bob-id")];
    assert.equal(mergeProfileMatches(local, remote, "anna").length, 2);
  });
});

describe("both readers merge through the shared function", () => {
  const READERS = ["app/people.tsx", "components/search-overlay.tsx"];

  it("neither spreads the two lists together itself", () => {
    for (const file of READERS) {
      const source = readRepoFile(file);
      assert.match(source, /profileSearchUnion\(/, `${file} does not use the shared union`);
      assert.doesNotMatch(
        source,
        /\[\.\.\.local, \.\.\.remote/,
        `${file} unions the two halves itself, in the order that hid the exact match`,
      );
      assert.doesNotMatch(
        source,
        /new Set\(local\.map/,
        `${file} dedupes by id itself`,
      );
    }
  });

  it("the overlay orders before it slices", () => {
    // A twenty-row cut off the front of an unordered union can drop the
    // exact match outright.
    assert.match(
      readRepoFile("components/search-overlay.tsx"),
      /profileSearchUnion\(profiles, remoteMatches, needle\)\.slice\(0, SECTION_LIMIT\)/,
    );
  });
});

describe("the seam with two rows, which is the question it actually gets asked", () => {
  // Every case above drives ONE row, which answers "do the two halves agree
  // about this profile". What a user does is paste a profile ID and get a
  // LIST, and until the ordering landed nothing stated what that list looks
  // like when the two halves each contribute a row.
  //
  // The arrangement is the one that used to be wrong: the loaded page holds a
  // weaker match and the exact row arrives from the server.
  //
  // The page row is a SUPERSTRING of what was typed, which is what makes it a
  // match at all: `profileMatchesSearch` is `includes` on both halves, so a
  // profile ID that merely contains somebody else's whole profile ID answers
  // the query. That is the band-2 case, and it was sorting first.
  const PAGE_ROW = {
    id: "page",
    username: "collectables-fan",
    displayName: "Collectables Fan",
    publicId: "not-my-collectables-id",
  };
  const SERVER_ROW = {
    id: "server",
    username: "anna_2",
    displayName: "Anna Petrova",
    publicId: "my-collectables-id",
  };
  const TYPED = "my-collectables-id";

  it("both rows are matches, so the order is the whole question", () => {
    const needle = profileSearchNeedle(TYPED);
    assert.ok(
      profileMatchesSearch(PAGE_ROW, needle),
      "the page row must match, or this case is about one row again",
    );
    assert.ok(profileMatchesSearch(SERVER_ROW, needle));
  });

  it("the server would return the exact row for what was typed", () => {
    // The other half's premise, so the arrangement is not a fiction: the row
    // the page cannot see is one the table answers with.
    const url = profilesSearchUrl(
      "https://proj.supabase.co",
      sanitizeProfileSearchQuery(TYPED),
      20,
    );
    assert.ok(url.includes(`public_id.ilike.*${TYPED}*`));
  });

  it("answers with the pasted profile ID first", () => {
    const merged = mergeProfileMatches([PAGE_ROW], [SERVER_ROW], profileSearchNeedle(TYPED));
    assert.deepEqual(
      merged.map((p) => p.id),
      ["server", "page"],
      "a page-one substring match is above the profile ID that was pasted",
    );
  });

  it("keeps the page row, because ordering is not filtering", () => {
    const merged = mergeProfileMatches([PAGE_ROW], [SERVER_ROW], profileSearchNeedle(TYPED));
    assert.equal(merged.length, 2);
  });
});

describe("what is safe to expose about a profile, decided in two lists", () => {
  // `PROFILE_SEARCH_COLUMNS` is the third list in the tree with an opinion
  // about profile fields, and `lib/check-profile-id-pii.ts`' GUARDED_FIELDS
  // is the second. The guard is about identifiers DERIVED from an email, so
  // the overlap is not a hole — but a searchable column the guard has never
  // heard of is worth being deliberate about rather than discovering.
  const UNGUARDED: Readonly<Record<string, string>> = {
    display_name: "prose the user types, not an identifier derived from their email — the guard's whole subject is a publicId or handle built out of an address, and a display name is whatever somebody chose to be called",
  };

  it("classifies every searchable column", () => {
    const unclassified = PROFILE_SEARCH_COLUMNS.filter(
      (column) => !GUARDED_FIELDS.includes(column as (typeof GUARDED_FIELDS)[number]) &&
        UNGUARDED[column] === undefined,
    );
    assert.deepEqual(
      unclassified,
      [],
      "a column the profile search exposes is either watched by the PII guard or listed here with the reason",
    );
  });

  it("the exemption list is not stale", () => {
    for (const column of Object.keys(UNGUARDED)) {
      assert.ok(
        (PROFILE_SEARCH_COLUMNS as readonly string[]).includes(column),
        `${column} is exempted and is not a searchable column any more`,
      );
      assert.ok(
        !(GUARDED_FIELDS as readonly string[]).includes(column),
        `${column} is exempted and the guard watches it now`,
      );
    }
  });

  it("the identifier the UI invites people to share IS guarded", () => {
    // The field this search exists for, and the one an email could have been
    // slugified into.
    assert.ok((GUARDED_FIELDS as readonly string[]).includes("public_id"));
    assert.ok((GUARDED_FIELDS as readonly string[]).includes("username"));
  });
});

describe("the exact match the substring query could never return", () => {
  // `profilesSearchUrl` is `created_at.desc` cut at `limit`, so the ranking
  // the client applies afterwards can only reorder what arrived. An exact
  // `publicId` match that sits past that cut is not in the response at all —
  // under a field whose placeholder is `my-collectables-id`. The second,
  // tiny request is what puts it there.
  const BASE = "https://proj.supabase.co";

  it("builds an or=() over every searchable column, with no wildcards", () => {
    const url = profilesExactSearchUrl(BASE, sanitizeProfileSearchQuery("juno"), 5);
    assert.match(url, /\/rest\/v1\/profiles\?select=/);
    assert.match(
      url,
      /or=\(username\.ilike\.juno,display_name\.ilike\.juno,public_id\.ilike\.juno\)/,
    );
    assert.ok(!url.includes("*"), "a wildcard would make this the substring query again");
  });

  it("derives the or= list from PROFILE_SEARCH_COLUMNS rather than restating it", () => {
    // The same claim the substring builder carries: the two server queries
    // and the two client filters are halves of one question.
    const url = profilesExactSearchUrl(BASE, sanitizeProfileSearchQuery("juno"), 5);
    for (const column of PROFILE_SEARCH_COLUMNS) {
      assert.ok(url.includes(`${column}.ilike.juno`), `${column} is not searched`);
    }
    assert.equal(
      url.split(".ilike.").length - 1,
      PROFILE_SEARCH_COLUMNS.length,
      "the or= list is exactly the shared column list",
    );
  });

  it("takes a needle already sanitised, so nothing strips the query twice", () => {
    const url = profilesExactSearchUrl(BASE, sanitizeProfileSearchQuery("@ju,no(1)"), 5);
    assert.match(url, /ilike\.juno1/);
    assert.ok(!url.includes("no(1)"), "unsanitized query leaked into the URL");
  });

  it("asks for a handful, because only display_name can answer with a crowd", () => {
    assert.equal(PROFILE_EXACT_SEARCH_LIMIT, 5);
    assert.match(
      profilesExactSearchUrl(BASE, sanitizeProfileSearchQuery("juno"), PROFILE_EXACT_SEARCH_LIMIT),
      /limit=5$/,
    );
  });

  // The tie that matters: this query's job is to fetch exactly the rows the
  // ranking calls an EXACT match — band 0 (a unique identifier is the needle)
  // or band 1 (the display name is) — so the two have to agree about every
  // typed string, or the request fetches rows the ranking does not promote
  // (or misses the ones it would). The `or=` is over all three columns and
  // cannot tell the two bands apart; the ranking is what separates them once
  // the rows are here.
  const ROW = {
    username: "anna_2",
    displayName: "Anna Petrova",
    publicId: "my-collectables-id",
  };
  const COLUMN_OF: Readonly<Record<string, keyof typeof ROW>> = {
    username: "username",
    display_name: "displayName",
    public_id: "publicId",
  };

  function serverWouldMatchExactly(url: string): boolean {
    const or = /or=\(([^)]*)\)/.exec(url);
    assert.ok(or, "no or= filter in the URL");
    return or[1].split(",").some((clause) => {
      const [column, operator, pattern] = clause.split(".");
      const field = COLUMN_OF[column];
      assert.ok(field, `the or= names a column this case does not know: ${column}`);
      assert.equal(operator, "ilike", `this case cannot simulate ${operator}`);
      assert.ok(!pattern.includes("*"), "a wildcard pattern is not an exact comparison");
      // `ilike` with no wildcards is `=` that ignores case, which is what
      // `rankProfileMatch`'s band 0 is: both sides lower-cased, then compared.
      return ROW[field].toLowerCase() === decodeURIComponent(pattern).toLowerCase();
    });
  }

  for (const typed of [
    "anna_2",
    "@anna_2",
    "ANNA_2",
    "anna",
    "Anna Petrova",
    "my-collectables-id",
    "MY-COLLECTABLES-ID",
    "collectables",
    "my-collectables-id-2",
    "nobody-here",
  ]) {
    it(`fetches ${JSON.stringify(typed)} exactly when the ranking calls it exact`, () => {
      const needle = sanitizeProfileSearchQuery(typed);
      assert.ok(needle.length > 0, "this case is about queries that reach the server");
      assert.equal(
        rankProfileMatch(ROW, profileSearchNeedle(typed)) <= 1,
        serverWouldMatchExactly(profilesExactSearchUrl(BASE, needle, PROFILE_EXACT_SEARCH_LIMIT)),
        "the exact query and the ranking's exact bands disagree about this query",
      );
    });
  }

  it("the exact row leads even when the substring query returned a page of others", () => {
    // What the two requests buy, stated over the merge they are folded
    // together by: the exact list is the `local` argument, so its rows win
    // the dedupe and sort to the front.
    const exact = [{ id: "exact", ...ROW }];
    const substring = [
      { id: "other-1", username: "fan", displayName: "Fan", publicId: "not-my-collectables-id" },
      { id: "exact", ...ROW },
    ];
    const merged = mergeProfileMatches(exact, substring, profileSearchNeedle("my-collectables-id"));
    assert.deepEqual(merged.map((p) => p.id), ["exact", "other-1"]);
  });
});

describe("searchProfiles asks both halves of the question", () => {
  const src = readRepoFile("lib/supabase-profiles.ts");

  it("fires the exact and the substring query together", () => {
    // In sequence would add a round trip to every keystroke that survives
    // the debounce, for a request that is the cheaper of the two.
    assert.match(
      src,
      /await Promise\.all\(\[\s*fetchProfilesByUrl\(\s*profilesExactSearchUrl\([\s\S]*?profilesSearchUrl\(/,
    );
  });

  it("asks for PROFILE_EXACT_SEARCH_LIMIT rather than a number written here", () => {
    assert.match(src, /profilesExactSearchUrl\(supabaseUrl!, needle, PROFILE_EXACT_SEARCH_LIMIT\)/);
  });

  it("merges through the function the screens use, exact first", () => {
    assert.match(src, /mergeProfileMatches\(exact, substring, needle\.toLowerCase\(\)\)\.slice\(0, limit\)/);
  });

  it("reads both responses through one reader, so one failure cannot blank the other", () => {
    // Two `res.ok` checks written twice is the shape this repository's
    // history is about removing — and here the second copy would have had to
    // decide what a half-failed search returns.
    assert.equal(
      src.split("async function fetchProfilesByUrl").length - 1,
      1,
      "one reader for both profile search requests",
    );
    assert.match(src, /if \(!res\.ok \|\| !Array\.isArray\(rows\)\) \{/);
  });
});

describe("the server's rows answer an older query than the one on screen", () => {
  // Both screens compute the local half from the LIVE query and hold the
  // server half for `debouncedQuery` — what was typed a debounce window ago.
  // So the two halves of the union answer different questions for as long as
  // somebody is still typing, and until 2026-10-17 the remote half was
  // merged in unchecked: narrowing a query rendered profiles that answer
  // nothing on screen until the next round trip landed.
  const row = (id: string, username: string) => ({
    id,
    username,
    displayName: username,
    publicId: `${username}-id`,
  });

  // The page is empty on purpose: this is about the half that is NOT
  // recomputed per keystroke.
  const FETCHED_FOR_ANN = [row("1", "ann"), row("2", "annz")];

  /** What a screen renders: exactly the call both of them make. */
  function rendered(typed: string, remote: readonly ReturnType<typeof row>[]): string[] {
    return profileSearchUnion([], remote, profileSearchNeedle(typed)).map((p) => p.id);
  }

  it("drops the stale row that no longer answers what is typed", () => {
    assert.deepEqual(rendered("annz", FETCHED_FOR_ANN), ["2"]);
  });

  it("keeps the stale row that still answers, which is what the union is for", () => {
    // The responsiveness half: a row fetched for a shorter query and still
    // matching must not blink out while the next request is in flight.
    assert.deepEqual(rendered("ann", FETCHED_FOR_ANN), ["1", "2"]);
  });

  it("renders nothing rather than everything when the query stops matching", () => {
    assert.deepEqual(rendered("boris", FETCHED_FOR_ANN), []);
  });

  it("neither screen can filter one half and forget the other", () => {
    // The fix that outlasts this case: the predicate is not at either call
    // site any more, so "which half gets filtered" is not a question a screen
    // can answer wrongly. `profileSearchUnion` is where it is answered, once.
    for (const file of ["app/people.tsx", "components/search-overlay.tsx"]) {
      const src = readRepoFile(file);
      assert.equal(
        src.split("profileMatchesSearch").length - 1,
        0,
        `${file} names the predicate again — the union is what decides both halves`,
      );
    }
    assert.equal(
      readRepoFile("lib/profile-search.ts").split("profileMatchesSearch(p, needle)").length - 1,
      1,
      "the union filters its two halves with one expression or none",
    );
  });
});

describe("the two profile queries are one URL shape with one difference", () => {
  // Both builders went through `profilesIlikeUrl` on 2026-10-17, because the
  // template was written twice and the only difference between the copies was
  // the wildcards. This is that claim, stated so a third copy cannot appear
  // quietly: everything but the pattern has to match, character for
  // character.
  const BASE = "https://proj.supabase.co";
  const NEEDLE = sanitizeProfileSearchQuery("my-collectables-id");

  it("differ only by the wildcards around the pattern", () => {
    const exact = profilesExactSearchUrl(BASE, NEEDLE, 20);
    const substring = profilesSearchUrl(BASE, NEEDLE, 20);
    assert.equal(
      exact.split(`ilike.${NEEDLE}`).join(`ilike.*${NEEDLE}*`),
      substring,
      "the two queries differ somewhere other than the pattern",
    );
  });

  it("neither spells the profiles URL template for itself", () => {
    // What makes the sentence above true going forward: one template, and the
    // two exported builders are the pattern they pass to it.
    const module = readRepoFile("lib/supabase-profiles-shapes.ts");
    // The `or=` is what makes it a SEARCH URL: `profilesPageUrl` shares the
    // `select=` prefix and is a different question (one page of the table, in
    // table order), so the prefix alone would count it in.
    assert.equal(
      module.split("&or=(${or})").length - 1,
      1,
      "the profile search URL template is written more than once",
    );
    assert.match(module, /return profilesIlikeUrl\(baseUrl, `\*\$\{needle\}\*`, limit\);/);
    assert.match(module, /return profilesIlikeUrl\(baseUrl, needle, limit\);/);
  });
});

describe("why PROFILE_EXACT_SEARCH_LIMIT is allowed to be 5", () => {
  // The constant's header says "`username` and `public_id` are unique, so the
  // only column that can answer with a crowd is `display_name`". That is a
  // claim about the DATABASE, and the database is in this repository — so it
  // is checkable rather than a remembered fact. A migration that dropped
  // either unique index would turn 5 from a comfortable margin into a silent
  // cap on correct answers.
  // The walk moved to `helpers/migration-schema.ts` on 2026-10-19 —
  // `base-schema-parity.test.ts` read the same directory with its own regex,
  // and the shared reader also sees the two shapes this one could not (an
  // inline column `UNIQUE`, and an `ALTER TABLE … ADD CONSTRAINT … UNIQUE`)
  // while refusing to report a member of a COMPOSITE unique index as unique
  // on its own. The claim here is unchanged.
  const UNIQUE_ON_PROFILES = uniqueIndexesOn("profiles");

  it("finds the unique indexes the constant's reason rests on", () => {
    // The premise, checked before it is argued from: a regex that matched
    // nothing would make every assertion below vacuously agreeable.
    assert.ok(UNIQUE_ON_PROFILES.size > 0, "no UNIQUE INDEX on profiles was found at all");
  });

  it("every searchable column is unique except the one that can hold a crowd", () => {
    const notUnique = PROFILE_SEARCH_COLUMNS.filter((c) => !UNIQUE_ON_PROFILES.has(c));
    assert.deepEqual(
      notUnique,
      ["display_name"],
      "a searchable column stopped being unique (or display_name became unique) — PROFILE_EXACT_SEARCH_LIMIT's reason moved",
    );
  });

  it("names columns public.profiles actually has", () => {
    // The one defect the table can still have: a row whose `snake` was
    // `publicid` would typecheck, derive, build an `or=` clause and return
    // nothing per keystroke, silently — the client half would keep matching
    // on the camel field, so the page would answer and the table would not.
    // That is precisely the appears-and-disappears bug `lib/profile-search.ts`
    // exists to prevent, arriving through the module that was supposed to
    // make it impossible.
    const columns = columnsOf("profiles");
    assert.ok(columns.size >= 7, "the profiles column read has probably broken");
    for (const field of PROFILE_FIELDS) {
      assert.ok(
        columns.has(field.snake),
        `PROFILE_FIELDS names ${field.snake} and public.profiles has no such column`,
      );
    }
  });

  it("agrees with PROFILE_FIELDS about which columns are unique", () => {
    // The table's `unique` flag is a claim about the database, and the
    // database is in this repository. `rankProfileMatch`'s top band and
    // `PROFILE_EXACT_SEARCH_LIMIT` both rest on it, and since 2026-10-19 they
    // rest on it through the same three rows — so this is the one place that
    // has to read the migrations to keep either honest.
    for (const field of PROFILE_FIELDS) {
      assert.equal(
        field.unique,
        UNIQUE_ON_PROFILES.has(field.snake),
        `PROFILE_FIELDS says ${field.snake} is ${field.unique ? "" : "not "}unique and the migrations disagree`,
      );
    }
  });

  it("leaves room for more than one of the column that is not unique", () => {
    // One unique row per unique column, plus whatever `display_name` adds.
    // Five is "the handful at the top of the list"; two would be the cap the
    // header says it is not.
    assert.ok(
      PROFILE_EXACT_SEARCH_LIMIT > PROFILE_SEARCH_COLUMNS.length - 1,
      "the limit cannot hold one row per unique column and any namesakes",
    );
  });
});

describe("profileSearchUnion", () => {
  const row = (id: string, username: string) => ({
    id,
    username,
    displayName: username,
    publicId: `${username}-id`,
  });

  it("filters both halves, which is the whole difference from the merge", () => {
    // `mergeProfileMatches` keeps every input row by design ("ordering is not
    // filtering", with its reason). This is the function the screens want,
    // and it is the one that decides which rows answer.
    const local = [row("1", "anna"), row("2", "boris")];
    const remote = [row("3", "annabel"), row("4", "clara")];
    assert.deepEqual(
      profileSearchUnion(local, remote, "anna").map((p) => p.id),
      ["1", "3"],
    );
    assert.equal(
      mergeProfileMatches(local, remote, "anna").length,
      4,
      "the merge still keeps everything — the two functions have different jobs",
    );
  });

  it("puts an exact match from the server above a substring match on the page", () => {
    // The ordering the merge brought, unchanged by the filtering above it.
    const local = [row("1", "banna-fan")];
    const remote = [row("2", "anna")];
    assert.deepEqual(
      profileSearchUnion(local, remote, "anna").map((p) => p.id),
      ["2", "1"],
    );
  });

  it("lets the local copy of a duplicate win", () => {
    const local = [row("1", "anna")];
    const remote = [{ ...row("1", "anna-stale"), publicId: "anna-id" }];
    const merged = profileSearchUnion(local, remote, "anna");
    assert.equal(merged.length, 1);
    assert.equal(merged[0].username, "anna");
  });

  it("returns both halves on an empty needle, as the predicate does", () => {
    // Consistent rather than meaningful: the callers skip the whole filter in
    // that state. An empty needle that silently emptied the list would be the
    // worse of the two answers.
    assert.equal(profileSearchUnion([row("1", "anna")], [row("2", "boris")], "").length, 2);
  });
});
