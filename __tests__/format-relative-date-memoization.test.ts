import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { formatRelativeDate } from "../lib/i18n-context";

const NOW_MS = Date.parse("2026-05-21T12:00:00Z");

function iso(offsetMs: number): string {
  return new Date(NOW_MS + offsetMs).toISOString();
}

/**
 * `Intl.RelativeTimeFormat` is the canonical formatter for "X minutes ago"
 * labels. Constructing it is non-trivial — V8 walks the ICU locale tables on
 * every `new`, which is fine for one-off labels but wasteful when a list view
 * renders N timestamps (chats list, marketplace cards, price history table).
 *
 * The fix is a module-scope `Map<bcp47, Intl.RelativeTimeFormat>` cache keyed
 * by the resolved BCP-47 tag (after `getDefaultLocaleForLanguage` does its
 * `ru` → `ru-RU` upgrade) so callers passing `AppLanguage` codes and callers
 * passing already-tagged locales both hit the same cache slot. This file
 * pins both the structural contract (the cache + getter are wired correctly)
 * and the behavioural contract (formatting is unchanged after the rewrite).
 */
function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("formatRelativeDate — Intl.RelativeTimeFormat memoization", () => {
  const src = read("lib/i18n-context.tsx");

  it("declares a module-scope cache keyed by BCP-47 tag", () => {
    assert.match(
      src,
      /const\s+relativeTimeFormatCache\s*=\s*new\s+Map<string,\s*Intl\.RelativeTimeFormat>\(\)/,
    );
  });

  it("exposes a getRelativeTimeFormat helper that hits the cache first", () => {
    // The helper must check the cache before constructing a new instance,
    // otherwise the cache is write-only and the new-allocation cost is paid
    // on every call.
    assert.match(
      src,
      /function\s+getRelativeTimeFormat\s*\([\s\S]*?relativeTimeFormatCache\.get\([\s\S]*?relativeTimeFormatCache\.set\(/,
    );
  });

  it("formatRelativeDate goes through the cached getter, not new Intl.RelativeTimeFormat directly", () => {
    // Capture only the formatRelativeDate function body to guarantee the
    // assertion targets the right call site (the cache helper also names
    // Intl.RelativeTimeFormat — that's expected).
    const fn = src.match(/export function formatRelativeDate[\s\S]*?\n\}/);
    assert.ok(fn, "formatRelativeDate function body not found");
    assert.match(fn![0], /rtf\s*=\s*getRelativeTimeFormat\(bcp47\)/);
    assert.doesNotMatch(fn![0], /new\s+Intl\.RelativeTimeFormat\b/);
  });

  it("still formats past and future timestamps for every supported locale", () => {
    // Behavioural regression guard — the memoization must not change the
    // string output. Calling each locale twice doubles as a smoke test that
    // a cached instance still formats correctly on subsequent calls.
    const past = iso(-1000 * 60 * 60 * 24 * 7);
    const future = iso(1000 * 60 * 60 * 24 * 7);
    for (const locale of ["en", "ru", "de", "pl", "es", "be"] as const) {
      assert.ok(formatRelativeDate(past, locale).length > 0);
      assert.ok(formatRelativeDate(future, locale).length > 0);
      // Second call goes through the cache — output must be unchanged.
      assert.equal(
        formatRelativeDate(past, locale),
        formatRelativeDate(past, locale),
      );
    }
  });

  it("preserves the invalid-iso passthrough", () => {
    assert.equal(formatRelativeDate("not-a-date", "en"), "not-a-date");
  });
});
