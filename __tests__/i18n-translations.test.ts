import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { TRANSLATION_BASE_LANGUAGE } from "@/lib/i18n-coverage";
import {
  findLocaleBlock,
  findObjectLiteral,
  languageOptionCodes,
} from "@/lib/i18n-source";

/**
 * Structural tests over the translations file without importing the React
 * context module (which pulls in React Native peers). The source of
 * `lib/i18n-context.tsx` is read through `lib/i18n-source.ts` — the one parser
 * for that file — rather than matched here: this suite used to carry three
 * regexes of its own, including a `([^}]+)` for the `translations` record that
 * read to the first `}` in the file and a "slice to the next `const`" that
 * attributed a key to a language by declaration order.
 */

const SOURCE = readFileSync(
  path.join(process.cwd(), "lib", "i18n-context.tsx"),
  "utf8",
);

const EXPECTED_LANGUAGES = ["ru", "en", "be", "pl", "de", "es"] as const;

const blockFor = (code: string) => {
  const block = findLocaleBlock(SOURCE, code);
  assert.ok(block, `missing translation map for '${code}'`);
  return block!;
};

describe("i18n translations", () => {
  it("declares every expected language object", () => {
    for (const code of EXPECTED_LANGUAGES) {
      // The base language ('en') is declared as a plain object; others receive
      // the TranslationMap annotation once the shape is locked in.
      assert.ok(blockFor(code).keys.length > 0, `'${code}' declares no keys`);
    }
  });

  it("registers all six languages in the translations record", () => {
    const record = findObjectLiteral(SOURCE, "translations");
    assert.ok(record, "translations record not found");
    for (const code of EXPECTED_LANGUAGES) {
      assert.ok(
        record!.keys.includes(code),
        `language '${code}' missing from translations record`,
      );
    }
  });

  it("has a declared map behind every entry of the translations record", () => {
    // The other direction: an entry registered with no map behind it is a
    // `ReferenceError` at import, and a shorthand entry naming the wrong
    // identifier is what would produce one.
    for (const code of findObjectLiteral(SOURCE, "translations")!.keys) {
      assert.ok(
        findLocaleBlock(SOURCE, code),
        `the record registers '${code}' and no \`const ${code}\` map declares it`,
      );
    }
  });

  it("registers all six languages in the language options", () => {
    const codes = languageOptionCodes(SOURCE);
    for (const code of EXPECTED_LANGUAGES) {
      assert.ok(codes.includes(code), `language '${code}' missing from the picker`);
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
      "itemsCount",
      "sharedWithPeople",
    ];

    const declared = new Set(blockFor(TRANSLATION_BASE_LANGUAGE).keys);
    for (const key of requiredKeys) {
      assert.ok(
        declared.has(key),
        `English translation map is missing key '${key}'`,
      );
    }
  });
});

describe("i18n premium-gate key coverage", () => {
  // Each key is attributed to the map that declares it, brace to brace — the
  // version of this suite that sliced "from this declaration to the next one"
  // attributed by declaration ORDER, so a map moved below another would have
  // taken its keys with it.
  it("English declares visibilityPrivatePremiumOnly directly", () => {
    assert.ok(
      blockFor(TRANSLATION_BASE_LANGUAGE).keys.includes(
        "visibilityPrivatePremiumOnly",
      ),
    );
  });

  it("every language either declares visibilityPrivatePremiumOnly or inherits it via ...en", () => {
    // A regression here would silently render the English string for non-English
    // users on the private-locked toast (create + edit collection screens).
    for (const code of EXPECTED_LANGUAGES) {
      const block = blockFor(code);
      const declares = block.keys.includes("visibilityPrivatePremiumOnly");
      const inheritsEn = code === TRANSLATION_BASE_LANGUAGE || block.inheritsBase;
      assert.ok(
        declares || inheritsEn,
        `language '${code}' neither declares visibilityPrivatePremiumOnly nor spreads ...en`,
      );
    }
  });
});
