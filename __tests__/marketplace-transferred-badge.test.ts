import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural tests for the new "Transferred" pill that surfaces on sold
 * listings with a non-null `buyerUserId` — both on the marketplace card grid
 * (`app/marketplace.tsx`) and the listing detail screen (`app/listing/[id].tsx`).
 *
 * The badge is purely visual; full RN render tests would need a fixture
 * harness this codebase doesn't have. Source-level pinning keeps the
 * contract (the badge depends on BOTH `soldAt !== null` AND
 * `buyerUserId !== null`) regression-proof.
 */

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("marketplaceTransferredBadge i18n parity", () => {
  it("declares marketplaceTransferredBadge in every supported language", () => {
    const src = read("lib/i18n-context.tsx");
    const languages = ["en", "ru", "be", "pl", "de", "es"] as const;
    for (const code of languages) {
      const blockMatch = src.match(
        new RegExp(`const\\s+${code}\\s*:?\\s*(?:TranslationMap)?\\s*=\\s*{([\\s\\S]*?)\\n};`),
      );
      assert.ok(blockMatch, `could not locate '${code}' translation map`);
      assert.match(
        blockMatch![1],
        /\bmarketplaceTransferredBadge\s*:\s*"[^"]+"/,
        `language '${code}' must declare marketplaceTransferredBadge as a non-empty string`,
      );
    }
  });
});

describe("listing detail — transferred badge wiring", () => {
  const src = read("app/listing/[id].tsx");

  it("renders the transferred pill inside the sold-banner branch", () => {
    // Pin the gate: badge appears ONLY when listing is sold AND a buyer is set.
    assert.match(
      src,
      /\bisSold\b[\s\S]*?\bbuyerUserId\b[\s\S]*?marketplaceTransferredBadge/,
      "the transferred pill must live inside the isSold + buyerUserId branch",
    );
  });

  it("uses the dedicated marketplaceTransferredBadge translation key", () => {
    assert.match(
      src,
      /t\(\s*["']marketplaceTransferredBadge["']\s*\)/,
      "must read the translation via t('marketplaceTransferredBadge')",
    );
  });

  it("declares transferredBadge + transferredBadgeText styles", () => {
    assert.match(src, /transferredBadge\s*:\s*\{/);
    assert.match(src, /transferredBadgeText\s*:\s*\{/);
  });
});

describe("marketplace card grid — transferred badge wiring", () => {
  const src = read("app/marketplace.tsx");

  it("computes isTransferred = soldAt !== null && buyerUserId !== null", () => {
    assert.match(
      src,
      /isTransferred\s*=\s*listing\.soldAt\s*!==\s*null\s*&&\s*listing\.buyerUserId\s*!==\s*null/,
      "isTransferred must AND both soldAt and buyerUserId — the badge is for transfers, not just sales",
    );
  });

  it("renders the badge only when isTransferred is true", () => {
    assert.match(
      src,
      /\{\s*isTransferred\s*\?[\s\S]*?marketplaceTransferredBadge/,
      "badge render must be gated on isTransferred",
    );
  });

  it("declares the badge styles inline (no shared util needed)", () => {
    assert.match(src, /transferredBadge\s*:\s*\{[\s\S]*?position\s*:\s*["']absolute["']/);
    assert.match(src, /transferredBadgeText\s*:\s*\{/);
  });
});
