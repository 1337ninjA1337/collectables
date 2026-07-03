import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural guards over the iOS submission block in app.json. The strings
 * used to live only in APPSTORE-SUBMISSION.md's checklist; now that they are
 * codified in app.json these tests keep the two in sync and make sure a
 * future edit can't silently drop a key Apple rejects builds for.
 */

const appJson = JSON.parse(
  readFileSync(path.join(process.cwd(), "app.json"), "utf8"),
);
const ios = appJson?.expo?.ios ?? {};
const infoPlist = ios.infoPlist ?? {};

const guide = readFileSync(
  path.join(process.cwd(), "APPSTORE-SUBMISSION.md"),
  "utf8",
);

const i18nSource = readFileSync(
  path.join(process.cwd(), "lib", "i18n-context.tsx"),
  "utf8",
);

describe("app.json iOS submission config", () => {
  it("declares every required Info.plist usage-description key", () => {
    const requiredStringKeys = [
      "NSPhotoLibraryUsageDescription",
      "NSPhotoLibraryAddUsageDescription",
      "NSCameraUsageDescription",
    ];
    for (const key of requiredStringKeys) {
      const value = infoPlist[key];
      assert.equal(
        typeof value,
        "string",
        `ios.infoPlist.${key} must be a string`,
      );
      assert.ok(
        value.trim().length > 0,
        `ios.infoPlist.${key} must be non-empty`,
      );
    }
  });

  it("opts out of the export-compliance questionnaire", () => {
    assert.equal(
      infoPlist.ITSAppUsesNonExemptEncryption,
      false,
      "ITSAppUsesNonExemptEncryption must be exactly false",
    );
  });

  it("declares a development region covered by CFBundleLocalizations", () => {
    assert.equal(infoPlist.CFBundleDevelopmentRegion, "en");
    assert.ok(
      Array.isArray(infoPlist.CFBundleLocalizations) &&
        infoPlist.CFBundleLocalizations.includes(
          infoPlist.CFBundleDevelopmentRegion,
        ),
      "CFBundleLocalizations must include the development region",
    );
  });

  it("keeps CFBundleLocalizations in lock-step with the AppLanguage union", () => {
    const unionMatch = i18nSource.match(
      /export type AppLanguage\s*=\s*([^;]+);/,
    );
    assert.ok(unionMatch, "lib/i18n-context.tsx must export AppLanguage");
    const supported = [...unionMatch[1].matchAll(/"([a-z-]+)"/g)].map(
      (m) => m[1],
    );
    assert.ok(supported.length >= 2, "AppLanguage union parse sanity check");

    const localizations = infoPlist.CFBundleLocalizations;
    assert.ok(
      Array.isArray(localizations),
      "ios.infoPlist.CFBundleLocalizations must be an array",
    );
    assert.deepEqual(
      [...localizations].sort(),
      [...supported].sort(),
      "CFBundleLocalizations must match the supported AppLanguage codes exactly",
    );
  });

  it("declares the Universal Links associated domain for the OAuth callback", () => {
    assert.ok(
      Array.isArray(ios.associatedDomains) &&
        ios.associatedDomains.includes("applinks:1337ninja1337.github.io"),
      "ios.associatedDomains must include applinks:1337ninja1337.github.io",
    );
  });

  it("mirrors the usage-description strings documented in APPSTORE-SUBMISSION.md", () => {
    for (const key of [
      "NSPhotoLibraryUsageDescription",
      "NSPhotoLibraryAddUsageDescription",
      "NSCameraUsageDescription",
    ]) {
      assert.ok(
        guide.includes(infoPlist[key]),
        `APPSTORE-SUBMISSION.md must document the same ${key} string as app.json`,
      );
    }
  });
});
