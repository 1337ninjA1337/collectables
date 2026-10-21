import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { stripComments } from "@/lib/strip-comments";

import { readRepoFile } from "./helpers/repo-file";

/**
 * Structural / wiring tests for `lib/social-context.tsx`.
 *
 * The provider is a React component so we can't exercise its runtime under
 * `node --test`. Instead we read the source and assert that the
 * viewer-profile cache lives at the provider level (not inline in screens),
 * that `getProfileById` consults that cache, and that consumers route their
 * profile lookups through the new `ensureProfilesLoaded` helper.
 */

const SOURCE = readRepoFile("lib", "social-context.tsx");

describe("social-context.tsx viewer-profile cache", () => {
  it("declares the centralised viewerProfiles map and an in-flight ref", () => {
    assert.match(SOURCE, /useState<Record<string,\s*\{\s*profile:\s*UserProfile;\s*cachedAt:\s*number\s*\}>>\(\{\}\)/);
    assert.match(SOURCE, /inFlightProfileIdsRef[\s\S]*useRef<Set<string>>/);
  });

  it("stamps each cached entry with cachedAt for TTL-based expiry", () => {
    assert.match(SOURCE, /cachedAt:\s*Date\.now\(\)/);
    assert.match(SOURCE, /VIEWER_PROFILE_TTL_MS/);
    assert.match(SOURCE, /cached\.cachedAt/);
  });

  it("exposes ensureProfilesLoaded via the context value", () => {
    assert.match(SOURCE, /ensureProfilesLoaded:\s*\(ids:\s*readonly string\[]\)\s*=>\s*Promise<void>/);
    assert.match(SOURCE, /ensureProfilesLoaded,/);
  });

  it("getProfileById falls back to the viewerProfiles cache (.profile unwrap)", () => {
    // Behind the tombstone gate since 2026-10-21: the fallback is what made an
    // admin deletion survivable by one tap, because `profileById` is built
    // from the filtered list and `viewerProfiles` is filled by
    // `fetchProfileById`, which knows nothing about it.
    assert.match(
      SOURCE,
      /getProfileById:\s*\(id\)\s*=>\s*isProfileDeleted\(id\)\s*\?\s*undefined\s*:\s*profileById\.get\(id\)\s*\?\?\s*viewerProfiles\[id\]\?\.profile/,
    );
  });

  it("clears the cache and in-flight tracking when the user signs out", () => {
    assert.match(SOURCE, /setViewerProfiles\(\(prev\)\s*=>\s*\(Object\.keys\(prev\)\.length === 0/);
    assert.match(SOURCE, /inFlightProfileIdsRef\.current\.clear\(\)/);
  });

  it("drops cache entries for admin-deleted profiles", () => {
    assert.match(
      SOURCE,
      /setViewerProfiles\(\(current\)\s*=>\s*\{\s*if\s*\(!\(profileId in current\)\)/,
    );
  });
});

describe("BE-21 — addFriend routes an accept through the Edge Function", () => {
  it("imports the cloudAcceptFriendRequest wrapper", () => {
    assert.match(SOURCE, /cloudAcceptFriendRequest/);
    assert.match(SOURCE, /from "@\/lib\/supabase-profiles"/);
  });

  it("wires acceptFriendRequest into makeSocialDeliver (throws on transient false)", () => {
    assert.match(SOURCE, /acceptFriendRequest:\s*async\s*\([^)]*\)\s*=>/);
    assert.match(SOURCE, /await cloudAcceptFriendRequest\(fromUserId\)/);
    assert.match(SOURCE, /if \(!ok\) throw new Error/);
  });

  it("detects an inbound request and dispatches accept-request instead of send-request", () => {
    // The accept branch is keyed off an existing them→me request — which is
    // the `incoming` direction of `requestDirections` since 2026-09-11, when
    // the two per-call scans of `friendRequests` became two set lookups.
    assert.match(SOURCE, /isAccept\s*=\s*requestDirections\.incoming\.has\(profileId\)/);
    assert.match(
      SOURCE,
      /kind:\s*"accept-request",\s*acceptorUserId:\s*user\.id,\s*fromUserId:\s*profileId/,
    );
  });
});

describe("consumers route profile lookups through ensureProfilesLoaded", () => {
  const consumers = [
    "app/chats.tsx",
    "app/chat/[id].tsx",
    "app/collection/[id].tsx",
    "app/profile/[id].tsx",
    "app/friends.tsx",
    "app/listing/[id].tsx",
  ];

  for (const rel of consumers) {
    it(`${rel} no longer imports fetchProfileById directly`, () => {
      const src = readRepoFile(rel);
      assert.doesNotMatch(
        src,
        /import\s*\{[^}]*\bfetchProfileById\b[^}]*\}\s*from\s*"@\/lib\/supabase-profiles"/,
        `${rel} should resolve profiles via the SocialProvider cache`,
      );
    });

    it(`${rel} uses ensureProfilesLoaded from useSocial()`, () => {
      const src = readRepoFile(rel);
      assert.match(
        src,
        /\bensureProfilesLoaded\b/,
        `${rel} should call ensureProfilesLoaded`,
      );
    });
  }
});

describe("the admin tombstone reaches every reader of the profiles table", () => {
  /**
   * `deleteProfile` writes an id into a device-global set, and until
   * 2026-10-21 exactly three things read it — all of them inside the provider.
   * Every row the two people surfaces render comes from `fetchProfiles` or
   * `searchProfiles` instead, so the only list that honoured a deletion was
   * the one nothing on those screens uses.
   *
   * `social-provider-mounted.test.ts` runs the provider's half. These are the
   * two call sites, which cannot be mounted here and can be read.
   */
  const PEOPLE = readRepoFile("app", "people.tsx");
  const OVERLAY = readRepoFile("components", "search-overlay.tsx");

  it("exports the question rather than the set", () => {
    // The set stays internal — the provider says so about both of its sets —
    // and what leaves is what its readers outside the file actually have.
    assert.match(SOURCE, /isProfileDeleted: \(id: string\) => boolean;/);
    assert.match(
      SOURCE,
      /const isProfileDeleted = useCallback\(\s*\(profileId: string\) => deletedProfileIdSet\.has\(profileId\),/,
    );
    assert.ok(
      !/deletedProfileIds,?\s*$/m.test(SOURCE.split("const value = useMemo")[1] ?? ""),
      "the array itself is in the context value, which puts the scan back at the call sites",
    );
  });

  it("is the only reader of the set left inside the provider", () => {
    // Three inline `.has(...)` calls became one, so the next reader asks the
    // same question as the other three rather than a fourth copy of it.
    // Comment-stripped: the hook's own header writes the offending line out.
    assert.equal(stripComments(SOURCE).split("deletedProfileIdSet.has(").length - 1, 1);
  });

  it("the people screen drops a deleted profile from both halves of its list", () => {
    // One predicate, two rules, and the union is what applies it to the loaded
    // page and the server-wide half both: the screen filtered "not me" twice
    // by hand until 2026-10-21, which is the arrangement that let the tombstone
    // be forgotten in the first place.
    assert.match(
      PEOPLE,
      /const isListable = useCallback\(\s*\(profile: UserProfile\) => profile\.id !== myProfile\?\.id && !isProfileDeleted\(profile\.id\),/,
    );
    assert.match(PEOPLE, /remoteProfiles\.filter\(isListable\)/, "the loaded page it browses");
    assert.match(
      PEOPLE,
      /profileSearchUnion\(others, searchResults, needle, \{ isVisible: isListable \}\)/,
      "and both halves of the list it searches",
    );
  });

  it("the search sheet hands the same rule to the union", () => {
    assert.match(
      OVERLAY,
      /profileSearchUnion\(profiles, remoteMatches, needle, \{\s*isVisible: \(p\) => !isProfileDeleted\(p\.id\),\s*\}\)/,
    );
    assert.ok(
      !/\.filter\(\(p\) => !isProfileDeleted\(p\.id\)\)/.test(OVERLAY),
      "a per-half filter is back at the call site, which is where it got forgotten",
    );
  });

  it("makes the rule the union's to apply rather than each caller's to remember", () => {
    // Required, not defaulted — the reason `searchAnnouncement`'s `{ settled }`
    // is: a caller that forgot it would still work and would be wrong only
    // about the rows somebody decided nobody may see.
    assert.match(
      readRepoFile("lib", "profile-search.ts"),
      /needle: string,\s*\{ isVisible \}: \{ isVisible: \(profile: T\) => boolean \},/,
    );
    assert.match(
      readRepoFile("lib", "profile-search.ts"),
      /list\.filter\(\(p\) => isVisible\(p\) && profileMatchesSearch\(p, needle\)\)/,
    );
  });

  it("the profile screen decides showability before it fetches what belongs to the profile", () => {
    // `getProfileById` already answers `undefined` for a tombstoned id, so the
    // screen rendered "not found" and had still paid for the collections, the
    // wishlist and an item count per collection.
    const SCREEN = readRepoFile("app/profile/[id].tsx");
    assert.match(SCREEN, /if \(isProfileDeleted\(params\.id\)\) return;/);
    assert.match(
      SCREEN,
      /isProfileDeleted\(params\.id\)\) return;[\s\S]*?let active = true;/,
      "the gate has to come before the async work, not beside it",
    );
  });

  it("asks the provider rather than re-deriving the rule per surface", () => {
    for (const [label, src] of [["app/people.tsx", PEOPLE], ["components/search-overlay.tsx", OVERLAY]] as const) {
      assert.match(src, /isProfileDeleted/, `${label} does not consult the tombstone`);
      assert.ok(
        !/deletedProfileIds/.test(src),
        `${label} reads the tombstone ARRAY, which is the provider's own state`,
      );
    }
  });
});
