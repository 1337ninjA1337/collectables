import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("listing-detail seller provenance wiring", () => {
  const src = read("app/listing/[id].tsx");

  it("no longer hard-codes acquiredFrom to t('marketplaceTitle')", () => {
    // Regression guard: the previous behaviour stored the literal
    // "Marketplace" title in the buyer's Acquired collection, losing all
    // provenance info. The new behaviour stores the seller's @username
    // (or displayName fallback) so the buyer can audit *who* sent the item.
    assert.doesNotMatch(
      src,
      /acquiredFrom:\s*t\("marketplaceTitle"\)/,
      "acquiredFrom must not be the static marketplace title — record the seller instead",
    );
  });

  it("builds a sellerProvenance label using @username with displayName fallback", () => {
    assert.match(
      src,
      /sellerProvenance\s*=\s*owner\?\.username[\s\S]*?`@\$\{owner\.username\}`[\s\S]*?owner\?\.displayName/,
      "sellerProvenance must prefer `@username` then fall back to displayName",
    );
  });

  it("threads sellerProvenance into the transferItemToBuyer snapshot's acquiredFrom field", () => {
    assert.match(src, /acquiredFrom:\s*sellerProvenance/);
  });

  it("uses t('marketplaceTitle') only as the ultimate fallback when seller has no profile", () => {
    // The unknown-seller fallback must still produce a sensible string so the
    // Acquired item's metadata never renders as empty.
    assert.match(
      src,
      /owner\?\.displayName\s*\?\?\s*t\("marketplaceTitle"\)/,
    );
  });

  it("includes owner in the performClaim useCallback deps", () => {
    const declIdx = src.indexOf("const performClaim = useCallback");
    assert.ok(declIdx >= 0, "performClaim useCallback not found");
    const depsIdx = src.indexOf("}, [listing, user, markListingSold", declIdx);
    assert.ok(depsIdx >= 0, "performClaim useCallback deps array not found");
    const depsBlock = src.slice(depsIdx, depsIdx + 300);
    assert.match(
      depsBlock,
      /\bowner\b/,
      "owner must be listed in performClaim's useCallback deps so a stale seller never leaks across renders",
    );
  });

  it("computes sellerProvenance before invoking transferItemToBuyer", () => {
    const provIdx = src.indexOf("sellerProvenance");
    const transferIdx = src.indexOf("transferItemToBuyer(");
    assert.ok(provIdx > 0, "sellerProvenance not declared");
    assert.ok(transferIdx > 0, "transferItemToBuyer not invoked");
    assert.ok(provIdx < transferIdx, "sellerProvenance must be derived before the transfer call");
  });
});
