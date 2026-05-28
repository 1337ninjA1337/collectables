import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("marketplace context — markListingReceived", () => {
  const src = read("lib/marketplace-context.tsx");

  it("declares markListingReceived on the context value shape", () => {
    assert.match(src, /markListingReceived:\s*\(id:\s*string\)\s*=>\s*void/);
  });

  it("imports markListingArrived from the helpers module", () => {
    assert.match(
      src,
      /import\s*\{[\s\S]*?markListingArrived[\s\S]*?\}\s*from\s*"@\/lib\/marketplace-helpers"/,
    );
  });

  it("defines markListingReceived as a useCallback", () => {
    assert.match(src, /const\s+markListingReceived\s*=\s*useCallback\(/);
  });

  it("gates the update on the buyer, a sold listing, and idempotency", () => {
    const idx = src.indexOf("const markListingReceived");
    assert.ok(idx >= 0, "markListingReceived not found");
    const block = src.slice(idx, idx + 700);
    // Only the buyer may confirm receipt.
    assert.match(block, /target\.buyerUserId\s*!==\s*me/);
    // Only a sold listing can be received.
    assert.match(block, /!target\.soldAt/);
    // Idempotent — an already-arrived listing is left untouched.
    assert.match(block, /target\.arrivedAt/);
    // Stamps via the pure helper.
    assert.match(block, /markListingArrived\(target,\s*when\)/);
  });

  it("threads markListingReceived into the context value object AND its deps array", () => {
    const valueIdx = src.indexOf("useMemo<MarketplaceContextValue>");
    assert.ok(valueIdx >= 0, "MarketplaceContextValue useMemo not found");
    const block = src.slice(valueIdx, valueIdx + 1600);
    assert.ok(
      block.split("markListingReceived").length >= 3,
      "markListingReceived must appear in BOTH the object literal AND the deps array",
    );
  });
});
