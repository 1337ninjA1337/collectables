import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { formatChatPreviewTimestamp, formatRelativeDate } from "../lib/i18n-context";

function isoAt(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

describe("formatChatPreviewTimestamp", () => {
  it("returns an HH:mm clock value for timestamps within the last hour", () => {
    const result = formatChatPreviewTimestamp(isoAt(-5 * 60 * 1000), "en");
    assert.match(result, /^\d{1,2}:\d{2}$/);
  });

  it("renders a stable HH:mm shape across all supported locales", () => {
    const locales = ["en", "ru", "de", "pl", "es", "be"] as const;
    const recent = isoAt(-10 * 60 * 1000);
    for (const locale of locales) {
      const result = formatChatPreviewTimestamp(recent, locale);
      assert.match(
        result,
        /^\d{1,2}:\d{2}$/,
        `expected HH:mm shape for locale "${locale}", got "${result}"`,
      );
    }
  });

  it("falls back to formatRelativeDate for timestamps older than 1 hour", () => {
    const olderIso = isoAt(-2 * 60 * 60 * 1000);
    assert.equal(
      formatChatPreviewTimestamp(olderIso, "en"),
      formatRelativeDate(olderIso, "en"),
    );
  });

  it("falls back to formatRelativeDate at the 1-hour boundary", () => {
    // 60 minutes exactly should already be relative ("1 hour ago"), not HH:mm.
    const boundaryIso = isoAt(-60 * 60 * 1000);
    const result = formatChatPreviewTimestamp(boundaryIso, "en");
    assert.doesNotMatch(result, /^\d{1,2}:\d{2}$/);
    assert.equal(result, formatRelativeDate(boundaryIso, "en"));
  });

  it("falls back to formatRelativeDate for future timestamps (clock skew)", () => {
    // A future timestamp could still be < 1h in absolute distance, but we
    // never want to surface a clock time that is in the future on a chat
    // preview — relative ("in 5 minutes") is the safer fallback.
    const futureIso = isoAt(5 * 60 * 1000);
    const result = formatChatPreviewTimestamp(futureIso, "en");
    assert.doesNotMatch(result, /^\d{1,2}:\d{2}$/);
    assert.equal(result, formatRelativeDate(futureIso, "en"));
  });

  it("returns the original string for an invalid ISO", () => {
    assert.equal(formatChatPreviewTimestamp("not-a-date", "en"), "not-a-date");
  });

  it("uses 24-hour clock (no AM/PM suffix) even in en-US", () => {
    const result = formatChatPreviewTimestamp(isoAt(-1 * 60 * 1000), "en");
    assert.doesNotMatch(result, /AM|PM/i);
  });
});
