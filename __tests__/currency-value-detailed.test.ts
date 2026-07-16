import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { classifyInvalidPrice } from "../lib/analytics-helpers";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// parseCurrencyValueDetailed lives in components/currency-input.tsx (pulls
// react-native at module scope), so — like the classifyInvalidPrice lock-step
// suite — its gates are pinned structurally and the runtime truth table rides
// the shared classifier, whose vocabulary the parser deliberately reuses.
describe("parseCurrencyValueDetailed — structural pins", () => {
  const src = read("components/currency-input.tsx");

  it("declares the error vocabulary shared with InvalidPriceReason", () => {
    assert.match(
      src,
      /export type CurrencyValueError = "empty" \| "unparseable" \| "non_positive"/,
    );
    assert.match(src, /\{ value: number; error: null \}/);
    assert.match(src, /\{ value: null; error: CurrencyValueError \}/);
  });

  it("mirrors parseCurrencyValue's gate order (empty → non-finite → <= 0)", () => {
    const idx = src.indexOf("export function parseCurrencyValueDetailed");
    assert.ok(idx >= 0, "parseCurrencyValueDetailed not found");
    const block = src.slice(idx, idx + 500);
    const emptyGate = block.indexOf('if (!value.trim()) return { value: null, error: "empty" }');
    const finiteGate = block.indexOf('if (!Number.isFinite(n)) return { value: null, error: "unparseable" }');
    const positiveGate = block.indexOf('if (n <= 0) return { value: null, error: "non_positive" }');
    assert.ok(emptyGate >= 0, "empty gate missing");
    assert.ok(finiteGate > emptyGate, "non-finite gate missing or out of order");
    assert.ok(positiveGate > finiteGate, "non-positive gate missing or out of order");
    assert.match(block, /return \{ value: n, error: null \}/);
  });

  it("keeps the happy-path parseCurrencyValue shape untouched", () => {
    const idx = src.indexOf("export function parseCurrencyValue(");
    assert.ok(idx >= 0);
    const block = src.slice(idx, idx + 400);
    assert.match(block, /number \| null/);
    assert.match(block, /if\s*\(\s*!value\.trim\(\)\s*\)\s*return null/);
  });
});

describe("parseCurrencyValueDetailed — truth table via the shared classifier", () => {
  // classifyInvalidPrice is pinned in lock-step with the parser's gates
  // (analytics-price-invalid.test.ts), so exercising it covers the same
  // decision table the detailed parser encodes.
  it("classifier error matches the vocabulary for every failure class", () => {
    assert.equal(classifyInvalidPrice(""), "empty");
    assert.equal(classifyInvalidPrice("   "), "empty");
    assert.equal(classifyInvalidPrice("1.2.3"), "unparseable");
    assert.equal(classifyInvalidPrice("abc"), "unparseable");
    assert.equal(classifyInvalidPrice("0"), "non_positive");
    assert.equal(classifyInvalidPrice("-1.50"), "non_positive");
    assert.equal(classifyInvalidPrice("12.50"), null);
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
