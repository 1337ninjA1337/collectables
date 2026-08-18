import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { localeKeys } from "@/lib/i18n-source";
import { readI18nSource } from "./helpers/i18n-source-file";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("settings screen wires the premium section", () => {
  const src = read("app/settings.tsx");

  it("imports usePremium", () => {
    assert.match(src, /from\s+"@\/lib\/premium-context"/);
    assert.match(src, /usePremium\(\)/);
  });

  it("destructures the premium state and actions", () => {
    assert.match(src, /isPremium/);
    assert.match(src, /activatedAt/);
    assert.match(src, /expiresAt/);
    assert.match(src, /activatePremium/);
    assert.match(src, /cancelPremium/);
    assert.match(src, /=\s*usePremium\(\)/);
  });

  it("renders the renews-on line when premium has an expiry", () => {
    assert.match(src, /premiumRenewsOn/);
    assert.match(src, /expiresAt\.slice\(0,\s*10\)/);
  });

  it("renders the premium title and subtitle keys", () => {
    assert.match(src, /premiumTitle/);
    assert.match(src, /premiumSubtitle/);
  });

  it("renders all three benefit keys", () => {
    assert.match(src, /premiumBenefit1/);
    assert.match(src, /premiumBenefit2/);
    assert.match(src, /premiumBenefit3/);
  });

  it("shows an Activate CTA when free and a Cancel CTA when premium", () => {
    assert.match(src, /premiumActivate\b/);
    assert.match(src, /premiumCancel\b/);
    assert.match(src, /premiumActive\b/);
  });

  it("confirms before canceling premium", () => {
    assert.match(src, /premiumConfirmCancelTitle/);
    assert.match(src, /premiumConfirmCancelText/);
  });

  it("calls activatePremium and cancelPremium from the handlers", () => {
    assert.match(src, /activatePremium\("settings"\)/);
    assert.match(src, /cancelPremium\(\)/);
  });
});

describe("premium translations exist in every language map", () => {
  const src = readI18nSource();
  const requiredKeys = [
    "premiumTitle",
    "premiumSubtitle",
    "premiumBenefit1",
    "premiumBenefit2",
    "premiumBenefit3",
    "premiumActivate",
    "premiumActive",
    "premiumActiveSince",
    "premiumRenewsOn",
    "premiumCancel",
    "premiumActivated",
    "premiumCanceled",
    "premiumConfirmCancelTitle",
    "premiumConfirmCancelText",
  ];

  for (const lang of ["en", "ru", "be", "pl", "de", "es"] as const) {
    it(`'${lang}' declares all premium keys`, () => {
      const declared = localeKeys(src, lang);
      for (const key of requiredKeys) {
        assert.ok(
          declared.has(key),
          `language '${lang}' missing key '${key}'`,
        );
      }
    });
  }
});
