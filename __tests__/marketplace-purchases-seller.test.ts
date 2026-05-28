import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("marketplace screen — purchases 'From @seller' chip", () => {
  const src = read("app/marketplace.tsx");

  it("ListingCard accepts a fromSeller flag", () => {
    assert.match(src, /fromSeller\?:\s*boolean/);
  });

  it("derives the seller handle from the owner profile when fromSeller is set", () => {
    assert.match(
      src,
      /fromSeller\s*&&\s*owner\s*\?\s*`@\$\{owner\.username\s*\?\?\s*owner\.publicId\s*\?\?\s*owner\.id\}`/,
    );
  });

  it("renders the seller handle through the marketplaceBoughtFrom i18n key", () => {
    assert.match(src, /t\("marketplaceBoughtFrom",\s*\{\s*name:\s*sellerHandle\s*\}\)/);
  });

  it("passes fromSeller into the ListingCard inside the My purchases section", () => {
    const purchasesIdx = src.indexOf("marketplaceMyPurchasesTitle");
    assert.ok(purchasesIdx >= 0, "purchases section title not found");
    const tail = src.slice(purchasesIdx, purchasesIdx + 800);
    assert.match(
      tail,
      /<ListingCard[^>]*\bfromSeller\b/,
      "purchases card must thread fromSeller into ListingCard for the 'From @seller' pill",
    );
  });
});

describe("marketplaceBoughtFrom i18n parity", () => {
  const src = read("lib/i18n-context.tsx");

  it("declares marketplaceBoughtFrom in every supported language map", () => {
    for (const lang of ["en", "ru", "be", "pl", "de", "es"] as const) {
      const block =
        lang === "en"
          ? src.match(/const\s+en\s*=\s*{([\s\S]*?)\n}\s*as\s+const;/)
          : src.match(new RegExp(`const\\s+${lang}\\s*:\\s*TranslationMap\\s*=\\s*{([\\s\\S]*?)\\n};`));
      assert.ok(block, `could not locate language block for '${lang}'`);
      assert.match(
        block![1],
        /\bmarketplaceBoughtFrom\s*:/,
        `language '${lang}' missing marketplaceBoughtFrom`,
      );
    }
  });
});
