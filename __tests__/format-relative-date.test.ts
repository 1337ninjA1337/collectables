import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { formatRelativeDate } from "../lib/i18n-context";

const NOW = new Date("2026-05-01T12:00:00Z");

function iso(offsetMs: number): string {
  return new Date(NOW.getTime() + offsetMs).toISOString();
}

describe("formatRelativeDate", () => {
  it("returns a non-empty string for a past ISO date", () => {
    const result = formatRelativeDate(iso(-1000 * 60 * 60 * 24 * 30), "en");
    assert.ok(result.length > 0);
    assert.ok(typeof result === "string");
  });

  it("returns a non-empty string for a future ISO date", () => {
    const result = formatRelativeDate(iso(1000 * 60 * 60 * 24 * 30), "en");
    assert.ok(result.length > 0);
  });

  it("returns the original string for an invalid ISO", () => {
    assert.equal(formatRelativeDate("not-a-date", "en"), "not-a-date");
  });

  it("accepts different locales without throwing", () => {
    const locales = ["en", "ru", "de", "pl", "es", "be"] as const;
    const testIso = iso(-1000 * 60 * 60 * 24 * 10);
    for (const locale of locales) {
      assert.ok(formatRelativeDate(testIso, locale).length > 0);
    }
  });
});
