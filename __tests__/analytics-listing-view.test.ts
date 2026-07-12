import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { ANALYTICS_EVENTS } from "../lib/analytics-events";
import { findPiiPropKeys } from "../lib/analytics-pii";
import { DWELL_TIME_DEFAULT_MS } from "../lib/use-dwell-time";

const ROOT = path.join(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("lib/use-dwell-time.ts — shared dwell gate contract", () => {
  const src = read("lib/use-dwell-time.ts");

  it("exports the canonical 500ms default the chat debounce used", () => {
    assert.equal(DWELL_TIME_DEFAULT_MS, 500);
  });

  it("keeps fire in a latest-ref so inline closures never re-arm the timer", () => {
    // No React mounting harness in the repo (see the [needs-dev-dep] tasks),
    // so pin the structural contract: ref assigned every render, and the
    // effect deps are exactly [ms, ...deps] — fire itself is not a dep.
    assert.match(src, /const\s+fireRef\s*=\s*useRef\(fire\)/);
    assert.match(src, /fireRef\.current\s*=\s*fire/);
    assert.match(
      src,
      /\},\s*\[ms,\s*\.\.\.deps\]\)/,
      "effect deps must be [ms, ...deps] so only subject identity and gate duration re-arm",
    );
  });

  it("schedules with setTimeout and cancels the pending fire on cleanup", () => {
    assert.match(src, /setTimeout\(\(\)\s*=>\s*fireRef\.current\(\),\s*ms\)/);
    assert.match(src, /return\s*\(\)\s*=>\s*clearTimeout\(timer\)/);
  });
});

describe("listing_view — taxonomy entry", () => {
  it("is registered with the funnel-slicing props", () => {
    assert.deepEqual(
      [...ANALYTICS_EVENTS.listing_view.props].sort(),
      ["isSold", "mode", "sellerRelationship"],
    );
  });

  it("shares the mode join key with both marketplace funnel arms", () => {
    assert.ok(ANALYTICS_EVENTS.listing_view.props.includes("mode"));
    assert.ok(ANALYTICS_EVENTS.listing_created.props.includes("mode"));
    assert.ok(ANALYTICS_EVENTS.listing_claimed.props.includes("mode"));
  });

  it("declares no PII-shaped prop keys", () => {
    assert.deepEqual(findPiiPropKeys(ANALYTICS_EVENTS.listing_view.props), []);
  });
});

describe("app/listing/[id].tsx — listing_view wiring", () => {
  const src = read("app/listing/[id].tsx");

  it("fires through the shared useDwellTimeEffect gate keyed on listing + viewer", () => {
    assert.match(
      src,
      /import\s*\{[^}]*\buseDwellTimeEffect\b[^}]*\}\s*from\s*["']@\/lib\/use-dwell-time["']/,
      "listing screen must import the shared dwell-time hook",
    );
    assert.match(
      src,
      /useDwellTimeEffect\(\s*\[listing\?\.id,\s*user\?\.id\]\s*,\s*DWELL_TIME_DEFAULT_MS\s*,/,
      "listing_view must be gated by useDwellTimeEffect keyed on [listing?.id, user?.id]",
    );
  });

  it("never counts the seller viewing their own listing", () => {
    const trackIdx = src.indexOf('trackEvent("listing_view"');
    assert.ok(trackIdx >= 0, "listing_view call not found");
    const window = src.slice(Math.max(0, trackIdx - 300), trackIdx);
    assert.match(
      window,
      /if\s*\(\s*!listing\s*\|\|\s*!user\s*\|\|\s*listing\.ownerUserId\s*===\s*user\.id\s*\)\s*return;/,
      "the fire closure must early-return for missing listing/user and for the owner's own listing",
    );
  });

  it("derives the payload from the persisted listing + the canonical relationship bucket", () => {
    const trackIdx = src.indexOf('trackEvent("listing_view"');
    const block = src.slice(trackIdx, trackIdx + 350);
    assert.match(block, /mode:\s*listing\.mode\s*,/);
    assert.match(
      block,
      /sellerRelationship:\s*relationshipForAnalytics\(/,
      "sellerRelationship must come from relationshipForAnalytics — same bucket listing_claimed uses",
    );
    assert.match(block, /isSold:\s*listing\.soldAt\s*!==\s*null\s*,/);
  });

  it("is called before the !listing early-return (hooks rules)", () => {
    const hookIdx = src.indexOf("useDwellTimeEffect(");
    const earlyReturnIdx = src.indexOf("if (!listing) {");
    assert.ok(hookIdx >= 0 && earlyReturnIdx >= 0);
    assert.ok(
      hookIdx < earlyReturnIdx,
      "the dwell hook must run unconditionally on every render — gating happens inside the fire closure",
    );
  });
});
