import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readI18nSource } from "./helpers/i18n-source-file";
import { readRepoFile as read } from "./helpers/repo-file";

// HM-C3: the edit modal (and with it the locked-chip UI) moved into
// components/edit-collection-modal.tsx — the chip pins target the component,
// while the save-time clamp stays a page concern inside the hoisted
// handleSaveEdit (which guards on the still-nullable `collection`).
describe("collection edit modal: editing visibility public→private requires premium", () => {
  const modal = read("components/edit-collection-modal.tsx");
  const page = read("app/collection/[id].tsx");

  it("page imports usePremium, destructures isPremium, and threads it into the modal", () => {
    assert.match(page, /from\s+"@\/lib\/premium-context"/);
    assert.match(page, /const\s+\{[^}]*isPremium[^}]*\}\s*=\s*usePremium\(\)/);
    assert.match(page, /isPremium=\{\s*isPremium\s*\}/);
    assert.match(page, /savedVisibility=\{\s*activeCollection\.visibility\s*\}/);
  });

  it("locks the edit Private chip for non-premium users only when the collection isn't already private", () => {
    // The rule itself is `isPrivateVisibilityLocked`, called rather than
    // matched (see premium-visibility-lock.test.ts). What is a fact about THIS
    // file is which value it passes for an unknown saved visibility: `??
    // "private"` is what keeps a lapsed owner out of a locked sheet while the
    // collection loads, and passing `"public"` here — the create screen's
    // answer — would lock them out of their own private collection.
    assert.match(
      modal,
      /isPrivateVisibilityLocked\(isPremium,\s*savedVisibility\s*\?\?\s*"private"\)/,
    );
    assert.match(modal, /const locked = v === "private" && privateLocked;/);
  });

  it("toasts the premium-only hint when a locked edit chip is tapped", () => {
    // The chip and the sentence under the row now call one function, so the
    // assertion is that the padlock's behaviour is defined once and that the
    // chip reaches it.
    assert.match(
      modal,
      /function showPrivateUpsell\(\)[\s\S]{0,400}?toast\.error\(t\("visibilityPrivatePremiumOnly"\)/,
    );
    assert.match(
      modal,
      /if\s*\(locked\)\s*\{\s*showPrivateUpsell\(\);\s*return;\s*\}/,
    );
  });

  it("offers the same upsell from the sentence under the row", () => {
    // The branch that rendered this sentence was DEAD: it required
    // `visibility === "private"` while not premium, and a free user can never
    // get there — the locked chip returns before setting it. So the only place
    // the explanation appeared was a toast that has gone by the time somebody
    // looks back at the row.
    assert.match(
      modal,
      /\{privateLocked \? \(\s*<Pressable\s*onPress=\{showPrivateUpsell\}/,
    );
    assert.doesNotMatch(
      modal,
      /!isPremium\s*&&\s*visibility === "private"/,
      "the dead premium-hint branch is back",
    );
  });

  it("forces 'public' on save when a non-premium user tries to make a public collection private", () => {
    assert.match(
      page,
      /finalVisibility[^=]*=\s*\n?\s*!isPremium\s*&&\s*\n?\s*editVisibility\s*===\s*"private"\s*&&\s*\n?\s*\(collection\.visibility\s*\?\?\s*"private"\)\s*!==\s*"private"\s*\n?\s*\?\s*"public"\s*\n?\s*:\s*editVisibility/,
    );
    assert.match(page, /visibility:\s*finalVisibility/);
  });

  it("leaves an already-private collection untouched (no forced downgrade)", () => {
    // The guard predicate excludes already-private collections, so a lapsed
    // owner editing an unrelated field keeps the collection private — both
    // at chip level (component) and at save level (page clamp).
    assert.match(modal, /isPrivateVisibilityLocked\(isPremium,\s*savedVisibility\s*\?\?\s*"private"\)/);
    assert.match(page, /\(collection\.visibility\s*\?\?\s*"private"\)\s*!==\s*"private"/);
  });
});

describe("collection-edit premium-gate translations", () => {
  it("declares the premium-required visibility hint key in English", () => {
    const src = readI18nSource();
    assert.match(src, /visibilityPrivatePremiumOnly:/);
  });
});
