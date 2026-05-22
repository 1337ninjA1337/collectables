import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { formatCostAmount } from "@/lib/format-cost";

describe("formatCostAmount", () => {
  it("formats integers without decimal noise", () => {
    assert.equal(formatCostAmount(0), "0");
    assert.equal(formatCostAmount(42), "42");
    assert.equal(formatCostAmount(1000), "1,000");
    assert.equal(formatCostAmount(1234567), "1,234,567");
  });

  it("rounds to 2 decimals and drops trailing zeros", () => {
    assert.equal(formatCostAmount(12.5), "12.5");
    assert.equal(formatCostAmount(12.50), "12.5");
    assert.equal(formatCostAmount(12.345), "12.35");
    assert.equal(formatCostAmount(12.344), "12.34");
    assert.equal(formatCostAmount(12.00001), "12");
  });

  it("inserts thousands separators for large amounts", () => {
    assert.equal(formatCostAmount(1234.56), "1,234.56");
    assert.equal(formatCostAmount(1234567.89), "1,234,567.89");
  });

  it("guards against non-finite inputs", () => {
    assert.equal(formatCostAmount(Number.NaN), "0");
    assert.equal(formatCostAmount(Number.POSITIVE_INFINITY), "0");
    assert.equal(formatCostAmount(Number.NEGATIVE_INFINITY), "0");
  });
});
