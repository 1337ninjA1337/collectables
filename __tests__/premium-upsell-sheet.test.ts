import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("PremiumUpsellSheet component", () => {
  const src = read("components/premium-upsell-sheet.tsx");

  it("renders inside a Modal so it overlays the screen", () => {
    assert.match(src, /import\s*\{[^}]*\bModal\b[^}]*\}\s*from\s*"react-native"/);
    assert.match(src, /<Modal[^>]*transparent/);
  });

  it("pulls activatePremium from the premium context", () => {
    assert.match(src, /from\s+"@\/lib\/premium-context"/);
    assert.match(src, /const\s+\{[^}]*activatePremium[^}]*\}\s*=\s*usePremium\(\)/);
  });

  it("activates premium, toasts success, closes, then notifies the caller", () => {
    // Ordering matters: close before onActivated so the caller's state update
    // (e.g. flip visibility) lands while the sheet is already dismissed.
    assert.match(
      src,
      /activatePremium\(source \?\? "upsell_sheet"\);\s*toast\.success\(t\("premiumActivated"\)\);\s*onClose\(\);\s*onActivated\?\.\(\);/,
    );
  });

  it("offers a non-destructive 'Maybe later' dismissal wired to onClose", () => {
    assert.match(src, /premiumUpsellLater/);
    assert.match(src, /onPress=\{onClose\}/);
  });

  it("lists the existing premium benefits instead of re-inventing copy", () => {
    assert.match(src, /premiumBenefit1/);
    assert.match(src, /premiumBenefit2/);
    assert.match(src, /premiumBenefit3/);
    assert.match(src, /t\("premiumActivate"\)/);
  });

  it("falls back to generic premium title/body when none is passed", () => {
    assert.match(src, /title\s*\?\?\s*t\("premiumTitle"\)/);
    assert.match(src, /body\s*\?\?\s*t\("premiumSubtitle"\)/);
  });
});

describe("premium upsell translations", () => {
  const src = read("lib/i18n-context.tsx");
  const langs = ["en", "ru", "be", "pl", "de", "es"] as const;

  // The new upsell keys must exist in every language (or be inherited via
  // `...en`). Since en is the spread base, asserting en + a per-language count
  // ensures no language renders an undefined string.
  for (const key of [
    "premiumUpsellPrivateTitle",
    "premiumUpsellPrivateBody",
    "premiumUpsellLater",
  ]) {
    it(`declares ${key} in all ${langs.length} language maps`, () => {
      const count = src.split(`${key}:`).length - 1;
      assert.equal(
        count,
        langs.length,
        `expected ${key} in ${langs.length} languages, found ${count}`,
      );
    });
  }
});
