import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { classifyInvalidPrice } from "../lib/analytics-helpers";
import { ANALYTICS_EVENTS } from "../lib/analytics-events";
import { findPiiPropKeys } from "../lib/analytics-pii";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("classifyInvalidPrice — reason taxonomy", () => {
  it("empty / whitespace-only input is 'empty'", () => {
    for (const raw of ["", "   ", "\n"]) {
      assert.equal(classifyInvalidPrice(raw), "empty", JSON.stringify(raw));
    }
  });

  it("non-numeric input is 'unparseable'", () => {
    for (const raw of ["abc", "1.2.3", "12,50", "1 000"]) {
      assert.equal(
        classifyInvalidPrice(raw),
        "unparseable",
        JSON.stringify(raw),
      );
    }
  });

  it("zero / negative input is 'non_positive'", () => {
    for (const raw of ["0", "-5", "0.00"]) {
      assert.equal(
        classifyInvalidPrice(raw),
        "non_positive",
        JSON.stringify(raw),
      );
    }
  });

  it("a price parseCurrencyValue would accept classifies as null (never mislabelled)", () => {
    for (const raw of ["12", "0.99", " 5 "]) {
      assert.equal(classifyInvalidPrice(raw), null, JSON.stringify(raw));
    }
  });

  it("stays in lock-step with parseCurrencyValue's gates (structural pin)", () => {
    // The classifier mirrors the parser's decision order; if these gate
    // shapes change in components/currency-input.tsx, revisit
    // classifyInvalidPrice in lib/analytics-helpers.ts.
    const src = read("components/currency-input.tsx");
    const parserIdx = src.indexOf("export function parseCurrencyValue");
    assert.ok(parserIdx >= 0, "parseCurrencyValue not found");
    const block = src.slice(parserIdx, parserIdx + 400);
    assert.match(block, /if\s*\(\s*!value\.trim\(\)\s*\)\s*return null/);
    assert.match(block, /!Number\.isFinite\(n\)\s*\|\|\s*n\s*<=\s*0/);
  });
});

describe("listing_price_invalid — taxonomy + wiring", () => {
  it("registry entry declares { reason, language } and passes the PII rule", () => {
    assert.deepEqual(
      [...ANALYTICS_EVENTS.listing_price_invalid.props],
      ["reason", "language"],
    );
    assert.deepEqual(
      findPiiPropKeys(ANALYTICS_EVENTS.listing_price_invalid.props),
      [],
    );
  });

  it("fires from the parseCurrencyValue failure branch, gated on a non-null reason", () => {
    const src = read("app/item/[id].tsx");
    const failIdx = src.indexOf("if (finalPrice === null)");
    assert.ok(failIdx >= 0, "price-failure branch not found");
    const block = src.slice(failIdx, failIdx + 500);
    assert.match(
      block,
      /const\s+reason\s*=\s*classifyInvalidPrice\(\s*listingPrice\s*\)/,
      "reason must come from classifyInvalidPrice(listingPrice)",
    );
    assert.match(
      block,
      /if\s*\(\s*reason\s*\)\s*\{\s*trackEvent\(\s*["']listing_price_invalid["']\s*,\s*\{\s*reason\s*,\s*language\s*\}\s*\)/,
      "the event must be gated on a non-null reason and carry { reason, language }",
    );
    assert.match(
      block,
      /toast\.error\(/,
      "the user-facing toast must survive the instrumentation",
    );
  });
});
