import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("listing-detail absolute-date tooltip wiring", () => {
  const src = read("app/listing/[id].tsx");

  it("imports useToast from toast-context", () => {
    assert.match(src, /import\s*\{\s*useToast\s*\}\s*from\s*"@\/lib\/toast-context"/);
  });

  it("destructures formatAbsoluteDate from useI18n()", () => {
    assert.match(src, /formatAbsoluteDate[^}]*\}\s*=\s*useI18n\(\)/);
  });

  it("wraps the 'Listed X ago' Text in a Pressable that long-presses to a toast", () => {
    // The Pressable must be tied to listing.createdAt and call toast.info with the
    // formatAbsoluteDate of that ISO.
    assert.match(
      src,
      /onLongPress=\{\s*\(\)\s*=>\s*toast\.info\(\s*formatAbsoluteDate\(listing\.createdAt\)\s*\)\s*\}/,
    );
  });

  it("exposes the absolute date as the Pressable's accessibilityLabel", () => {
    assert.match(
      src,
      /accessibilityLabel=\{\s*formatAbsoluteDate\(listing\.createdAt\)\s*\}/,
    );
  });

  it("forwards a `title` HTML attribute on web only (hover tooltip)", () => {
    assert.match(src, /Platform\.OS\s*===\s*"web"/);
    assert.match(src, /title:\s*formatAbsoluteDate\(listing\.createdAt\)/);
  });

  it("keeps the relative 'Listed X ago' label as the visible Text", () => {
    // Regression guard: long-press / tooltip must be additive; the visible
    // Text node still renders the existing marketplaceListedAt template.
    assert.match(
      src,
      /t\("marketplaceListedAt",\s*\{\s*when:\s*formatRelativeDate\(listing\.createdAt\)/,
    );
  });
});

describe("formatAbsoluteDate context wiring", () => {
  const src = read("lib/i18n-context.tsx");

  it("is exported from lib/i18n-context.tsx", () => {
    assert.match(src, /export\s+function\s+formatAbsoluteDate\s*\(/);
  });

  it("is declared on the I18nContext shape", () => {
    assert.match(src, /formatAbsoluteDate:\s*\(iso:\s*string\)\s*=>\s*string/);
  });

  it("is bound on the provider value object to the active language", () => {
    assert.match(
      src,
      /formatAbsoluteDate:\s*\(iso:\s*string\)\s*=>\s*formatAbsoluteDate\(iso,\s*language\)/,
    );
  });
});
