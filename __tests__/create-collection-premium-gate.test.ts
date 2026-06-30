import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

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
    assert.match(src, /locked\s*=\s*v\s*===\s*"private"\s*&&\s*!isPremium/);
    assert.match(src, /visibilityPrivatePremiumOnly/);
  });

  it("opens the premium upsell sheet (not a toast) when the locked Private chip is tapped", () => {
    assert.match(src, /from\s+"@\/components\/premium-upsell-sheet"/);
    assert.match(src, /if\s*\(locked\)\s*\{\s*setUpsellVisible\(true\)/);
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
    const src = read("lib/i18n-context.tsx");
    assert.match(src, /visibilityPrivatePremiumOnly:/);
  });
});
