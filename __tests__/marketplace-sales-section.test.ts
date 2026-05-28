import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("marketplace screen — sales section", () => {
  const src = read("app/marketplace.tsx");

  it("destructures mySales from useMarketplace()", () => {
    assert.match(
      src,
      /useMarketplace\(\)\s*;?[\s\S]*?mySales/,
      "useMarketplace must surface mySales for the Sales section",
    );
  });

  it("resolves mySales into a `sales` useMemo with the standard ResolvedListing shape", () => {
    assert.match(src, /const\s+sales\s*=\s*useMemo<ResolvedListing\[\]>/);
    assert.match(src, /mySales\.map\(\(listing\)\s*=>\s*\(\{/);
  });

  it("renders the section behind a `sales.length > 0` guard (no empty title on first sale-less render)", () => {
    assert.match(src, /sales\.length\s*>\s*0/);
  });

  it("renders the section title from the marketplaceMySalesTitle i18n key", () => {
    assert.match(src, /marketplaceMySalesTitle/);
  });

  it("passes a resolveBuyer prop into the grid so the 'Sold to @buyer' pill renders", () => {
    // The sales surface mirrors the recently-sold section in shape — both
    // hand the grid a `resolveBuyer` callback so the sold-to pill identifies
    // the counterparty.
    const salesIdx = src.indexOf("marketplaceMySalesTitle");
    assert.ok(salesIdx >= 0, "sales section title not found");
    const tail = src.slice(salesIdx, salesIdx + 1500);
    assert.match(
      tail,
      /resolveBuyer=\{[\s\S]*?getProfileById\(listing\.buyerUserId\)\s*:\s*undefined/,
      "sales grid must thread a resolveBuyer callback into ListingGrid for the sold-to pill",
    );
  });

  it("places the Sales section AFTER My purchases and BEFORE Recently sold", () => {
    const purchasesIdx = src.indexOf("marketplaceMyPurchasesTitle");
    const salesIdx = src.indexOf("marketplaceMySalesTitle");
    const recentIdx = src.indexOf("marketplaceRecentlySoldTitle");
    assert.ok(purchasesIdx >= 0 && salesIdx >= 0 && recentIdx >= 0);
    assert.ok(purchasesIdx < salesIdx, "My sales must follow My purchases");
    assert.ok(salesIdx < recentIdx, "My sales must precede Recently sold");
  });
});

describe("marketplace context — mySales selector", () => {
  const src = read("lib/marketplace-context.tsx");

  it("imports salesForUser from the helpers module", () => {
    assert.match(
      src,
      /import\s*\{[\s\S]*?salesForUser[\s\S]*?\}\s*from\s*"@\/lib\/marketplace-helpers"/,
    );
  });

  it("declares mySales on the MarketplaceContextValue shape", () => {
    assert.match(src, /mySales:\s*MarketplaceListing\[\]/);
  });

  it("computes mySales from salesForUser(listings, user.id) inside a useMemo", () => {
    assert.match(
      src,
      /const\s+mySales\s*=\s*useMemo\(\s*\(\)\s*=>\s*\(user\s*\?\s*salesForUser\(listings,\s*user\.id\)\s*:\s*\[\]\)/,
    );
  });

  it("threads mySales into the context value object and its deps array", () => {
    const valueIdx = src.indexOf("useMemo<MarketplaceContextValue>");
    assert.ok(valueIdx >= 0, "MarketplaceContextValue useMemo not found");
    const block = src.slice(valueIdx, valueIdx + 1500);
    assert.match(block, /mySales/);
    // Verify it appears in the deps array (not just the object literal).
    const depsBlock = block.slice(block.indexOf("], ["));
    assert.ok(
      block.split("mySales").length >= 3,
      "mySales must appear in BOTH the object literal AND the deps array",
    );
  });
});

describe("marketplaceMySalesTitle i18n parity", () => {
  const src = read("lib/i18n-context.tsx");

  it("declares marketplaceMySalesTitle in every supported language map", () => {
    for (const lang of ["en", "ru", "be", "pl", "de", "es"] as const) {
      const block =
        lang === "en"
          ? src.match(/const\s+en\s*=\s*{([\s\S]*?)\n}\s*as\s+const;/)
          : src.match(new RegExp(`const\\s+${lang}\\s*:\\s*TranslationMap\\s*=\\s*{([\\s\\S]*?)\\n};`));
      assert.ok(block, `could not locate language block for '${lang}'`);
      assert.match(
        block![1],
        /\bmarketplaceMySalesTitle\s*:/,
        `language '${lang}' missing marketplaceMySalesTitle`,
      );
    }
  });
});
