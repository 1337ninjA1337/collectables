import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("listing detail screen", () => {
  it("resolves the listing from useMarketplace via the route param", () => {
    const src = read("app/listing/[id].tsx");
    assert.match(src, /useLocalSearchParams<\{ id: string \}>/);
    assert.match(src, /useMarketplace\(\)/);
    assert.match(src, /getListingById\(listingId\)/);
  });

  it("renders item title, mode badge and price", () => {
    const src = read("app/listing/[id].tsx");
    assert.match(src, /marketplaceModeTrade/);
    assert.match(src, /marketplaceModeSell/);
    assert.match(src, /askingPrice/);
  });

  it("includes an owner profile chip linking to /profile/{ownerUserId}", () => {
    const src = read("app/listing/[id].tsx");
    assert.match(src, /marketplaceOwnerLabel/);
    assert.match(src, /\/profile\/\$\{listing\.ownerUserId\}/);
  });

  it("Message owner CTA calls ensureChatWith and routes to /chat/{ownerUserId}", () => {
    const src = read("app/listing/[id].tsx");
    assert.match(src, /ensureChatWith\(listing\.ownerUserId\)/);
    assert.match(src, /\/chat\/\$\{listing\.ownerUserId\}/);
  });

  it("falls back to the friends-only EmptyState when the viewer cannot message the owner", () => {
    const src = read("app/listing/[id].tsx");
    assert.match(src, /canMessage\(listing\.ownerUserId\)/);
    assert.match(src, /chatOnlyFriendsTitle/);
    assert.match(src, /chatOnlyFriendsHint/);
  });

  it("hides the message CTA on the owner's own listing", () => {
    const src = read("app/listing/[id].tsx");
    assert.match(src, /isSelf/);
    assert.match(src, /marketplaceSelfHint/);
  });

  it("renders a not-found state when the listing id is unknown", () => {
    const src = read("app/listing/[id].tsx");
    assert.match(src, /marketplaceListingNotFound/);
  });
});

describe("listing detail translations", () => {
  it("declares listing-detail keys in every language map", () => {
    const src = read("lib/i18n-context.tsx");
    const requiredKeys = [
      "marketplaceMessageOwner",
      "marketplaceOwnerLabel",
      "marketplaceListingNotFound",
      "marketplaceListingNotFoundHint",
      "marketplaceSelfHint",
    ];
    for (const lang of ["en", "ru", "be", "pl", "de", "es"] as const) {
      const block =
        lang === "en"
          ? src.match(/const\s+en\s*=\s*{([\s\S]*?)\n}\s*as\s+const;/)
          : src.match(new RegExp(`const\\s+${lang}\\s*:\\s*TranslationMap\\s*=\\s*{([\\s\\S]*?)\\n};`));
      assert.ok(block, `could not locate language block for '${lang}'`);
      for (const key of requiredKeys) {
        assert.match(
          block![1],
          new RegExp(`\\b${key}\\s*:`),
          `language '${lang}' missing key '${key}'`,
        );
      }
    }
  });
});
