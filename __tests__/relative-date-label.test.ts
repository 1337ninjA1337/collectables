import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { relativeDateLabel } from "@/lib/i18n-context";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("relativeDateLabel helper", () => {
  it("joins prefix and when with a single space", () => {
    assert.equal(relativeDateLabel("Listed", "yesterday"), "Listed yesterday");
    assert.equal(relativeDateLabel("Acquired", "5 hours ago"), "Acquired 5 hours ago");
    assert.equal(relativeDateLabel("Member since", "March 2024"), "Member since March 2024");
  });

  it("trims surrounding whitespace from both fragments before joining", () => {
    assert.equal(relativeDateLabel(" Listed ", " yesterday "), "Listed yesterday");
    assert.equal(relativeDateLabel("Listed\t", "\nyesterday"), "Listed yesterday");
  });

  it("returns only the non-empty fragment when the other is blank", () => {
    assert.equal(relativeDateLabel("", "yesterday"), "yesterday");
    assert.equal(relativeDateLabel("Listed", ""), "Listed");
    assert.equal(relativeDateLabel("   ", "yesterday"), "yesterday");
    assert.equal(relativeDateLabel("Listed", "   "), "Listed");
  });

  it("returns an empty string when both fragments are blank", () => {
    assert.equal(relativeDateLabel("", ""), "");
    assert.equal(relativeDateLabel("  ", "\n\t"), "");
  });

  it("works with Cyrillic / German / Spanish prefixes (no language-specific formatting)", () => {
    assert.equal(relativeDateLabel("Размещено", "вчера"), "Размещено вчера");
    assert.equal(relativeDateLabel("Eingestellt", "gestern"), "Eingestellt gestern");
    assert.equal(relativeDateLabel("Publicado", "ayer"), "Publicado ayer");
  });

  it("does not introduce a trailing space when `when` is empty (regression guard)", () => {
    // The old `marketplaceListedAt` template emits "Listed " when `when` is
    // unset — the helper must not repeat that mistake.
    assert.equal(relativeDateLabel("Listed", ""), "Listed");
    assert.doesNotMatch(relativeDateLabel("Listed", ""), /\s$/);
  });
});

describe("relativeDateLabel context wiring", () => {
  it("is exported from lib/i18n-context.tsx so app code can import it directly", () => {
    const src = read("lib/i18n-context.tsx");
    assert.match(src, /export\s+function\s+relativeDateLabel\s*\(/);
  });

  it("is published on the I18nContext value shape so `useI18n()` consumers can call it", () => {
    const src = read("lib/i18n-context.tsx");
    // The provider value object spreads it next to formatRelativeDate.
    assert.match(src, /relativeDateLabel:\s*\(prefix:\s*string,\s*when:\s*string\)\s*=>\s*string/);
    assert.match(src, /relativeDateLabel,\s*\n\s*languageOptions/);
  });

  it("jsdoc references the six supported locales so the prefix-only contract is documented", () => {
    const src = read("lib/i18n-context.tsx");
    // Spot-check the jsdoc snippet near the function declaration.
    assert.match(src, /Russian\s+"Размещено вчера"/);
    assert.match(src, /English\s+"Listed yesterday"/);
  });
});
