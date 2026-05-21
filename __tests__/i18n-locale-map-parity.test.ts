import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { languageCurrencyMap, languageLocaleMap } from "@/lib/locale-helpers";

/**
 * Structural parity guard between the i18n `languageOptions` picker (the
 * source of truth for which languages the UI actually surfaces) and the
 * locale-derived `languageCurrencyMap` / `languageLocaleMap` helpers.
 *
 * A new language added to `languageOptions` but not to either map would
 * silently fall back to USD (currency) or to a bare language tag (locale) —
 * this test fails closed so the drift is caught at PR time.
 *
 * `lib/i18n-context.tsx` imports react-native peers, so we parse the source
 * file rather than importing it (same pattern as `i18n-translations.test.ts`).
 */

const SOURCE = readFileSync(
  path.join(process.cwd(), "lib", "i18n-context.tsx"),
  "utf8",
);

function parseLanguageOptionCodes(): string[] {
  const block = SOURCE.match(
    /languageOptions\s*:\s*\{\s*code[\s\S]*?\}\s*\[\s*\]\s*=\s*\[([\s\S]*?)\];/,
  );
  assert.ok(block, "languageOptions declaration not found in lib/i18n-context.tsx");
  const codes: string[] = [];
  const codeRegex = /code:\s*"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = codeRegex.exec(block![1])) !== null) {
    codes.push(match[1]);
  }
  return codes;
}

describe("i18n languageOptions ↔ locale-helpers parity", () => {
  it("languageOptions declares at least one language", () => {
    const codes = parseLanguageOptionCodes();
    assert.ok(codes.length > 0, "expected languageOptions to list languages");
  });

  it("every languageOptions code has an entry in languageCurrencyMap", () => {
    const codes = parseLanguageOptionCodes();
    for (const code of codes) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(languageCurrencyMap, code),
        `language "${code}" is listed in languageOptions but missing from languageCurrencyMap — ` +
          `the picker would silently fall back to USD for this language`,
      );
    }
  });

  it("every languageOptions code has an entry in languageLocaleMap", () => {
    const codes = parseLanguageOptionCodes();
    for (const code of codes) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(languageLocaleMap, code),
        `language "${code}" is listed in languageOptions but missing from languageLocaleMap — ` +
          `Intl.* formatters would degrade to a bare language tag for this language`,
      );
    }
  });

  it("languageCurrencyMap has no orphan keys missing from languageOptions", () => {
    // Catches the reverse drift: a currency mapped for a language the UI
    // doesn't even expose. Not strictly broken, but a sign the maps are
    // out of sync (or the picker accidentally lost an entry).
    const codes = new Set(parseLanguageOptionCodes());
    for (const code of Object.keys(languageCurrencyMap)) {
      assert.ok(
        codes.has(code),
        `languageCurrencyMap entry "${code}" has no matching languageOptions row`,
      );
    }
  });
});
