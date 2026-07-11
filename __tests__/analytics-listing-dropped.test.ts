import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  buildListingDroppedProps,
  isListingDraftDirty,
  LISTING_DRAFT_DEFAULTS,
  type ListingDraft,
} from "../lib/analytics-helpers";
import { ANALYTICS_EVENTS } from "../lib/analytics-events";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const pristine: ListingDraft = {
  mode: LISTING_DRAFT_DEFAULTS.mode,
  price: "",
  currency: LISTING_DRAFT_DEFAULTS.currency,
  notes: "",
};

describe("isListingDraftDirty — the listing_dropped gate", () => {
  it("a just-opened draft is NOT dirty (open + close fires nothing)", () => {
    assert.equal(isListingDraftDirty(pristine), false);
  });

  it("whitespace-only price / notes still count as pristine", () => {
    assert.equal(
      isListingDraftDirty({ ...pristine, price: "   ", notes: "\n" }),
      false,
    );
  });

  it("each single deviation from the defaults makes the draft dirty", () => {
    assert.equal(isListingDraftDirty({ ...pristine, mode: "sell" }), true);
    assert.equal(isListingDraftDirty({ ...pristine, price: "12" }), true);
    assert.equal(isListingDraftDirty({ ...pristine, notes: "mint" }), true);
    assert.equal(isListingDraftDirty({ ...pristine, currency: "EUR" }), true);
  });
});

describe("buildListingDroppedProps — canonical payload", () => {
  it("mirrors listing_created's { mode, hasPrice } shape", () => {
    assert.deepEqual(
      buildListingDroppedProps({ ...pristine, mode: "sell", price: "12" }),
      { mode: "sell", hasPrice: true },
    );
  });

  it("blank / whitespace price derives hasPrice: false", () => {
    for (const price of ["", "   "]) {
      assert.equal(
        buildListingDroppedProps({ ...pristine, price }).hasPrice,
        false,
        `price=${JSON.stringify(price)}`,
      );
    }
  });

  it("an unparseable typed price still counts as price intent", () => {
    assert.equal(
      buildListingDroppedProps({ ...pristine, price: "abc" }).hasPrice,
      true,
    );
  });

  it("returns only keys the listing_dropped registry entry allows", () => {
    const allowed = new Set<string>(ANALYTICS_EVENTS.listing_dropped.props);
    for (const key of Object.keys(buildListingDroppedProps(pristine))) {
      assert.ok(
        allowed.has(key),
        `builder key "${key}" missing from the listing_dropped registry props`,
      );
    }
  });
});

describe("app/item/[id].tsx — listing_dropped wiring", () => {
  const src = read("app/item/[id].tsx");

  it("closeListingSheet fires listing_dropped only for a dirty draft", () => {
    const closeIdx = src.indexOf("function closeListingSheet()");
    assert.ok(closeIdx >= 0, "closeListingSheet not found");
    const block = src.slice(closeIdx, closeIdx + 600);
    assert.match(
      block,
      /if\s*\(\s*isListingDraftDirty\(\s*draft\s*\)\s*\)\s*\{\s*trackEvent\(\s*["']listing_dropped["']\s*,\s*buildListingDroppedProps\(\s*draft\s*\)\s*\)/,
      "closeListingSheet must gate trackEvent('listing_dropped', buildListingDroppedProps(draft)) on isListingDraftDirty(draft)",
    );
  });

  it("a successful submit closes the sheet WITHOUT the dismissal path", () => {
    const submitIdx = src.indexOf("function handleSubmitListing()");
    const submitEnd = src.indexOf("function handleRemoveListing()");
    const block = src.slice(submitIdx, submitEnd);
    assert.doesNotMatch(
      block,
      /closeListingSheet\(\)/,
      "handleSubmitListing must not call closeListingSheet — a published listing is not a dropped one",
    );
    assert.match(
      block,
      /setListingSheetOpen\(false\)/,
      "handleSubmitListing must close the sheet directly",
    );
  });

  it("openListingSheet resets from LISTING_DRAFT_DEFAULTS so the gate can't drift", () => {
    const openIdx = src.indexOf("function openListingSheet()");
    const block = src.slice(openIdx, openIdx + 500);
    assert.match(block, /setListingMode\(LISTING_DRAFT_DEFAULTS\.mode\)/);
    assert.match(
      block,
      /setListingCurrencyState\(LISTING_DRAFT_DEFAULTS\.currency\)/,
      "the reset must bypass setListingCurrency so opening the sheet doesn't persist the default as the user's preferred currency",
    );
  });

  it("the sheet's cancel affordances all route through closeListingSheet", () => {
    assert.match(src, /onRequestClose=\{closeListingSheet\}/);
    assert.ok(
      (src.match(/onPress=\{closeListingSheet\}/g) ?? []).length >= 2,
      "backdrop + cancel button must both dismiss via closeListingSheet",
    );
  });
});

describe("listing_dropped — taxonomy entry", () => {
  it("props mirror listing_created exactly", () => {
    assert.deepEqual(
      [...ANALYTICS_EVENTS.listing_dropped.props],
      [...ANALYTICS_EVENTS.listing_created.props],
      "the two funnel arms must slice identically in Power BI",
    );
  });
});
