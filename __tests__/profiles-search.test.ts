import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PROFILE_SEARCH_COLUMNS,
  profileMatchesSearch,
  profileSearchNeedle,
} from "@/lib/profile-search";
import {
  profilesSearchUrl,
  sanitizeProfileSearchQuery,
} from "@/lib/supabase-profiles-shapes";

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
});

describe("profilesSearchUrl", () => {
  const BASE = "https://proj.supabase.co";

  it("builds an or=() over every searchable column", () => {
    const url = profilesSearchUrl(BASE, "juno", 20);
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
    const url = profilesSearchUrl(BASE, "juno", 5);
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
    assert.ok(profilesSearchUrl(BASE, "my-collectables-id", 20).includes("public_id.ilike."));
  });

  it("sanitizes the query before embedding it", () => {
    const url = profilesSearchUrl(BASE, "@ju,no(1)", 10);
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
      assert.match(
        src,
        /import \{ profileMatchesSearch, profileSearchNeedle \} from "@\/lib\/profile-search";/,
        `${file} does not import the shared predicate`,
      );
      assert.match(src, /profileMatchesSearch\(p, needle\)/, `${file} filters by hand`);
      assert.ok(
        !/p\.displayName\.toLowerCase\(\)\.includes\(needle\)/.test(src),
        `${file} still has the hand-rolled filter the predicate replaced`,
      );
    }
  });
});
