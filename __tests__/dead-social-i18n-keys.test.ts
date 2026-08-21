import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { assertNoLocaleDeclares } from "./helpers/i18n-locales";
import { readI18nSource } from "./helpers/i18n-source-file";
import { sourceCode, sourceFiles } from "./helpers/source-files";

/**
 * The fifteen social/people strings that outlived their screens, and the six
 * that never had one.
 *
 * An orphan scan over the base map found 35 keys with no reader anywhere in
 * `app/`, `components/`, `lib/`, `scripts/`, `data/`, `__tests__/` or `docs/`.
 * This is the first of the three families it named. They are dead in the way
 * translations are always dead — silently: every locale map opens with
 * `...en`, so `t("peopleTitle")` returns a non-empty string in all six
 * languages whether or not anything renders it, and no runtime assertion can
 * see the difference. Only the source can.
 *
 * The fifteen split into two groups, and the split is worth recording because
 * it says different things about the app:
 *
 *  - NINE had real call sites, added in the initial commit and deleted on
 *    2026-04-12 when `app/people.tsx` was rewritten and `app/friends.tsx` was
 *    added. `peopleTitle`, `peopleSubtitle`, `noPeopleFound`, `loadingPeople`,
 *    `noFriendsYet`, `noFriendsYetTab`, `noRequestsYet`, `noFollowingYet` and
 *    `subscribeToSeeCollections` are ordinary leftovers: the screens they
 *    belonged to now write their own strings.
 *  - SIX never had a call site in this repository's whole history —
 *    `friendBadge`, `followingBadge`, `invitationSent`, `searchFilterByOwner`,
 *    `profileIdHint` and `saveProfileId`. They are copy for UI that was never
 *    built: a friend/following badge on a profile row, a "By owner" search
 *    filter, and a "Save profile ID" field with its hint. `invitationSent` is
 *    the one of the whole family that was translated into all six locales, so
 *    four locales carried a translation for a string nobody ever rendered.
 *
 * Deleting them is the same edit either way, which is why they ship as one
 * change; the difference is what remains to be said, and the unbuilt six are
 * filed as a suggestion rather than quietly forgotten.
 *
 * Removing the family drops the base count 537 → 522 and `ru` 535 → 520, both
 * clear of their floor of 500, so `TRANSLATION_FLOORS` needs no re-measurement
 * here. The two families still outstanding (collections-list and feed/share,
 * 20 keys) do cross it — `ru` lands at 500 against a strictly-greater floor —
 * so whichever is removed last owns the floor re-measure.
 */

const DEAD_SOCIAL_KEYS = [
  // Rewritten away on 2026-04-12 with app/people.tsx and app/friends.tsx.
  "noFriendsYet",
  "noFriendsYetTab",
  "noRequestsYet",
  "noFollowingYet",
  "peopleTitle",
  "peopleSubtitle",
  "noPeopleFound",
  "loadingPeople",
  "subscribeToSeeCollections",
  // Never rendered by anything, in any commit: copy for UI that was not built.
  "friendBadge",
  "followingBadge",
  "invitationSent",
  "searchFilterByOwner",
  "profileIdHint",
  "saveProfileId",
] as const;

describe("the dead social/people i18n keys stay deleted", () => {
  it("no locale declares one of the fifteen", () => {
    assertNoLocaleDeclares(
      readI18nSource(),
      (key) => (DEAD_SOCIAL_KEYS as readonly string[]).includes(key),
      "these social/people strings were removed as dead copy — nine outlived " +
        "the screens that rendered them and six were never rendered at all; " +
        "a screen that needs one of these words should write its own key",
    );
  });

  it("nothing in the source tree names one of them", () => {
    // The half the absence pin cannot state on its own. Re-adding the KEY is
    // only half of a reintroduction, and the other half is the reader — the
    // orphan scan that found these walked the source tree, so the guard does
    // too, and names the file when one comes back.
    //
    // `sourceCode` rather than the raw text, so a comment recording why a key
    // was removed is not itself an offence; and the source tree only, not
    // `__tests__`, because this suite writes all fifteen names out.
    const offenders: string[] = [];
    for (const relative of sourceFiles()) {
      const code = sourceCode(relative);
      for (const key of DEAD_SOCIAL_KEYS) {
        if (new RegExp(`\\b${key}\\b`).test(code)) {
          offenders.push(`${relative}: ${key}`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `these files name a removed social/people key:\n  ${offenders.join("\n  ")}`,
    );
  });

  it("names each key once, so a duplicate cannot pad the list", () => {
    // The list is the rule here, not an illustration of it, and a name written
    // twice would make "fifteen" wrong while every assertion above stayed
    // green.
    assert.equal(new Set(DEAD_SOCIAL_KEYS).size, DEAD_SOCIAL_KEYS.length);
    assert.equal(DEAD_SOCIAL_KEYS.length, 15);
  });
});
