import { describe, it } from "node:test";
import assert from "node:assert/strict";

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

describe("the fallback profile's display name is translated", () => {
  it("reads defaultDisplayName rather than an English literal", () => {
    assert.match(SOCIAL_CONTEXT, /t\("defaultDisplayName"\)/);
    assert.doesNotMatch(
      SOCIAL_CONTEXT,
      /\?\?\s*"you"/,
      'the fallback display name is an English literal again — a person with no email address and no full_name is shown the word "you" as their name, in every language',
    );
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

  it("falls back to the email's local part before reaching for the key", () => {
    // The key is the LAST resort, not the first: somebody with an address
    // should be called by the name in it, which is what the code did before
    // and what the translation must not quietly replace.
    assert.match(
      SOCIAL_CONTEXT,
      /const emailName = user\.email\?\.split\("@"\)\[0\];/,
    );
    assert.match(
      SOCIAL_CONTEXT,
      /full_name[\s\S]{0,80}\?\?\s*\n?\s*emailName\s*\?\?\s*\n?\s*t\("defaultDisplayName"\)/,
      "the order of the fallback chain changed — full_name, then the email's local part, then the translated default",
    );
  });
});

describe("the slug fields stay ASCII, which is why they are not translated", () => {
  it("seeds username and publicId from a constant, not from the translated name", () => {
    // `slugifyProfileId` strips everything outside [a-z0-9], so seeding a slug
    // from a translated word leaves a Russian or Belarusian user with an empty
    // slug rescued into `collector-<timestamp>` — a worse profile ID than the
    // one they had. This is the assertion that would fail if somebody
    // "finished the job" by translating the other three fields too.
    assert.match(SOCIAL_CONTEXT, /const FALLBACK_SLUG_SEED = "collector";/);
    assert.match(SOCIAL_CONTEXT, /const slugSeed = emailName \?\? FALLBACK_SLUG_SEED;/);
    assert.match(SOCIAL_CONTEXT, /publicId: slugifyProfileId\(slugSeed\)/);
  });

  it("agrees with the two other places that fall back to the same word", () => {
    // `normalizeProfile` and `ensureUniqueUsername` already default to
    // "collector"; a seed that disagreed would give one user two different
    // fallback identities depending on which path built the profile.
    assert.match(SOCIAL_CONTEXT, /\|\| "collector";/);
    assert.match(SOCIAL_CONTEXT, /\|\| `collector_\$\{Date\.now\(\)\}`/);
  });

  it("no longer seeds the placeholder email from a pronoun", () => {
    assert.match(SOCIAL_CONTEXT, /"collector@collectables\.app"/);
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
