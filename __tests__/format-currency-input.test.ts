import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { sanitizeCurrencyInput } from "@/lib/format-currency-input";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("sanitizeCurrencyInput", () => {
  it("passes clean numeric strings through untouched", () => {
    assert.equal(sanitizeCurrencyInput("1250"), "1250");
    assert.equal(sanitizeCurrencyInput("12.50"), "12.50");
    assert.equal(sanitizeCurrencyInput(""), "");
  });

  it("normalises a comma decimal separator to a dot", () => {
    assert.equal(sanitizeCurrencyInput("12,50"), "12.50");
    assert.equal(sanitizeCurrencyInput(",5"), ".5");
  });

  it("strips everything except digits and dots", () => {
    assert.equal(sanitizeCurrencyInput("$12.50"), "12.50");
    assert.equal(sanitizeCurrencyInput("1 250"), "1250");
    assert.equal(sanitizeCurrencyInput("12.50 USD"), "12.50");
    assert.equal(sanitizeCurrencyInput("abc"), "");
    assert.equal(sanitizeCurrencyInput("-5"), "5");
  });

  it("keeps only the first dot so multi-dot input stays parseable", () => {
    assert.equal(sanitizeCurrencyInput("1.2.3"), "1.23");
    assert.equal(sanitizeCurrencyInput("1..5"), "1.5");
    // first comma becomes THE dot, later dots fold into the decimals
    assert.equal(sanitizeCurrencyInput("1,000.50"), "1.00050");
  });

  it("output always parses as a finite number (or is empty/dot-only)", () => {
    for (const raw of ["12,50", "$99.99", "1.2.3", "abc12de3", "  7 "]) {
      const out = sanitizeCurrencyInput(raw);
      if (out && out !== ".") {
        assert.ok(Number.isFinite(Number(out)), `expected finite parse for "${raw}" -> "${out}"`);
      }
    }
  });
});

describe("CurrencyInput adoption", () => {
  it("sanitizes keystrokes through the shared lib helper (no private copy left)", () => {
    const src = read("components/currency-input.tsx");
    assert.match(src, /import \{ sanitizeCurrencyInput \} from "@\/lib\/format-currency-input"/);
    assert.match(src, /onChangeValue\(sanitizeCurrencyInput\(raw\)\)/);
    assert.doesNotMatch(src, /function sanitize\(/);
  });
});
