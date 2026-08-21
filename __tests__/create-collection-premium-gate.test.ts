import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readI18nSource } from "./helpers/i18n-source-file";
import { readRepoFile as read } from "./helpers/repo-file";

describe("create-collection screen: private collections require premium", () => {
  const src = read("app/create-collection.tsx");

  it("imports usePremium", () => {
    assert.match(src, /from\s+"@\/lib\/premium-context"/);
    assert.match(src, /usePremium\(\)/);
  });

  it("destructures isPremium from usePremium", () => {
    assert.match(src, /const\s+\{[^}]*isPremium[^}]*\}\s*=\s*usePremium\(\)/);
  });

  it("defaults visibility via the shared defaultCollectionVisibilityForUser helper", () => {
    assert.match(src, /from\s+"@\/lib\/premium-helpers"/);
    assert.match(
      src,
      /useState<CollectionVisibility>\(\s*defaultCollectionVisibilityForUser\(isPremium\),?\s*\)/,
    );
  });

  it("locks the Private chip for a non-premium user", () => {
    // The rule is `isPrivateVisibilityLocked`, called rather than matched (see
    // premium-visibility-lock.test.ts). What is a fact about THIS screen is
    // the value it passes for the saved visibility: a collection being created
    // has none, and `"public"` is what says it has no private history to
    // protect — the edit sheet's `?? "private"` here would unlock the chip for
    // every free user.
    assert.match(src, /isPrivateVisibilityLocked\(isPremium, "public"\)/);
    assert.match(src, /const locked = v === "private" && privateLocked;/);
    assert.match(src, /visibilityPrivatePremiumOnly/);
  });

  it("opens the premium upsell sheet (not a toast) when the locked Private chip is tapped", () => {
    assert.match(src, /from\s+"@\/components\/premium-upsell-sheet"/);
    assert.match(
      src,
      /function showPrivateUpsell\(\)[\s\S]{0,400}?setUpsellVisible\(true\)/,
    );
    assert.match(
      src,
      /if\s*\(locked\)\s*\{\s*showPrivateUpsell\(\);\s*return;\s*\}/,
    );
    // The sentence under the row is the same button. Its branch used to be
    // dead — it required `visibility === "private"` while not premium, which a
    // free user can never reach because the locked chip returns first.
    assert.match(src, /\{privateLocked \? \(\s*<Pressable\s*onPress=\{showPrivateUpsell\}/);
    assert.doesNotMatch(
      src,
      /!isPremium && visibility === "private"/,
      "the dead premium-hint branch is back",
    );
    assert.match(src, /<PremiumUpsellSheet/);
    // On activation from the sheet, the visibility flips to private for the user.
    assert.match(src, /onActivated=\{\(\)\s*=>\s*setVisibility\("private"\)\}/);
  });

  it("forces 'public' on save for non-premium users even if state somehow says 'private'", () => {
    assert.match(
      src,
      /finalVisibility[^=]*=\s*isPremium\s*\?\s*visibility\s*:\s*"public"/,
    );
    assert.match(src, /visibility:\s*finalVisibility/);
  });
});

describe("create-collection translations", () => {
  it("declares the premium-required visibility hint key in English", () => {
    const src = readI18nSource();
    assert.match(src, /visibilityPrivatePremiumOnly:/);
  });
});
