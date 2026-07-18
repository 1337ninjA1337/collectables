import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { ANALYTICS_EVENTS } from "../lib/analytics-events";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("premium_upsell_shown — event registry", () => {
  it("is declared in ANALYTICS_EVENTS with feature + source props", () => {
    const def = ANALYTICS_EVENTS.premium_upsell_shown;
    assert.ok(def, "premium_upsell_shown must exist in ANALYTICS_EVENTS");
    assert.deepEqual([...def.props].sort(), ["feature", "source"]);
  });
});

describe("app/create-collection.tsx — premium_upsell_shown wiring", () => {
  const src = read("app/create-collection.tsx");

  it("fires premium_upsell_shown with feature=private_collection, source=create_collection on locked chip tap", () => {
    assert.match(
      src,
      /trackEvent\(\s*["']premium_upsell_shown["']\s*,\s*\{[^}]*feature:\s*["']private_collection["'][^}]*source:\s*["']create_collection["'][^}]*\}\s*,?\s*\)/,
      "create-collection must fire trackEvent('premium_upsell_shown', { feature: 'private_collection', source: 'create_collection' })",
    );
  });

  it("fires inside the locked branch, before opening the upsell sheet", () => {
    const trackIdx = src.indexOf('trackEvent("premium_upsell_shown"');
    const sheetIdx = src.indexOf("setUpsellVisible(true)");
    assert.ok(trackIdx >= 0, "premium_upsell_shown trackEvent not found");
    assert.ok(sheetIdx >= 0, "setUpsellVisible(true) not found");
    assert.ok(
      trackIdx < sheetIdx,
      "the event must fire before the sheet opens so an early-return sheet dismissal can't skip it",
    );
  });
});

// HM-C3: the locked-chip upsell moved into the extracted edit modal — the
// event fires from the component that owns the chip.
describe("components/edit-collection-modal.tsx — premium_upsell_shown wiring", () => {
  const src = read("components/edit-collection-modal.tsx");

  it("imports trackEvent from @/lib/analytics", () => {
    assert.match(
      src,
      /import\s*\{\s*trackEvent\s*\}\s*from\s*["']@\/lib\/analytics["']/,
      "edit-collection-modal.tsx must import trackEvent",
    );
  });

  it("fires premium_upsell_shown with feature=private_collection, source=collection_edit on locked chip tap", () => {
    assert.match(
      src,
      /trackEvent\(\s*["']premium_upsell_shown["']\s*,\s*\{[^}]*feature:\s*["']private_collection["'][^}]*source:\s*["']collection_edit["'][^}]*\}\s*,?\s*\)/,
      "collection edit must fire trackEvent('premium_upsell_shown', { feature: 'private_collection', source: 'collection_edit' })",
    );
  });
});
