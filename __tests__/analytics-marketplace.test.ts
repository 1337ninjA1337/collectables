import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("app/item/[id].tsx — listing_created wiring", () => {
  const src = read("app/item/[id].tsx");

  it("imports trackEvent from @/lib/analytics", () => {
    assert.match(
      src,
      /import\s*\{\s*trackEvent\s*\}\s*from\s*["']@\/lib\/analytics["']/,
      "item/[id].tsx must import trackEvent",
    );
  });

  it("fires listing_created with { mode, hasPrice } props", () => {
    assert.match(
      src,
      /trackEvent\(\s*["']listing_created["']\s*,\s*\{[^}]*mode[^}]*hasPrice[^}]*\}\s*\)/,
      "item/[id].tsx must fire trackEvent('listing_created', { mode, hasPrice })",
    );
  });

  it("hasPrice is derived from finalPrice !== null (not the raw input string)", () => {
    const trackIdx = src.indexOf("trackEvent(\"listing_created\"");
    assert.ok(trackIdx >= 0, "listing_created call not found");
    const block = src.slice(trackIdx, trackIdx + 200);
    assert.match(
      block,
      /hasPrice:\s*finalPrice\s*!==\s*null/,
      "hasPrice must reflect the parsed finalPrice (null-safe), not the raw `listingPrice` string",
    );
  });

  it("fires AFTER addListing succeeds (gated on result truthiness)", () => {
    const addIdx = src.indexOf("addListing({");
    const trackIdx = src.indexOf("trackEvent(\"listing_created\"");
    assert.ok(addIdx >= 0 && trackIdx >= 0);
    assert.ok(
      trackIdx > addIdx,
      "trackEvent('listing_created') must fire AFTER addListing so a failed listing doesn't emit a false-positive event",
    );
    // Sanity check: the trackEvent must NOT precede the !result early-return
    // that handles the failed-listing path. Walk backwards a small window
    // and assert we're past the "if (!result) return" guard.
    const head = src.slice(addIdx, trackIdx);
    assert.match(
      head,
      /if\s*\(\s*!result\s*\)\s*\{[\s\S]*?return;[\s\S]*?\}/,
      "trackEvent must come after the !result early-return so a failed listing doesn't emit",
    );
  });
});

describe("app/listing/[id].tsx — listing_claimed wiring", () => {
  const src = read("app/listing/[id].tsx");

  it("imports trackEvent from @/lib/analytics", () => {
    assert.match(
      src,
      /import\s*\{\s*trackEvent\s*\}\s*from\s*["']@\/lib\/analytics["']/,
      "listing/[id].tsx must import trackEvent",
    );
  });

  it("fires listing_claimed with { mode, sellerWasFriend } props", () => {
    assert.match(
      src,
      /trackEvent\(\s*["']listing_claimed["']\s*,\s*\{[^}]*mode[^}]*sellerWasFriend[^}]*\}\s*\)/,
      "listing/[id].tsx must fire trackEvent('listing_claimed', { mode, sellerWasFriend })",
    );
  });

  it("sellerWasFriend is derived from getRelationship(...) === 'friend'", () => {
    const trackIdx = src.indexOf("trackEvent(\"listing_claimed\"");
    const block = src.slice(trackIdx, trackIdx + 250);
    assert.match(
      block,
      /sellerWasFriend:\s*getRelationship\([^)]+\)\s*===\s*["']friend["']/,
      "sellerWasFriend must check the 'friend' (mutual) relationship — not 'following' / 'request_sent' etc.",
    );
  });

  it("fires AFTER markListingSold so a failed transfer doesn't emit", () => {
    const markIdx = src.indexOf("markListingSold(listing.id, user.id)");
    const trackIdx = src.indexOf("trackEvent(\"listing_claimed\"");
    assert.ok(markIdx >= 0 && trackIdx >= 0);
    assert.ok(
      trackIdx > markIdx,
      "trackEvent('listing_claimed') must fire AFTER markListingSold so a failed transferItemToBuyer rejects without emitting a false-positive",
    );
  });

  it("getRelationship is destructured from useSocial()", () => {
    assert.match(
      src,
      /const\s*\{[^}]*getRelationship[^}]*\}\s*=\s*useSocial\(\)/,
      "listing detail must pull getRelationship from useSocial() to compute sellerWasFriend",
    );
  });

  it("includes getRelationship in the performClaim useCallback deps", () => {
    // Find the performClaim definition and the matching deps array.
    const declIdx = src.indexOf("const performClaim = useCallback");
    assert.ok(declIdx >= 0, "performClaim useCallback not found");
    const depsIdx = src.indexOf("}, [listing, user, markListingSold", declIdx);
    assert.ok(depsIdx >= 0, "performClaim useCallback deps array not found");
    const depsBlock = src.slice(depsIdx, depsIdx + 200);
    assert.match(
      depsBlock,
      /getRelationship/,
      "getRelationship must be listed in performClaim's useCallback deps",
    );
  });
});

describe("Analytics #9 — taxonomy parity", () => {
  it("listing_created props match the taxonomy", () => {
    const src = read("lib/analytics-events.ts");
    const block = src.slice(
      src.indexOf("listing_created:"),
      src.indexOf("listing_claimed:"),
    );
    assert.match(block, /["']mode["']/);
    assert.match(block, /["']hasPrice["']/);
  });

  it("listing_claimed props match the taxonomy", () => {
    const src = read("lib/analytics-events.ts");
    const block = src.slice(
      src.indexOf("listing_claimed:"),
      src.indexOf("chat_opened:"),
    );
    assert.match(block, /["']mode["']/);
    assert.match(block, /["']sellerWasFriend["']/);
  });
});
