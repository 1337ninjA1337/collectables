import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { findLocaleBlock, localeKeys } from "@/lib/i18n-source";
import { readI18nSource } from "./helpers/i18n-source-file";

const i18nSrc = readI18nSource();

const layoutSrc = readFileSync(
  path.join(process.cwd(), "app", "_layout.tsx"),
  "utf8",
);

const REQUIRED_KEYS = [
  "crashFallbackTitle",
  "crashFallbackBody",
  "crashFallbackRetry",
] as const;

const LANGUAGES = ["en", "ru", "be", "pl", "de", "es"] as const;

describe("Crash #13 — i18n keys present in English master map", () => {
  for (const key of REQUIRED_KEYS) {
    it(`'${key}' is declared in en`, () => {
      assert.ok(
        localeKeys(i18nSrc, "en").has(key),
        `'${key}' must be declared inside the en map`,
      );
    });
  }
});

describe("Crash #13 — every locale either spreads ...en or declares the key", () => {
  for (const lang of LANGUAGES) {
    if (lang === "en") continue;
    it(`'${lang}' inherits or overrides every fallback key`, () => {
      const block = findLocaleBlock(i18nSrc, lang);
      assert.ok(block, `could not locate '${lang}' map`);
      // Either the language spreads ...en (then inheritance is automatic) or
      // it declares the key inline.
      for (const key of REQUIRED_KEYS) {
        assert.ok(
          block!.inheritsBase || block!.keys.includes(key),
          `'${lang}' must spread ...en or declare '${key}' inline`,
        );
      }
    });
  }
});

describe("Crash #13 — non-English locales declare localised crash strings", () => {
  // Ensures the strings are actually translated, not just inherited from English.
  const localised = ["ru", "be", "pl", "de", "es"] as const;
  for (const lang of localised) {
    it(`'${lang}' declares its own crashFallbackTitle override`, () => {
      assert.ok(
        localeKeys(i18nSrc, lang).has("crashFallbackTitle"),
        `'${lang}' must override crashFallbackTitle`,
      );
    });
  }
});

describe("Crash #13 — useOptionalI18n + LocalizedCrashFallback wiring", () => {
  it("i18n-context exports useOptionalI18n", () => {
    assert.match(
      i18nSrc,
      /export function useOptionalI18n\(\)/,
      "lib/i18n-context.tsx must export useOptionalI18n",
    );
  });

  it("_layout.tsx imports useOptionalI18n", () => {
    assert.match(
      layoutSrc,
      /import\s*\{[^}]*useOptionalI18n[^}]*\}\s*from\s*["']@\/lib\/i18n-context["']/,
    );
  });

  it("_layout.tsx defines a LocalizedCrashFallback wrapper", () => {
    assert.match(layoutSrc, /function LocalizedCrashFallback/);
  });

  it("LocalizedCrashFallback consumes useOptionalI18n", () => {
    assert.match(
      layoutSrc,
      /function LocalizedCrashFallback[\s\S]*?useOptionalI18n\(\)/,
    );
  });

  it("ErrorBoundary fallback now renders LocalizedCrashFallback", () => {
    assert.match(
      layoutSrc,
      /<LocalizedCrashFallback\s+error=\{error\}\s+resetError=\{resetError\}/,
    );
  });
});
