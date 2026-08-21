import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { collectStringLiterals } from "@/lib/check-orphan-i18n-keys";

import { assertNoLocaleDeclares } from "./helpers/i18n-locales";
import { readI18nSource } from "./helpers/i18n-source-file";
import { sourceCode, sourceFiles } from "./helpers/source-files";

/**
 * The translation keys that were removed as dead, and stay removed.
 *
 * An orphan scan over the base map found 35 keys with no reader anywhere in
 * `app/`, `components/`, `lib/`, `scripts/`, `data/`, `__tests__/` or `docs/`,
 * in three families; `check-orphan-i18n-keys` — the guard that scan became —
 * found a 36th on its first run and a 37th when its rule was tightened from "a
 * literal anywhere" to "a literal in a key position". They are dead in the way
 * translations are always dead —
 * silently: every locale map opens with `...en`, so `t("peopleTitle")` returns
 * a non-empty string in all six languages whether or not anything renders it,
 * and no runtime assertion can see the difference. Only the source can.
 *
 * A TABLE rather than a suite per family, and the second family is what earned
 * it. This file shipped a day earlier as `dead-social-i18n-keys.test.ts` with
 * one family written out flat; the collections-list family arriving the next
 * morning would have been a second copy of the same three cases, and the
 * feed/share family a third. What varies between them is a list of names and a
 * paragraph saying where they came from — so that is what the table holds, and
 * the walk of the source tree (the expensive half) now happens once for all
 * families instead of once per family.
 *
 * Two things are pinned per family, because re-adding the KEY is only half of
 * a reintroduction:
 *  - no locale map declares one of its names, and
 *  - nothing in the source tree names one either, so a screen reviving the
 *    string has to bring back its reader too.
 */

type RemovedFamily = {
  /** What the family is called in the removal task and in failure messages. */
  readonly name: string;
  /** What a contributor who trips this should do instead. */
  readonly instead: string;
  /** Every key removed with it. */
  readonly keys: readonly string[];
};

const REMOVED_FAMILIES: readonly RemovedFamily[] = [
  {
    name: "social/people",
    instead:
      "nine outlived the screens that rendered them and six were never " +
      "rendered at all; a screen that needs one of these words should write " +
      "its own key",
    keys: [
      // Rewritten away in `8b35e1b` (2026-04-12) with app/people.tsx and
      // app/friends.tsx.
      "noFriendsYet",
      "noFriendsYetTab",
      "noRequestsYet",
      "noFollowingYet",
      "peopleTitle",
      "peopleSubtitle",
      "noPeopleFound",
      "loadingPeople",
      "subscribeToSeeCollections",
      // Never rendered by anything, in any commit: copy for a friend/following
      // badge on a profile row, a "By owner" search filter, and a "Save
      // profile ID" field with its hint. `invitationSent` is the one of the
      // fifteen that was translated into all six locales, so four languages
      // carried a translation for a string nobody ever rendered.
      "friendBadge",
      "followingBadge",
      "invitationSent",
      "searchFilterByOwner",
      "profileIdHint",
      "saveProfileId",
      // The sixteenth, found by `check-orphan-i18n-keys` on its first run
      // rather than by the hand scans — it is the LABEL of the same
      // never-built "Save profile ID" field as the two keys above it, and
      // three scratch scans counted it as read because
      // `lib/social-context.tsx` declares six `(profileId: string)`
      // parameters. Bare-word matching could not tell a parameter name from a
      // key reference; the guard's string-literal rule can.
      "profileId",
    ],
  },
  {
    name: "collections-list",
    instead:
      "six outlived the collections list that rendered them and four were " +
      "never rendered at all; the list screens write their own strings now",
    keys: [
      // Five lost their call sites in `8b35e1b` (2026-04-12) alongside the
      // social family, and `loadingCollections` a fortnight later in `6bfbfd1`
      // (2026-05-01, "implement new design") — the same rewrite reaching the
      // collections list rather than the people screens.
      "noOwnedCollections",
      "noFriendCollections",
      "noSubscribedCollections",
      "yourCollection",
      "sharedToYou",
      "loadingCollections",
      // Never rendered in any commit: the header and subtitle of an "Opened
      // for you" section, its empty state, and a bare "items" stat label.
      // `yourCollection`, `sharedToYou` and `openedForYou` are the reason this
      // family reaches past `en`/`ru`: they were translated into be/pl/de/es
      // (es has the first two) for a section that was never built.
      "openedForYou",
      "openedForYouSubtitle",
      "noSharedCollections",
      "statsItems",
    ],
  },
  {
    name: "feed/share",
    instead:
      "three outlived their screens and seven were never rendered at all; " +
      "the discover feed and the share-with-users sheet this copy describes " +
      "were not built",
    keys: [
      // Lost their call sites in the same 2026-04-12 / 2026-05-01 rewrites.
      "tabDiscover",
      "needMoreDataItemText",
      "needTitleText",
      // Never rendered in any commit: an empty discover feed with its hint and
      // call to action, a "share with users" sheet with its hint and empty
      // state, and a picker placeholder.
      "emptyFeedTitle",
      "emptyFeedHint",
      "discoverCta",
      "shareWithUsers",
      "shareWithUsersHint",
      "noUsersToShare",
      // NOT part of the `condition*` family the three dynamic `t()` call sites
      // build. Those spell their union out — `as "conditionNew" |
      // "conditionExcellent" | "conditionGood" | "conditionFair"` — and this
      // is not in it. The closest any of the 35 came to a false positive, so
      // it was read at the call site rather than trusted to the scan.
      "conditionPlaceholder",
    ],
  },
  {
    name: "self-label",
    instead:
      "`you` was a bare pronoun rendered by nothing; a screen marking the " +
      "current user's own row should write a key that says what the row IS " +
      "rather than reviving a word with no context",
    keys: [
      // The 37th, and the one that proved the guard's own blind spot was
      // worth measuring rather than merely documenting. Under the shipped
      // "appears as a string literal anywhere" rule it counted as read,
      // because `lib/social-context.tsx` derives a default display name with
      // `user.email?.split("@")[0] ?? "you"` — a fallback VALUE that has
      // nothing to do with the key. Tightening the rule to key POSITIONS
      // reported it, and it was translated into all six locales for a string
      // nobody renders. A family of one, because it belongs to none of the
      // three sweeps above.
      "you",
    ],
  },
];

/** Every removed key, across families — the table flattened once. */
const ALL_REMOVED = REMOVED_FAMILIES.flatMap((family) =>
  family.keys.map((key) => ({ key, family: family.name })),
);

describe("the i18n keys removed as dead stay deleted", () => {
  const src = readI18nSource();

  for (const family of REMOVED_FAMILIES) {
    it(`no locale declares one of the ${family.keys.length} ${family.name} keys`, () => {
      assertNoLocaleDeclares(
        src,
        (key) => (family.keys as readonly string[]).includes(key),
        `these ${family.name} strings were removed as dead copy — ${family.instead}`,
      );
    });
  }

  it("nothing in the source tree names a removed key", () => {
    // The half the absence pins cannot state on their own, and the reason the
    // walk lives outside the per-family loop: it reads every source file once
    // for all families rather than once each.
    //
    // Matched through `collectStringLiterals` — the SAME rule
    // `check-orphan-i18n-keys` uses to decide a key is read — rather than the
    // `\bkey\b` this case shipped with. The two disagreeing is what let
    // `profileId` hide: bare-word matching counted it as named because
    // `lib/social-context.tsx` declares six `(profileId: string)` PARAMETERS,
    // and adding the key to the table above turned this case red for exactly
    // that reason. One rule with two consumers means "the guard says this key
    // is dead" and "this suite says it stays dead" can no longer be answered
    // differently.
    //
    // `sourceCode` still strips comments first, so a comment recording why a
    // key was removed is not an offence; and the source tree only, not
    // `__tests__`, because this suite writes every removed name out.
    const offenders: string[] = [];
    for (const relative of sourceFiles()) {
      const literals = collectStringLiterals(sourceCode(relative));
      for (const { key, family } of ALL_REMOVED) {
        if (literals.has(key)) {
          offenders.push(`${relative}: ${key} (${family})`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `these files name a removed i18n key:\n  ${offenders.join("\n  ")}`,
    );
  });

  it("names each key once across the whole table", () => {
    // Deliberately across families rather than within one. A name written
    // twice inside a family makes its count wrong; a name written in TWO
    // families makes both counts wrong and hides which removal owns it — and
    // that is the mistake a table invites, since the families were removed a
    // day apart from one scan's output.
    const duplicates = ALL_REMOVED.map(({ key }) => key).filter(
      (key, index, all) => all.indexOf(key) !== index,
    );
    assert.deepEqual(duplicates, []);
    assert.equal(ALL_REMOVED.length, 37);
  });

  it("accounts for every key the orphan scan found", () => {
    // The hand scans reported 35 across three families;
    // `check-orphan-i18n-keys` found a 36th on its first run and a 37th when
    // its rule was tightened from "a literal anywhere" to "a literal in a key
    // position". Stated as its own case because the count above would still
    // pass on a table that lost a whole family: 37 is the finding, and this is
    // where it is written down.
    assert.equal(REMOVED_FAMILIES.length, 4);
    assert.equal(
      REMOVED_FAMILIES.reduce((sum, family) => sum + family.keys.length, 0),
      37,
    );
  });

  it("every family says what it is and what to do instead", () => {
    // The `instead` clause is the whole value of a failure here: the key is
    // gone on purpose, so "this key does not exist" is not news — where to go
    // next is. An empty one would leave the message trailing off after a dash.
    for (const family of REMOVED_FAMILIES) {
      assert.ok(family.name.trim().length > 0);
      assert.ok(
        family.instead.trim().length > 20,
        `'${family.name}' carries no instruction for whoever trips it`,
      );
      assert.ok(family.keys.length > 0);
    }
  });
});
