import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("app/create-collection.tsx — collection_created wiring", () => {
  const src = read("app/create-collection.tsx");

  it("imports trackEvent from @/lib/analytics", () => {
    assert.match(
      src,
      /import\s*\{\s*trackEvent\s*\}\s*from\s*["']@\/lib\/analytics["']/,
      "create-collection.tsx must import trackEvent",
    );
  });

  it("fires collection_created with { visibility, isPremium } props", () => {
    assert.match(
      src,
      /trackEvent\(\s*["']collection_created["']\s*,\s*\{[^}]*visibility[^}]*isPremium[^}]*\}\s*\)/,
      "create-collection must fire trackEvent('collection_created', { visibility, isPremium })",
    );
  });

  it("fires AFTER addCollection() succeeds (within try block, after the await)", () => {
    // The trackEvent must appear after the addCollection() await so a thrown
    // error short-circuits the analytics emission.
    const addIdx = src.indexOf("await addCollection({");
    const trackIdx = src.indexOf("trackEvent(\"collection_created\"");
    assert.ok(addIdx >= 0, "await addCollection({ not found");
    assert.ok(trackIdx >= 0, "collection_created trackEvent not found");
    assert.ok(
      trackIdx > addIdx,
      "trackEvent must fire AFTER addCollection so a save failure suppresses the event",
    );
  });

  it("uses finalVisibility (the post-clamp value) in the event payload, not the raw `visibility` state", () => {
    // The free-tier user clamps `visibility` -> `public`; the event must
    // reflect the actual saved value, not the user's selection.
    const trackIdx = src.indexOf("trackEvent(\"collection_created\"");
    const block = src.slice(trackIdx, trackIdx + 200);
    assert.match(
      block,
      /visibility:\s*finalVisibility/,
      "collection_created.visibility must reference finalVisibility (the clamped value), not the raw `visibility` state",
    );
  });
});

describe("app/create.tsx — item_added wiring", () => {
  const src = read("app/create.tsx");

  it("imports trackEvent from @/lib/analytics", () => {
    assert.match(
      src,
      /import\s*\{\s*trackEvent\s*\}\s*from\s*["']@\/lib\/analytics["']/,
      "create.tsx must import trackEvent",
    );
  });

  it("fires item_added with { collectionId, hasPhoto } props", () => {
    assert.match(
      src,
      /trackEvent\(\s*["']item_added["']\s*,\s*\{[^}]*collectionId[^}]*hasPhoto[^}]*\}\s*\)/,
      "create.tsx must fire trackEvent('item_added', { collectionId, hasPhoto })",
    );
  });

  it("hasPhoto is derived from uploadedPhotos.length, not the raw local list", () => {
    const trackIdx = src.indexOf("trackEvent(\"item_added\"");
    const block = src.slice(trackIdx, trackIdx + 200);
    assert.match(
      block,
      /hasPhoto:\s*uploadedPhotos\.length\s*>\s*0/,
      "hasPhoto must reflect successfully-uploaded photos, not the raw local picks",
    );
  });

  it("fires AFTER addItem() succeeds", () => {
    const addIdx = src.indexOf("await addItem({");
    const trackIdx = src.indexOf("trackEvent(\"item_added\"");
    assert.ok(addIdx >= 0 && trackIdx >= 0);
    assert.ok(
      trackIdx > addIdx,
      "trackEvent('item_added') must fire AFTER addItem so a save failure suppresses the event",
    );
  });
});

describe("app/item/[id].tsx — item_photo_attached wiring", () => {
  const src = read("app/item/[id].tsx");

  it("imports trackEvent from @/lib/analytics", () => {
    assert.match(
      src,
      /import\s*\{\s*trackEvent\s*\}\s*from\s*["']@\/lib\/analytics["']/,
      "item/[id].tsx must import trackEvent",
    );
  });

  it("captures hadPhotosBefore before the updateItem call", () => {
    const handlerIdx = src.indexOf("handleSaveEdit()");
    const updateIdx = src.indexOf("await updateItem(", handlerIdx);
    const hadIdx = src.indexOf("hadPhotosBefore", handlerIdx);
    assert.ok(hadIdx >= 0, "must capture hadPhotosBefore");
    assert.ok(
      hadIdx < updateIdx,
      "hadPhotosBefore must be captured before updateItem mutates the item",
    );
  });

  it("fires item_photo_attached only on the no-photo→has-photo edge", () => {
    const trackIdx = src.indexOf("trackEvent(\"item_photo_attached\"");
    assert.ok(trackIdx >= 0, "item_photo_attached call not found");
    // Walk backwards a small window to see the gating `if`.
    const window = src.slice(Math.max(0, trackIdx - 200), trackIdx);
    assert.match(
      window,
      /if\s*\(\s*!hadPhotosBefore\s*&&\s*finalPhotos\.length\s*>\s*0\s*\)/,
      "item_photo_attached must be gated on (!hadPhotosBefore && finalPhotos.length > 0) so it only fires for the FIRST photo",
    );
  });

  it("includes itemId + collectionId props", () => {
    const trackIdx = src.indexOf("trackEvent(\"item_photo_attached\"");
    const block = src.slice(trackIdx, trackIdx + 250);
    assert.match(
      block,
      /itemId:\s*activeItem\.id/,
      "item_photo_attached must include itemId",
    );
    assert.match(
      block,
      /collectionId:\s*activeItem\.collectionId/,
      "item_photo_attached must include collectionId",
    );
  });
});

describe("Analytics #8 — event/prop parity with ANALYTICS_EVENTS taxonomy", () => {
  it("collection_created props match the taxonomy", () => {
    const src = read("lib/analytics-events.ts");
    const block = src.slice(src.indexOf("collection_created:"), src.indexOf("item_added:"));
    assert.match(block, /["']visibility["']/);
    assert.match(block, /["']isPremium["']/);
  });

  it("item_added props match the taxonomy", () => {
    const src = read("lib/analytics-events.ts");
    const block = src.slice(src.indexOf("item_added:"), src.indexOf("item_photo_attached:"));
    assert.match(block, /["']collectionId["']/);
    assert.match(block, /["']hasPhoto["']/);
  });

  it("item_photo_attached props match the taxonomy", () => {
    const src = read("lib/analytics-events.ts");
    const block = src.slice(
      src.indexOf("item_photo_attached:"),
      src.indexOf("listing_created:"),
    );
    assert.match(block, /["']itemId["']/);
    assert.match(block, /["']collectionId["']/);
  });
});
