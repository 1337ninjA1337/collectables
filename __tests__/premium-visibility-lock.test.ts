import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  clampVisibilityForSave,
  isPrivateVisibilityLocked,
  visibilityHintKey,
} from "@/lib/premium-helpers";

import { readRepoFile } from "./helpers/repo-file";

/**
 * The premium lock on "private", and the sentence that was supposed to explain
 * it.
 *
 * Both visibility rows — `app/create-collection.tsx` and
 * `components/edit-collection-modal.tsx` — wrote this rule out for themselves,
 * and their copies had already drifted: the create screen locked on
 * `!isPremium` alone, the edit sheet on `!isPremium && (savedVisibility ??
 * "private") !== "private"`. Only source text asserted either, so the two
 * could not be compared and neither could be exercised.
 *
 * The bug that came out of the drift is the interesting part. Both files chose
 * the hint under the row with `!isPremium && visibility === "private"`, and a
 * free user can never reach that state — the locked chip calls the upsell and
 * returns BEFORE setting the visibility. So the branch explaining the padlock
 * was dead in both screens, in six languages, and the only place the sentence
 * ever appeared was a toast that has gone by the time somebody looks back at
 * the row.
 */

describe("locking the private option", () => {
  it("never locks a premium user", () => {
    assert.equal(isPrivateVisibilityLocked(true, "public"), false);
    assert.equal(isPrivateVisibilityLocked(true, "private"), false);
  });

  it("locks a free user who is not already private", () => {
    assert.equal(isPrivateVisibilityLocked(false, "public"), true);
  });

  it("never locks an already-private collection", () => {
    // The lapsed-subscriber case, and the reason the rule takes the SAVED
    // visibility rather than the selected one: somebody whose subscription
    // ended keeps what they already made private instead of being pushed to
    // publish it.
    assert.equal(isPrivateVisibilityLocked(false, "private"), false);
  });
});

describe("the sentence under the row", () => {
  it("describes the current selection, both ways", () => {
    assert.equal(visibilityHintKey("public"), "visibilityPublicHint");
    assert.equal(visibilityHintKey("private"), "visibilityPrivateHint");
  });

  it("does not depend on premium, which is what made the old branch dead", () => {
    // Stated as a case because it is the whole shape of the fix: the lock adds
    // a SECOND line, it does not replace the first. Choosing one sentence for
    // both jobs is what put the explanation behind a state a free user cannot
    // reach — and it would also have traded away "public collections are
    // visible to everyone", which is the useful half for the user who is
    // actually looking at a public collection.
    assert.equal(visibilityHintKey("public"), "visibilityPublicHint");
  });
});

describe("both screens call the rule instead of restating it", () => {
  const create = readRepoFile("app/create-collection.tsx");
  const modal = readRepoFile("components/edit-collection-modal.tsx");

  it("passes the saved visibility each screen actually has", () => {
    // The one thing that legitimately differs, and it is a decision per screen
    // rather than a parameter of the rule: a collection being created has no
    // saved value and no private history to protect, so `"public"`; the edit
    // sheet's can be momentarily unknown while the collection loads, so
    // `?? "private"` errs toward not locking an owner out of their own sheet.
    assert.match(create, /isPrivateVisibilityLocked\(isPremium, "public"\)/);
    assert.match(
      modal,
      /isPrivateVisibilityLocked\(isPremium,\s*savedVisibility\s*\?\?\s*"private"\)/,
    );
  });

  it("leaves no hand-written copy of either rule behind", () => {
    for (const [name, src] of [
      ["app/create-collection.tsx", create],
      ["components/edit-collection-modal.tsx", modal],
    ] as const) {
      assert.doesNotMatch(
        src,
        /!isPremium && visibility === "private"/,
        `${name} still chooses its hint with the dead premium condition`,
      );
      assert.doesNotMatch(
        src,
        /t\("visibilityPublicHint"\)/,
        `${name} still names a per-selection hint key instead of calling visibilityHintKey`,
      );
    }
  });

  it("offers the upsell from the sentence as well as from the chip", () => {
    // Same handler from both, which is the point: a sighted user who reads
    // "private is a premium feature" and taps it gets the upsell, where before
    // they got nothing because the words were not a control.
    for (const [name, src] of [
      ["app/create-collection.tsx", create],
      ["components/edit-collection-modal.tsx", modal],
    ] as const) {
      assert.match(
        src,
        /function showPrivateUpsell\(control: PremiumUpsellControl\)/,
        `${name} has no shared handler`,
      );
      assert.match(
        src,
        /if\s*\(locked\)\s*\{\s*showPrivateUpsell\("chip"\);\s*return;\s*\}/,
        `${name}'s chip no longer calls the shared handler`,
      );
      assert.match(
        src,
        /\{privateLocked \? \(\s*<Pressable\s*onPress=\{\(\) => showPrivateUpsell\("hint"\)\}/,
        `${name}'s locked hint is not a button`,
      );
    }
  });

  it("keeps the upsell's analytics source distinct per screen", () => {
    // Moving the body into a named function is exactly where two call sites
    // quietly become one event: the funnel distinguishes the create screen
    // from the edit sheet, and `premium_upsell_shown` is what the standing
    // "hide the locked chip" decision is waiting on.
    assert.match(create, /source: "create_collection"/);
    assert.match(modal, /source: "collection_edit"/);
  });

  it("tags the event with which of the two controls fired it", () => {
    // The other half of the same problem, one level down. The chip and the
    // sentence send the same feature AND the same source, so before `control`
    // the two were indistinguishable in the dashboard — and the standing
    // decision is specifically about the CHIP. Taps on the sentence would have
    // kept it alive forever.
    for (const [name, src] of [
      ["app/create-collection.tsx", create],
      ["components/edit-collection-modal.tsx", modal],
    ] as const) {
      assert.match(
        src,
        /trackEvent\("premium_upsell_shown",\s*\{[^}]*\bcontrol,/,
        `${name} no longer forwards which control fired the upsell`,
      );
      // Forwarding the argument is worth nothing if both call sites pass the
      // same literal, and "chip" is the one a copy-paste lands on — the funnel
      // would then look exactly as it did before, with a name on it.
      assert.match(src, /showPrivateUpsell\("chip"\)/, `${name}'s chip is untagged`);
      assert.match(src, /showPrivateUpsell\("hint"\)/, `${name}'s sentence is untagged`);
    }
  });

  it("acknowledges the press on the sentence, which is not obviously a button", () => {
    // A line of text acting as a button, with no ripple and a 20px-tall touch
    // target, is the shape most likely to feel broken on a phone. Both halves
    // are asserted because either alone leaves it feeling dead: the hit-slop
    // makes it hittable, the pressed style makes the hit visible.
    for (const [name, src, style] of [
      ["app/create-collection.tsx", create, "visibilityLockedHintPressed"],
      ["components/edit-collection-modal.tsx", modal, "editVisibilityLockedHintPressed"],
    ] as const) {
      assert.match(src, /hitSlop=\{8\}/, `${name}'s locked hint has no hit-slop`);
      assert.match(
        src,
        new RegExp(`style=\\{\\(\\{ pressed \\}\\) => \\(pressed \\? styles\\.${style} : null\\)\\}`),
        `${name}'s locked hint gives no feedback on press`,
      );
      assert.match(
        src,
        new RegExp(`${style}: \\{\\s*opacity: 0\\.6,`),
        `${name} declares no pressed style for the locked hint`,
      );
    }
  });
});

describe("what a save is allowed to write", () => {
  it("leaves every selection alone for a premium user", () => {
    assert.equal(clampVisibilityForSave(true, "private", "public"), "private");
    assert.equal(clampVisibilityForSave(true, "public", "private"), "public");
  });

  it("clamps a free user's public → private to public", () => {
    assert.equal(clampVisibilityForSave(false, "private", "public"), "public");
  });

  it("leaves an already-private collection private for a lapsed subscriber", () => {
    // The same case the lock exists for, restated at save time: this is where
    // an over-eager clamp would silently PUBLISH a collection somebody made
    // private while they were paying.
    assert.equal(clampVisibilityForSave(false, "private", "private"), "private");
  });

  it("never clamps a selection of public, whatever it was saved as", () => {
    // Going private → public is a downgrade the free tier allows; a clamp that
    // fired on it would trap the collection in whichever state it was in.
    assert.equal(clampVisibilityForSave(false, "public", "private"), "public");
    assert.equal(clampVisibilityForSave(false, "public", "public"), "public");
  });

  it("agrees with the lock the chip renders, on every combination", () => {
    // Stated as an exhaustive case rather than by inspection, because the two
    // disagreeing is precisely the bug the three inline clauses could grow: a
    // chip that refuses a change the save would have allowed reads as broken,
    // and a chip that allows one the save silently reverts is worse.
    for (const isPremium of [true, false]) {
      for (const saved of ["public", "private"] as const) {
        const locked = isPrivateVisibilityLocked(isPremium, saved);
        assert.equal(
          clampVisibilityForSave(isPremium, "private", saved),
          locked ? "public" : "private",
          `clamp disagrees with the chip at isPremium=${isPremium}, saved=${saved}`,
        );
      }
    }
  });

  it("is not symmetric in its two visibility arguments", () => {
    // Both are `CollectionVisibility`, so swapping the call's last two
    // arguments type-checks and clamps the wrong direction in silence. This is
    // the pair that tells them apart.
    assert.equal(clampVisibilityForSave(false, "private", "public"), "public");
    assert.equal(clampVisibilityForSave(false, "public", "private"), "public");
  });

  it("is what the collection screen actually saves through", () => {
    // The clamp is defence in depth and unreachable through the UI today
    // (`openEditModal` seeds the selection from the collection, and the locked
    // chip returns before changing it), which is exactly why it needs pinning:
    // nothing exercises it at runtime, so a regression to a fourth hand-written
    // spelling would look like working code forever.
    const page = readRepoFile("app/collection/[id].tsx");
    assert.match(
      page,
      /clampVisibilityForSave\(\s*isPremium,\s*editVisibility,\s*collection\.visibility \?\? "private",\s*\)/,
    );
    assert.doesNotMatch(
      page,
      /!isPremium &&\s*editVisibility === "private"/,
      "the save clamp still spells the lock out for itself",
    );
  });
});
