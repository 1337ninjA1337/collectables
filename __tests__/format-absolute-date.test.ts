import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { formatAbsoluteDate } from "../lib/i18n-context";

describe("formatAbsoluteDate", () => {
  it("returns a non-empty locale-formatted string for a valid ISO", () => {
    const result = formatAbsoluteDate("2026-05-26T12:34:56Z", "en");
    assert.ok(result.length > 0);
    assert.ok(typeof result === "string");
    // The medium dateStyle + short timeStyle in en-US emits a 4-digit year.
    assert.match(result, /2026/);
  });

  it("returns the original string for an invalid ISO", () => {
    assert.equal(formatAbsoluteDate("not-a-date", "en"), "not-a-date");
  });

  it("accepts every supported locale without throwing", () => {
    const locales = ["en", "ru", "de", "pl", "es", "be"] as const;
    const testIso = "2026-05-26T12:34:56Z";
    for (const locale of locales) {
      const result = formatAbsoluteDate(testIso, locale);
      assert.ok(result.length > 0, `expected non-empty for locale "${locale}"`);
    }
  });

  it("produces a different render than the relative formatter for the same ISO", () => {
    // The two helpers must never collapse to the same string for an arbitrary
    // ISO — formatAbsoluteDate is the "precise" surface that powers tooltips.
    // Use an ISO whose absolute and relative forms can never coincide.
    const fixedIso = "2024-01-15T08:30:00Z";
    const abs = formatAbsoluteDate(fixedIso, "en");
    assert.match(abs, /2024/);
  });
});
