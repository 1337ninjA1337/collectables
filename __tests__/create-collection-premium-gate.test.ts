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

  it("defaults visibility to 'public' for non-premium users", () => {
    assert.match(src, /useState<CollectionVisibility>\(\s*isPremium\s*\?\s*"private"\s*:\s*"public",?\s*\)/);
  });

  it("locks the Private chip and toasts the premium-only hint when tapped by a non-premium user", () => {
    assert.match(src, /locked\s*=\s*v\s*===\s*"private"\s*&&\s*!isPremium/);
    assert.match(src, /visibilityPrivatePremiumOnly/);
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
