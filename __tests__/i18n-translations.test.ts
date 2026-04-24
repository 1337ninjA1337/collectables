import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural tests over the translations file without importing the React
 * context module (which pulls in React Native peers). We parse the source of
 * lib/i18n-context.tsx and verify coverage of the six supported languages.
 */

const SOURCE = readFileSync(
  path.join(process.cwd(), "lib", "i18n-context.tsx"),
  "utf8",
);

const EXPECTED_LANGUAGES = ["ru", "en", "be", "pl", "de", "es"] as const;

describe("i18n translations", () => {
  it("declares every expected language object", () => {
    for (const code of EXPECTED_LANGUAGES) {
      // The base language ('en') is declared as a plain object; others receive
      // the TranslationMap annotation once the shape is locked in.
      const pattern = new RegExp(`const\\s+${code}(?::\\s*TranslationMap)?\\s*=\\s*{`);
      assert.match(SOURCE, pattern, `missing translation map for '${code}'`);
    }
  });

  it("registers all six languages in the translations record", () => {
    const declaration = SOURCE.match(
      /const\s+translations\s*:\s*Record<AppLanguage,\s*TranslationMap>\s*=\s*{([^}]+)}/,
    );
    assert.ok(declaration, "translations record not found");
    for (const code of EXPECTED_LANGUAGES) {
      assert.ok(
        new RegExp(`\\b${code}\\b`).test(declaration![1]),
        `language '${code}' missing from translations record`,
      );
    }
  });

  it("registers all six languages in the language options", () => {
    const block = SOURCE.match(/languageOptions\s*:\s*\{\s*code[\s\S]*?\}\s*\[\s*\]\s*=\s*\[([\s\S]*?)\];/);
    assert.ok(block, "languageOptions declaration not found");
    for (const code of EXPECTED_LANGUAGES) {
      assert.match(block![1], new RegExp(`code:\\s*"${code}"`));
    }
  });

  it("English map contains required runtime keys referenced across the app", () => {
    // A sample of keys that the UI references; breakage here likely means a
    // key was removed or renamed without updating the English fallback.
    const requiredKeys = [
      "appName",
      "profile",
      "signOut",
      "addItem",
      "createCollection",
      "noEmail",
      "settings",
      "language",
      "deleteAccountConfirm",
      "configureSupabase",
      "itemsCount",
      "sharedWithPeople",
    ];

    const enBlock = SOURCE.match(/const\s+en\s*:?\s*(?:TranslationMap)?\s*=\s*{([\s\S]*?)\n};/);
    assert.ok(enBlock, "could not locate English translation map");

    for (const key of requiredKeys) {
      assert.match(
        enBlock![1],
        new RegExp(`\\b${key}\\s*:`),
        `English translation map is missing key '${key}'`,
      );
    }
  });
});
