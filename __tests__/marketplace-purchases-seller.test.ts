import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { localeKeys } from "@/lib/i18n-source";
import { readI18nSource } from "./helpers/i18n-source-file";
import { locales } from "./helpers/i18n-locales";
import { readRepoFile as read } from "./helpers/repo-file";

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

  it("passes fromSeller into the grid inside the My purchases section", () => {
    const purchasesIdx = src.indexOf("marketplaceMyPurchasesTitle");
    assert.ok(purchasesIdx >= 0, "purchases section title not found");
    const tail = src.slice(purchasesIdx, purchasesIdx + 800);
    assert.match(
      tail,
      /<ListingGrid[^>]*\bfromSeller\b/,
      "purchases grid must thread fromSeller into ListingGrid for the 'From @seller' pill",
    );
  });
});

describe("marketplaceBoughtFrom i18n parity", () => {
  const src = readI18nSource();

  it("declares marketplaceBoughtFrom in every supported language map", () => {
    for (const lang of locales(src)) {
      const declared = localeKeys(src, lang);
      assert.ok(
        declared.has("marketplaceBoughtFrom"),
        `language '${lang}' missing marketplaceBoughtFrom`,
      );
    }
  });
});
