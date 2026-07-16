import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// 3b — adoption: inline cost/price error pills in the three forms. The forms
// and <CurrencyInput> pull react-native at module scope, so the wiring is
// pinned structurally (same approach as currency-value-detailed.test.ts).
describe("CurrencyInput — error prop", () => {
  const src = read("components/currency-input.tsx");

  it("accepts an already-translated error message", () => {
    assert.match(src, /error\?: string \| null/);
  });

  it("renders <ErrorPill> under the input row, before the chip strip", () => {
    assert.match(src, /import \{ ErrorPill \} from "@\/components\/error-pill"/);
    const pill = src.indexOf('<ErrorPill label={error ?? ""} />');
    const chips = src.indexOf("styles.chips");
    assert.ok(pill >= 0, "ErrorPill not rendered");
    assert.ok(chips > pill, "ErrorPill must sit between the input row and the chips");
  });

  it("maps the full error vocabulary to the three i18n keys", () => {
    assert.match(src, /empty: "currencyErrorEmpty"/);
    assert.match(src, /unparseable: "currencyErrorUnparseable"/);
    assert.match(src, /non_positive: "currencyErrorNonPositive"/);
    assert.match(src, /satisfies Record<CurrencyValueError, string>/);
  });
});

describe("i18n — currency error keys", () => {
  const src = read("lib/i18n-context.tsx");

  it("defines all three keys in all 6 languages", () => {
    for (const key of ["currencyErrorEmpty", "currencyErrorUnparseable", "currencyErrorNonPositive"]) {
      const count = src.split(`${key}:`).length - 1;
      assert.equal(count, 6, `${key} must appear in exactly 6 language maps, found ${count}`);
    }
  });
});

describe("sell sheet (app/item/[id].tsx) — inline price error", () => {
  const src = read("app/item/[id].tsx");

  it("parses via parseCurrencyValueDetailed and stores the reason", () => {
    assert.match(src, /const parsed = parseCurrencyValueDetailed\(listingPrice\)/);
    assert.match(src, /setListingPriceError\(parsed\.error\)/);
    // the happy-path parser is fully superseded here
    assert.doesNotMatch(src, /[^d]parseCurrencyValue\(/);
  });

  it("keeps the toast + listing_price_invalid analytics unchanged", () => {
    assert.match(src, /const reason = classifyInvalidPrice\(listingPrice\)/);
    assert.match(src, /trackEvent\("listing_price_invalid", \{ reason, language \}\)/);
    assert.match(src, /toast\.error\(t\("marketplacePriceInvalid"\), t\("marketplacePriceLabel"\)\)/);
  });

  it("clears the error on typing and on reopening the sheet", () => {
    assert.match(src, /setListingPrice\(v\);\s*setListingPriceError\(null\);/);
    const open = src.indexOf("function openListingSheet");
    assert.ok(open >= 0);
    assert.match(src.slice(open, open + 400), /setListingPriceError\(null\)/);
  });

  it("passes the translated error into <CurrencyInput>", () => {
    assert.match(
      src,
      /error=\{listingPriceError \? t\(CURRENCY_ERROR_I18N_KEY\[listingPriceError\]\) : null\}/,
    );
  });
});

describe("edit cost (app/item/[id].tsx) — optional-field semantics", () => {
  const src = read("app/item/[id].tsx");

  it("migrated off the ad-hoc Number(x.replace(...)) parse", () => {
    assert.doesNotMatch(src, /Number\(editCost\.replace/);
    assert.match(src, /parseCurrencyValueDetailed\(editCost\.replace\(",", "\."\)\)/);
  });

  it("only NON-EMPTY invalid input blocks the save; empty stays silently-null", () => {
    assert.match(src, /parsedCost\.error && parsedCost\.error !== "empty"/);
    assert.match(src, /setEditCostError\(parsedCost\.error\)/);
    assert.match(src, /cost: parsedCost\.value/);
    assert.match(src, /costCurrency: parsedCost\.value !== null \? editCurrency : null/);
  });

  it("clears the error on typing and on entering edit mode", () => {
    assert.match(src, /setEditCost\(v\);\s*setEditCostError\(null\);/);
    const enter = src.indexOf("function enterEditMode");
    assert.ok(enter >= 0);
    assert.match(src.slice(enter, enter + 700), /setEditCostError\(null\)/);
  });

  it("passes the translated error into <CurrencyInput>", () => {
    assert.match(
      src,
      /error=\{editCostError \? t\(CURRENCY_ERROR_I18N_KEY\[editCostError\]\) : null\}/,
    );
  });
});

describe("create cost (app/create.tsx) — optional-field semantics", () => {
  const src = read("app/create.tsx");

  it("migrated off the ad-hoc Number(x.replace(...)) parse", () => {
    assert.doesNotMatch(src, /Number\(cost\.replace/);
    assert.match(src, /parseCurrencyValueDetailed\(cost\.replace\(",", "\."\)\)/);
  });

  it("only NON-EMPTY invalid input blocks the save; empty stays silently-null", () => {
    assert.match(src, /parsedCost\.error && parsedCost\.error !== "empty"/);
    assert.match(src, /setCostError\(parsedCost\.error\)/);
    assert.match(src, /cost: parsedCost\.value/);
    assert.match(src, /costCurrency: parsedCost\.value !== null \? currency : null/);
  });

  it("renders <ErrorPill> under the cost row (raw input, no CurrencyInput here)", () => {
    assert.match(src, /import \{ ErrorPill \} from "@\/components\/error-pill"/);
    assert.match(
      src,
      /<ErrorPill label=\{costError \? t\(CURRENCY_ERROR_I18N_KEY\[costError\]\) : ""\} \/>/,
    );
  });

  it("clears the error on typing", () => {
    assert.match(src, /setCost\(v\);\s*setCostError\(null\);/);
  });
});
