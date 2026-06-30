import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("collection detail screen: editing visibility public→private requires premium", () => {
  const src = read("app/collection/[id].tsx");

  it("imports usePremium and destructures isPremium", () => {
    assert.match(src, /from\s+"@\/lib\/premium-context"/);
    assert.match(src, /const\s+\{[^}]*isPremium[^}]*\}\s*=\s*usePremium\(\)/);
  });

  it("locks the edit Private chip for non-premium users only when the collection isn't already private", () => {
    // The lock targets the public→private transition: not premium AND the
    // existing collection is not already private.
    assert.match(
      src,
      /v\s*===\s*"private"\s*&&\s*!isPremium\s*&&\s*\(activeCollection\.visibility\s*\?\?\s*"private"\)\s*!==\s*"private"/,
    );
  });

  it("toasts the premium-only hint when a locked edit chip is tapped", () => {
    assert.match(src, /if\s*\(locked\)\s*\{\s*toast\.error\(t\("visibilityPrivatePremiumOnly"\)/);
  });

  it("forces 'public' on save when a non-premium user tries to make a public collection private", () => {
    assert.match(
      src,
      /finalVisibility[^=]*=\s*\n?\s*!isPremium\s*&&\s*\n?\s*editVisibility\s*===\s*"private"\s*&&\s*\n?\s*\(activeCollection\.visibility\s*\?\?\s*"private"\)\s*!==\s*"private"\s*\n?\s*\?\s*"public"\s*\n?\s*:\s*editVisibility/,
    );
    assert.match(src, /visibility:\s*finalVisibility/);
  });

  it("leaves an already-private collection untouched (no forced downgrade)", () => {
    // The guard predicate excludes already-private collections, so a lapsed
    // owner editing an unrelated field keeps the collection private.
    assert.match(src, /\(activeCollection\.visibility\s*\?\?\s*"private"\)\s*!==\s*"private"/);
  });
});

describe("collection-edit premium-gate translations", () => {
  it("declares the premium-required visibility hint key in English", () => {
    const src = read("lib/i18n-context.tsx");
    assert.match(src, /visibilityPrivatePremiumOnly:/);
  });
});
