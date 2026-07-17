import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  parseCurrencyValue,
  parseCurrencyValueDetailed,
} from "../lib/format-currency-input";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// Both parsers now live in the pure lib/format-currency-input.ts (no
// react-native at module scope), so the truth tables below run against the
// REAL parsers instead of riding classifyInvalidPrice's pinned copy.
describe("parseCurrencyValueDetailed — truth table", () => {
  it("empty / whitespace-only input is 'empty'", () => {
    for (const raw of ["", "   ", "\n"]) {
      assert.deepEqual(
        parseCurrencyValueDetailed(raw),
        { value: null, error: "empty" },
        JSON.stringify(raw),
      );
    }
  });

  it("non-numeric input is 'unparseable'", () => {
    for (const raw of ["abc", "1.2.3", "12,50", "1 000"]) {
      assert.deepEqual(
        parseCurrencyValueDetailed(raw),
        { value: null, error: "unparseable" },
        JSON.stringify(raw),
      );
    }
  });

  it("zero / negative input is 'non_positive'", () => {
    for (const raw of ["0", "-1.50", "0.00"]) {
      assert.deepEqual(
        parseCurrencyValueDetailed(raw),
        { value: null, error: "non_positive" },
        JSON.stringify(raw),
      );
    }
  });

  it("valid input returns the parsed number with a null error", () => {
    assert.deepEqual(parseCurrencyValueDetailed("12.50"), { value: 12.5, error: null });
    assert.deepEqual(parseCurrencyValueDetailed(" 5 "), { value: 5, error: null });
    assert.deepEqual(parseCurrencyValueDetailed("0.99"), { value: 0.99, error: null });
  });
});

describe("parseCurrencyValue ↔ parseCurrencyValueDetailed — agreement", () => {
  it("the two parsers never disagree about acceptance or the parsed value", () => {
    const samples = ["", "   ", "abc", "1.2.3", "12,50", "0", "-5", "0.00", "12", "12.50", " 5 ", "0.99"];
    for (const raw of samples) {
      const happy = parseCurrencyValue(raw);
      const detailed = parseCurrencyValueDetailed(raw);
      assert.equal(happy, detailed.value, JSON.stringify(raw));
      assert.equal(happy === null, detailed.error !== null, JSON.stringify(raw));
    }
  });
});

describe("parser home — moved-to-lib sweep", () => {
  it("the parsers and the i18n-key map live in lib/format-currency-input.ts", () => {
    const lib = read("lib/format-currency-input.ts");
    assert.match(lib, /export function parseCurrencyValue\(/);
    assert.match(lib, /export function parseCurrencyValueDetailed\(/);
    assert.match(
      lib,
      /export type CurrencyValueError = "empty" \| "unparseable" \| "non_positive"/,
    );
    assert.match(lib, /export const CURRENCY_ERROR_I18N_KEY = \{/);
  });

  it("components/currency-input.tsx no longer defines a private parser copy", () => {
    const src = read("components/currency-input.tsx");
    assert.doesNotMatch(src, /export function parseCurrencyValue/);
    assert.doesNotMatch(src, /export type CurrencyValueError/);
    assert.doesNotMatch(src, /CURRENCY_ERROR_I18N_KEY = \{/);
  });
});

describe("<ErrorPill> — inline validation pill", () => {
  const src = read("components/error-pill.tsx");

  it("is memoized with the named-function form", () => {
    assert.match(src, /export const ErrorPill = memo\(function ErrorPill\(/);
  });

  it("uses the DANGER_SOFT bg + DANGER_DEEP_2 text + RADIUS_PILL tokens", () => {
    assert.match(
      src,
      /import \{ DANGER_DEEP_2, DANGER_SOFT, RADIUS_PILL \} from "@\/lib\/design-tokens"/,
    );
    assert.match(src, /backgroundColor: DANGER_SOFT/);
    assert.match(src, /color: DANGER_DEEP_2/);
    assert.match(src, /borderRadius: RADIUS_PILL/);
  });

  it("renders nothing for an empty label and announces via accessibilityRole alert", () => {
    assert.match(src, /if \(!label\) return null;/);
    assert.match(src, /accessibilityRole="alert"/);
  });
});
