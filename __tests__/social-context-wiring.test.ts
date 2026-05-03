import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural / wiring tests for `lib/social-context.tsx`.
 *
 * The provider is a React component so we can't exercise its runtime under
 * `node --test`. Instead we read the source and assert that the
 * viewer-profile cache lives at the provider level (not inline in screens),
 * that `getProfileById` consults that cache, and that consumers route their
 * profile lookups through the new `ensureProfilesLoaded` helper.
 */

const ROOT = process.cwd();
const SOURCE = readFileSync(path.join(ROOT, "lib", "social-context.tsx"), "utf8");

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
    assert.match(
      SOURCE,
      /getProfileById:\s*\(id\)\s*=>\s*profileById\.get\(id\)\s*\?\?\s*viewerProfiles\[id\]\?\.profile/,
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
      const src = readFileSync(path.join(ROOT, rel), "utf8");
      assert.doesNotMatch(
        src,
        /import\s*\{[^}]*\bfetchProfileById\b[^}]*\}\s*from\s*"@\/lib\/supabase-profiles"/,
        `${rel} should resolve profiles via the SocialProvider cache`,
      );
    });

    it(`${rel} uses ensureProfilesLoaded from useSocial()`, () => {
      const src = readFileSync(path.join(ROOT, rel), "utf8");
      assert.match(
        src,
        /\bensureProfilesLoaded\b/,
        `${rel} should call ensureProfilesLoaded`,
      );
    });
  }
});
