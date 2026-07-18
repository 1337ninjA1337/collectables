import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

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
    // The lock targets the public→private transition: not premium AND the
    // persisted visibility (the savedVisibility prop) is not already private.
    assert.match(
      modal,
      /v\s*===\s*"private"\s*&&\s*!isPremium\s*&&\s*\(savedVisibility\s*\?\?\s*"private"\)\s*!==\s*"private"/,
    );
  });

  it("toasts the premium-only hint when a locked edit chip is tapped", () => {
    assert.match(
      modal,
      /if\s*\(locked\)\s*\{(?:(?!\}\s*onChangeVisibility)[\s\S])*?toast\.error\(t\("visibilityPrivatePremiumOnly"\)/,
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
    assert.match(modal, /\(savedVisibility\s*\?\?\s*"private"\)\s*!==\s*"private"/);
    assert.match(page, /\(collection\.visibility\s*\?\?\s*"private"\)\s*!==\s*"private"/);
  });
});

describe("collection-edit premium-gate translations", () => {
  it("declares the premium-required visibility hint key in English", () => {
    const src = read("lib/i18n-context.tsx");
    assert.match(src, /visibilityPrivatePremiumOnly:/);
  });
});
