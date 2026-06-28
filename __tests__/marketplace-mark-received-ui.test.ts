import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Buyer "Mark as received" UI — structural guards over the two screens that
 * surface the affordance (`app/marketplace.tsx` purchase card + the listing
 * detail) plus i18n parity for the three new keys. Both screens import
 * `react-native`, so they're parsed as source rather than executed; the context
 * + pure-helper behaviour is covered by `marketplace-received.test.ts` and
 * `marketplace-helpers.test.ts`.
 */

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

const I18N_KEYS = [
  "marketplaceMarkReceived",
  "marketplaceMarkReceivedSuccess",
  "marketplaceReceivedBadge",
] as const;

const LANGUAGES = ["en", "ru", "be", "pl", "de", "es"] as const;

describe("marketplace screen — buyer mark-as-received", () => {
  const src = read("app/marketplace.tsx");

  it("pulls markListingReceived, the auth user, and the toast into the card", () => {
    assert.match(src, /from "@\/lib\/auth-context"/);
    assert.match(src, /from "@\/lib\/toast-context"/);
    assert.match(src, /const\s*\{\s*markListingReceived\s*\}\s*=\s*useMarketplace\(\)/);
    assert.match(src, /const\s*\{\s*user\s*\}\s*=\s*useAuth\(\)/);
    assert.match(src, /const\s+toast\s*=\s*useToast\(\)/);
  });

  it("gates the button on the buyer's own sold-but-not-arrived purchase", () => {
    assert.match(
      src,
      /isMyPurchase\s*=\s*[\s\S]*?fromSeller[\s\S]*?listing\.soldAt != null[\s\S]*?listing\.buyerUserId === user\?\.id/,
    );
    assert.match(src, /canMarkReceived\s*=\s*isMyPurchase\s*&&\s*listing\.arrivedAt == null/);
  });

  it("renders the mark-received button and confirms via a success toast", () => {
    assert.match(src, /t\("marketplaceMarkReceived"\)/);
    assert.match(src, /markListingReceived\(listing\.id\)/);
    assert.match(src, /toast\.success\(t\("marketplaceMarkReceivedSuccess"\)\)/);
  });

  it("places the action button OUTSIDE the navigating Link (no nested press)", () => {
    // The receive button must be a sibling of the Link inside cardOuter so a
    // tap confirms receipt instead of navigating to the listing.
    const linkClose = src.indexOf("</Link>");
    const buttonIdx = src.indexOf('t("marketplaceMarkReceived")');
    assert.ok(linkClose !== -1 && buttonIdx !== -1);
    assert.ok(buttonIdx > linkClose, "button must render after </Link>");
    assert.match(src, /<View style=\{styles\.cardOuter\}>/);
  });

  it("flips to a received indicator once arrivedAt is stamped", () => {
    assert.match(src, /receivedAt\s*=\s*isMyPurchase && listing\.arrivedAt/);
    assert.match(src, /t\("marketplaceReceivedBadge",\s*\{\s*when:\s*formatRelativeDate\(receivedAt\)\s*\}\)/);
  });
});

describe("listing detail — buyer mark-as-received", () => {
  const src = read("app/listing/[id].tsx");

  it("destructures markListingReceived from the marketplace context", () => {
    assert.match(src, /markListingReceived,/);
  });

  it("computes the buyer-only, not-yet-arrived gate", () => {
    assert.match(src, /isBuyer\s*=\s*listing\.buyerUserId != null\s*&&\s*user\?\.id === listing\.buyerUserId/);
    assert.match(
      src,
      /canMarkReceived\s*=\s*isSold\s*&&\s*isBuyer\s*&&\s*listing\.arrivedAt == null/,
    );
  });

  it("wires the button to markListingReceived + a success toast, with a received fallback", () => {
    assert.match(src, /t\("marketplaceMarkReceived"\)/);
    assert.match(src, /markListingReceived\(listing\.id\)/);
    assert.match(src, /toast\.success\(t\("marketplaceMarkReceivedSuccess"\)\)/);
    assert.match(src, /isBuyer && listing\.arrivedAt/);
    assert.match(src, /t\("marketplaceReceivedBadge"/);
  });
});

describe("i18n parity — mark-as-received keys in every language", () => {
  const src = read("lib/i18n-context.tsx");

  for (const lang of LANGUAGES) {
    it(`'${lang}' map declares all three new keys`, () => {
      // Slice from this map's declaration to the next `const <lang2>:` map so a
      // key declared in a different language can't satisfy the assertion.
      const start = src.search(new RegExp(`const\\s+${lang}(?::\\s*TranslationMap)?\\s*=\\s*\\{`));
      assert.ok(start !== -1, `map '${lang}' not found`);
      const rest = src.slice(start + 10);
      const nextMap = rest.search(/\nconst\s+\w+(?::\s*TranslationMap)?\s*=\s*\{/);
      const block = nextMap === -1 ? rest : rest.slice(0, nextMap);
      for (const key of I18N_KEYS) {
        assert.match(block, new RegExp(`\\b${key}\\s*:`), `'${lang}' missing '${key}'`);
      }
    });
  }
});
