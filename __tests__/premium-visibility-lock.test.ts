import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
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
      assert.match(src, /function showPrivateUpsell\(\)/, `${name} has no shared handler`);
      assert.match(
        src,
        /if\s*\(locked\)\s*\{\s*showPrivateUpsell\(\);\s*return;\s*\}/,
        `${name}'s chip no longer calls the shared handler`,
      );
      assert.match(
        src,
        /\{privateLocked \? \(\s*<Pressable\s*onPress=\{showPrivateUpsell\}/,
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
});
