import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { classifyInvalidPrice } from "../lib/analytics-helpers";
import { ANALYTICS_EVENTS } from "../lib/analytics-events";
import { findPiiPropKeys } from "../lib/analytics-pii";
import { parseCurrencyValueDetailed } from "../lib/format-currency-input";

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

  it("delegates outright to parseCurrencyValueDetailed (no second decision table)", () => {
    // The classifier and the parser used to be two pinned copies; now the
    // classifier IS the parser's error channel, so drift is impossible.
    const src = read("lib/analytics-helpers.ts");
    assert.match(src, /return parseCurrencyValueDetailed\(raw\)\.error;/);
    assert.match(
      src,
      /import \{\s*parseCurrencyValueDetailed,\s*type CurrencyValueError,\s*\} from "@\/lib\/format-currency-input"/,
    );
    assert.match(src, /export type InvalidPriceReason = CurrencyValueError;/);
    for (const raw of ["", "  ", "abc", "1.2.3", "0", "-5", "12.50"]) {
      assert.equal(
        classifyInvalidPrice(raw),
        parseCurrencyValueDetailed(raw).error,
        JSON.stringify(raw),
      );
    }
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

  it("fires from the parseCurrencyValueDetailed failure branch, gated on a non-null reason", () => {
    const src = read("app/item/[id].tsx");
    const failIdx = src.indexOf("if (parsed.error)");
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
