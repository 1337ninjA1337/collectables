import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  FALLBACK_PROFILE_EMAIL,
  FALLBACK_SLUG_SEED,
  resolveFallbackIdentity,
} from "@/lib/social-helpers";

import {
  assertDeclaredInEveryLocale,
  localeStrings,
} from "./helpers/i18n-locales";
import { readI18nSource } from "./helpers/i18n-source-file";
import { readRepoFile } from "./helpers/repo-file";

/**
 * The profile a person gets before a cloud row exists, and the two English
 * words that used to be in it.
 *
 * `buildFallbackProfile` in `lib/social-context.tsx` builds the profile shown
 * after sign-up and offline. Two of its fields are prose a person reads, and
 * both were English literals:
 *
 *  - `displayName` fell back to `"you"` — shown as a NAME, in English,
 *    whatever language the app was in. That string also happened to match a
 *    dead translation key of the same name, which is how it was found: the key
 *    was removed as an orphan and the literal underneath it turned out to be a
 *    live bug.
 *  - `bio` was a second copy of the sentence `app/profile/[id].tsx` keeps as
 *    `DEFAULT_EN_PROFILE_BIO` and translates on render.
 *
 * The two got different fixes on purpose, and the difference is the subject of
 * this suite. `displayName` is localised at WRITE time; `bio` is not, because
 * it is persisted and read by other people.
 */

const SOCIAL_CONTEXT = readRepoFile("lib/social-context.tsx");
const PROFILE_SCREEN = readRepoFile("app/profile/[id].tsx");

/**
 * The sentinel's value, read out of the source rather than imported.
 *
 * `lib/social-context.tsx` pulls React Native peers, which the `tsx --test`
 * harness cannot transform — the same reason `i18n-translation-coverage`
 * parses the translations file instead of importing it. Reading the literal
 * back means this suite is checking the committed text, which is what the
 * profile screen compares against at runtime anyway.
 */
const sentinelValue = (): string => {
  const match = /export const DEFAULT_EN_PROFILE_BIO =\s*\n?\s*"([^"]+)";/.exec(
    SOCIAL_CONTEXT,
  );
  assert.ok(match, "DEFAULT_EN_PROFILE_BIO is not a plain exported string literal");
  return match![1];
};

describe("the fallback identity chain, called rather than read", () => {
  const DEFAULT_NAME = "Коллекционер";

  it("prefers the session's full name above everything", () => {
    const identity = resolveFallbackIdentity(
      { email: "ada@example.com", fullName: "Ada Lovelace", userName: "ada_l" },
      DEFAULT_NAME,
    );
    assert.equal(identity.displayName, "Ada Lovelace");
    assert.equal(identity.username, "ada_l");
  });

  it("falls back to the email's local part before reaching for the key", () => {
    // The key is the LAST resort, not the first: somebody with an address
    // should be called by the name in it, which the translation must not
    // quietly replace.
    const identity = resolveFallbackIdentity({ email: "ada@example.com" }, DEFAULT_NAME);
    assert.equal(identity.displayName, "ada");
    assert.equal(identity.username, "ada");
    assert.equal(identity.email, "ada@example.com");
  });

  it("uses the translated default only when there is no name and no address", () => {
    // The bug this whole change exists for: this returned the English word
    // "you" as a person's NAME, in every language.
    const identity = resolveFallbackIdentity({}, DEFAULT_NAME);
    assert.equal(identity.displayName, DEFAULT_NAME);
  });

  it("treats an address with an empty local part as no address", () => {
    // `"@example.com".split("@")[0]` is `""`, which would otherwise become an
    // empty display name and an empty username — neither of which is a name.
    const identity = resolveFallbackIdentity({ email: "@example.com" }, DEFAULT_NAME);
    assert.equal(identity.displayName, DEFAULT_NAME);
    assert.equal(identity.slugSeed, FALLBACK_SLUG_SEED);
  });

  it("declares defaultDisplayName in every locale", () => {
    assertDeclaredInEveryLocale(readI18nSource(), "defaultDisplayName");
  });

  it("translates it rather than repeating the English word six times", () => {
    // The failure a per-locale declaration check cannot see: six declarations
    // all reading "Collector" would satisfy `assertDeclaredInEveryLocale` and
    // still show English to five of the six.
    const values = localeStrings(readI18nSource(), "defaultDisplayName");
    assert.equal(new Set(values.values()).size, values.size);
  });

  it("no longer reaches for the pronoun that used to be here", () => {
    assert.doesNotMatch(
      SOCIAL_CONTEXT,
      /\?\?\s*"you"/,
      'the fallback display name is an English literal again — a person with no email address and no full_name is shown the word "you" as their name, in every language',
    );
  });
});

describe("the slug fields stay ASCII, which is why they are not translated", () => {
  const CYRILLIC_DEFAULT = "Коллекционер";

  it("never seeds a slug from the translated display name", () => {
    // The regression this split prevents. A slug seeded from "Коллекционер"
    // survives `[^a-z0-9]` stripping as the empty string, and the slugifier's
    // last resort stamps a timestamp — so the user ends up with
    // `collector-1755…` as their public profile ID instead of a name.
    const identity = resolveFallbackIdentity({}, CYRILLIC_DEFAULT);
    assert.equal(identity.displayName, CYRILLIC_DEFAULT);
    assert.equal(identity.slugSeed, FALLBACK_SLUG_SEED);
    assert.equal(identity.username, FALLBACK_SLUG_SEED);
    assert.doesNotMatch(identity.slugSeed, /[^a-z0-9]/);
  });

  it("strips a real email's local part down to a usable username", () => {
    const identity = resolveFallbackIdentity({ email: "Ada.Lovelace+x@e.com" }, "Collector");
    assert.equal(identity.username, "adalovelacex");
    assert.equal(identity.displayName, "Ada.Lovelace+x");
  });

  it("uses the placeholder address only when the session has none", () => {
    assert.equal(resolveFallbackIdentity({}, "Collector").email, FALLBACK_PROFILE_EMAIL);
    assert.doesNotMatch(FALLBACK_PROFILE_EMAIL, /\byou\b/);
  });

  it("agrees with the other places that fall back to the same word", () => {
    // `normalizeProfile` and both slugifiers invent a name for a profile that
    // has none; a seed that disagreed would give one user two different
    // fallback identities depending on which path built the profile. They
    // agreed by three hand-written literals until the slug helpers moved to
    // `lib/social-helpers.ts`; the agreement is structural now, so this checks
    // the constant is IMPORTED rather than re-typed.
    assert.equal(FALLBACK_SLUG_SEED, "collector");
    assert.doesNotMatch(
      SOCIAL_CONTEXT,
      /\|\| "collector"/,
      "a hand-written copy of the fallback word is back alongside the constant",
    );
  });

  it("is what the screen-facing builder actually calls", () => {
    // The pure function can be perfect and unused. This is the wiring.
    assert.match(SOCIAL_CONTEXT, /resolveFallbackIdentity\(/);
    // The suffix argument is part of the wiring, not decoration: without it the
    // slugifier falls back to the wall clock and a Cyrillic-named account gets a
    // different public ID on every recompute of the profile memo.
    assert.match(
      SOCIAL_CONTEXT,
      /publicId: slugifyProfileId\(identity\.slugSeed, stableSuffix\(user\.id\)\)/,
    );
    assert.match(SOCIAL_CONTEXT, /t\("defaultDisplayName"\)/);
  });
});

describe("the default bio is one sentinel, translated on render", () => {
  it("is exported once and imported by the screen that translates it", () => {
    // The bug: two copies of one sentence, in two files, with nothing tying
    // them together. Rewording either would have left the screen comparing
    // against a sentence nothing writes any more, and the symptom would be a
    // bio that quietly stopped translating rather than an error.
    assert.match(SOCIAL_CONTEXT, /export const DEFAULT_EN_PROFILE_BIO =/);
    assert.match(
      PROFILE_SCREEN,
      /import \{ DEFAULT_EN_PROFILE_BIO, useSocial \} from "@\/lib\/social-context";/,
    );
    assert.doesNotMatch(
      PROFILE_SCREEN,
      /const DEFAULT_EN_PROFILE_BIO =/,
      "the screen declares its own copy of the sentinel again",
    );
  });

  it("is what the fallback profile actually writes", () => {
    // Without this the sentinel could be exported, imported, compared against
    // — and never produced, so the comparison would never match and the bio
    // would never translate.
    assert.match(SOCIAL_CONTEXT, /bio: DEFAULT_EN_PROFILE_BIO,/);
  });

  it("matches the English translation it is the sentinel for, exactly", () => {
    // The comparison is `===`, so a single character of drift between the
    // stored sentence and the `en` value silently stops the translation.
    const values = localeStrings(readI18nSource(), "defaultProfileBio");
    assert.equal(values.get("en"), sentinelValue());
  });

  it("is NOT localised at write time, unlike the display name", () => {
    // The counter-intuitive half, and the reason the two fields differ. The
    // bio is persisted and read by OTHER people, so a value written in the
    // author's language would be frozen in it — a Polish viewer would read
    // Russian. The display name is recomputed until the person edits it.
    assert.doesNotMatch(
      SOCIAL_CONTEXT,
      /bio: t\("defaultProfileBio"\)/,
      "the default bio is localised at write time now, so it is frozen in whatever language the author signed up in and every viewer reads that language instead of their own",
    );
  });

  it("is still translated on render, in both places the screen reads it", () => {
    const matches = PROFILE_SCREEN.match(
      /activeProfile\.bio === DEFAULT_EN_PROFILE_BIO \? t\("defaultProfileBio"\) : activeProfile\.bio/g,
    );
    assert.equal(
      matches?.length,
      2,
      "the screen renders the bio and seeds the edit draft from it; both have to translate the sentinel or the two disagree the moment somebody opens the editor",
    );
  });
});
