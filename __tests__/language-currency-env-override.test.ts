import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  DEFAULT_LANGUAGE_CURRENCY,
  getDefaultCurrencyForLanguage,
  languageCurrencyMap,
  parseLanguageCurrencyOverride,
} from "@/lib/locale-helpers";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("parseLanguageCurrencyOverride", () => {
  it("returns an empty record for empty / undefined / whitespace input", () => {
    assert.deepEqual(parseLanguageCurrencyOverride(undefined), {});
    assert.deepEqual(parseLanguageCurrencyOverride(""), {});
    assert.deepEqual(parseLanguageCurrencyOverride("   "), {});
    // Comma-only / colon-less garbage shouldn't produce ghost entries.
    assert.deepEqual(parseLanguageCurrencyOverride(",,,"), {});
  });

  it("parses the documented `lang:CODE,lang:CODE` format", () => {
    assert.deepEqual(parseLanguageCurrencyOverride("ru:RUB,en:EUR"), {
      ru: "RUB",
      en: "EUR",
    });
  });

  it("trims whitespace around tokens and around the colon", () => {
    assert.deepEqual(parseLanguageCurrencyOverride(" ru : RUB , en : EUR "), {
      ru: "RUB",
      en: "EUR",
    });
  });

  it("upper-cases currency codes and lower-cases language codes", () => {
    // QA shouldn't get bitten by `ru:eur` silently mapping nothing.
    assert.deepEqual(parseLanguageCurrencyOverride("RU:eur,EN:usd"), {
      ru: "EUR",
      en: "USD",
    });
  });

  it("drops invalid entries silently (no throws, no ghost keys)", () => {
    // Missing colon, empty key, non-3-letter currency, currency-only token.
    assert.deepEqual(
      parseLanguageCurrencyOverride("nope,:RUB,ru:R,ru:RUBB,ru:12A,:,xx:"),
      {},
    );
  });

  it("keeps valid entries when mixed alongside invalid tokens", () => {
    assert.deepEqual(parseLanguageCurrencyOverride("ru:RUB,bad,en:EUR,:,de:E"), {
      ru: "RUB",
      en: "EUR",
    });
  });

  it("last value wins on duplicate language keys", () => {
    assert.deepEqual(parseLanguageCurrencyOverride("ru:RUB,ru:EUR"), {
      ru: "EUR",
    });
  });
});

describe("DEFAULT_LANGUAGE_CURRENCY", () => {
  it("exposes the canonical 6-language map", () => {
    assert.deepEqual(
      { ...DEFAULT_LANGUAGE_CURRENCY },
      { ru: "RUB", be: "BYN", de: "EUR", pl: "PLN", es: "EUR", en: "USD" },
    );
  });

  it("is frozen so consumers can't mutate the canonical defaults", () => {
    assert.equal(Object.isFrozen(DEFAULT_LANGUAGE_CURRENCY), true);
  });
});

describe("languageCurrencyMap (with no env override set)", () => {
  it("matches DEFAULT_LANGUAGE_CURRENCY entry-for-entry", () => {
    // Tests don't set EXPO_PUBLIC_LANGUAGE_CURRENCY so the merged map must
    // equal the defaults — otherwise a future regression could quietly flip
    // currencies for every consumer.
    assert.deepEqual(
      { ...languageCurrencyMap },
      { ...DEFAULT_LANGUAGE_CURRENCY },
    );
  });

  it("getDefaultCurrencyForLanguage returns the default values", () => {
    assert.equal(getDefaultCurrencyForLanguage("ru"), "RUB");
    assert.equal(getDefaultCurrencyForLanguage("en"), "USD");
    assert.equal(getDefaultCurrencyForLanguage("ja"), "USD");
  });
});

describe("lib/locale-helpers.ts wiring (structural)", () => {
  const src = read("lib/locale-helpers.ts");

  it("derives LANGUAGE_CURRENCY by spreading defaults + the parsed override", () => {
    // The merge order matters: defaults first, then override, so any override
    // wins for the languages it names while unmentioned ones keep canonical.
    assert.match(
      src,
      /const\s+LANGUAGE_CURRENCY[\s\S]*?\.\.\.DEFAULT_LANGUAGE_CURRENCY[\s\S]*?\.\.\.parseLanguageCurrencyOverride\(/,
    );
  });

  it("reads the env var via the literal process.env.EXPO_PUBLIC_LANGUAGE_CURRENCY access", () => {
    // Metro/babel only inlines literal member accesses. A dynamic
    // `process.env[name]` lookup would read undefined in the production web
    // bundle (same foot-gun guarded for resolveNumericEnv / isRealtimeDisabledByEnv).
    assert.match(
      src,
      /parseLanguageCurrencyOverride\(\s*process\.env\.EXPO_PUBLIC_LANGUAGE_CURRENCY\s*\)/,
    );
  });

  it("does not use the computed process.env[...] pattern (Metro foot-gun)", () => {
    assert.doesNotMatch(src, /process\.env\[/);
  });

  it("freezes DEFAULT_LANGUAGE_CURRENCY at the source so consumers see immutability", () => {
    assert.match(src, /Object\.freeze\(\{[\s\S]*?ru:\s*"RUB"[\s\S]*?\}\)/);
  });

  it("exports parseLanguageCurrencyOverride + DEFAULT_LANGUAGE_CURRENCY for tests / future UI", () => {
    assert.match(src, /export\s+function\s+parseLanguageCurrencyOverride\b/);
    assert.match(src, /export\s+const\s+DEFAULT_LANGUAGE_CURRENCY\b/);
  });
});

describe("EXPO_PUBLIC_LANGUAGE_CURRENCY is discoverable in operator docs", () => {
  it("README-DEPLOY.md lists the variable + format in its secrets table", () => {
    const src = read("README-DEPLOY.md");
    assert.match(src, /`EXPO_PUBLIC_LANGUAGE_CURRENCY`/);
    assert.match(src, /lang:CODE,lang:CODE/);
    // Spot-check the example so an operator can copy-paste a working value.
    assert.match(src, /ru:RUB,en:EUR/);
  });

  it(".env.example carries the variable with the documented format", () => {
    const src = read(".env.example");
    assert.match(src, /^EXPO_PUBLIC_LANGUAGE_CURRENCY=/m);
    assert.match(src, /lang:CODE,lang:CODE|ru:RUB,en:EUR/);
  });
});
