import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PROFILE_SEARCH_COLUMNS,
  mergeProfileMatches,
  profileMatchesSearch,
  profileSearchNeedle,
  rankProfileMatch,
  sanitizeProfileSearchQuery,
} from "@/lib/profile-search";
import { GUARDED_FIELDS } from "@/lib/check-profile-id-pii";
import { profilesSearchUrl } from "@/lib/supabase-profiles-shapes";

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
    assert.match(src, /searchProfiles\(debouncedQuery, 50\)/);
    assert.match(src, /useDebouncedValue\(query\.trim\(\), PROFILE_SEARCH_DEBOUNCE_MS\)/);
  });

  it("components/search-overlay.tsx queries searchProfiles for the people section", () => {
    const src = readRepoFile("components/search-overlay.tsx");
    assert.match(src, /searchProfiles\(debouncedQuery, 20\)/);
    assert.match(src, /useDebouncedValue\(q, PROFILE_SEARCH_DEBOUNCE_MS\)/);
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
    // disagreed, so nothing looked wrong.
    for (const file of ["app/people.tsx", "components/search-overlay.tsx"]) {
      const src = readRepoFile(file);
      // The import is a multi-line list since `mergeProfileMatches` joined
      // it, so the claim is about the two names and the module rather than
      // about one line's text.
      const importList = /import \{([^}]+)\} from "@\/lib\/profile-search";/.exec(src);
      assert.ok(importList, `${file} does not import from lib/profile-search`);
      for (const name of ["profileMatchesSearch", "profileSearchNeedle"]) {
        assert.ok(
          importList[1].includes(name),
          `${file} does not import ${name} from the shared module`,
        );
      }
      assert.match(src, /profileMatchesSearch\(p, needle\)/, `${file} filters by hand`);
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

  it("ranks a field that IS the needle first", () => {
    assert.equal(rankProfileMatch(ROW, "anna"), 0);
    assert.equal(rankProfileMatch(ROW, "anna-collects"), 0);
    assert.equal(rankProfileMatch(ROW, "anna petrova"), 0);
  });

  it("ranks a prefix second", () => {
    assert.equal(rankProfileMatch(ROW, "ann"), 1);
    assert.equal(rankProfileMatch(ROW, "anna-coll"), 1);
  });

  it("ranks a substring last", () => {
    assert.equal(rankProfileMatch(ROW, "petrova"), 2);
    assert.equal(rankProfileMatch(ROW, "collects"), 2);
  });

  it("is case-insensitive, like both halves of the search", () => {
    // The needle arrives lower-cased from `profileSearchNeedle`; the ROW does
    // not, because a stored displayName keeps its capitals.
    assert.equal(rankProfileMatch(ROW, profileSearchNeedle("ANNA")), 0);
    assert.equal(rankProfileMatch(ROW, profileSearchNeedle("@Anna-Collects")), 0);
  });

  it("is 0 for an empty needle, consistent with matching everything", () => {
    // Answered before the comparisons rather than falling out of them: every
    // field starts with "", so without the early return a row would be a
    // prefix match (1) while a row with an empty username would be exact (0),
    // and the two would sort against each other for no reason.
    assert.equal(rankProfileMatch(ROW, ""), 0);
    assert.equal(rankProfileMatch({ username: "", displayName: "", publicId: "" }, ""), 0);
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
      assert.match(source, /mergeProfileMatches\(/, `${file} does not use the shared merge`);
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
      /mergeProfileMatches\(local, remoteMatches, needle\)\.slice\(0, 20\)/,
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
