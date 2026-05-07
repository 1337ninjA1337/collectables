import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const guidePath = path.join(process.cwd(), "APPSTORE-SUBMISSION.md");
const guide = readFileSync(guidePath, "utf8");

describe("APPSTORE-SUBMISSION.md", () => {
  it("documents the bundle identifier from app.json", () => {
    const appJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "app.json"), "utf8"),
    );
    const bundleId = appJson?.expo?.ios?.bundleIdentifier;
    assert.ok(bundleId, "app.json must declare ios.bundleIdentifier");
    assert.ok(
      guide.includes(bundleId),
      `guide must reference the iOS bundle identifier ('${bundleId}')`,
    );
  });

  it("covers every major submission phase", () => {
    const requiredSections = [
      "Prerequisites",
      "Bundle identifier",
      "app.json",
      "assets",
      "Privacy",
      "EAS",
      "Submit",
      "TestFlight",
      "checklist",
    ];
    for (const section of requiredSections) {
      assert.match(
        guide,
        new RegExp(section, "i"),
        `guide is missing section matching '${section}'`,
      );
    }
  });

  it("lists the required iOS Info.plist usage descriptions", () => {
    const requiredKeys = [
      "NSPhotoLibraryUsageDescription",
      "NSCameraUsageDescription",
      "ITSAppUsesNonExemptEncryption",
    ];
    for (const key of requiredKeys) {
      assert.ok(
        guide.includes(key),
        `guide must mention the Info.plist key '${key}'`,
      );
    }
  });

  it("lists the EAS commands needed for build + submission", () => {
    const commands = [
      "eas build --platform ios",
      "eas submit --platform ios",
      "eas credentials",
    ];
    for (const cmd of commands) {
      assert.ok(
        guide.includes(cmd),
        `guide must show the '${cmd}' invocation`,
      );
    }
  });

  it("references the same EXPO_PUBLIC_* secrets as the deploy workflow", () => {
    const requiredSecrets = [
      "EXPO_PUBLIC_SUPABASE_URL",
      "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "EXPO_PUBLIC_APP_URL",
    ];
    for (const secret of requiredSecrets) {
      assert.ok(
        guide.includes(secret),
        `guide must reference the '${secret}' env var`,
      );
    }
  });

  it("lists every supported app language for CFBundleLocalizations", () => {
    const languages = ["en", "ru", "be", "pl", "de", "es"];
    for (const lang of languages) {
      assert.match(
        guide,
        new RegExp(`['"]${lang}['"]`),
        `guide must declare '${lang}' under CFBundleLocalizations`,
      );
    }
  });
});

describe("README-DEPLOY.md", () => {
  it("links to the App Store submission guide", () => {
    const readme = readFileSync(
      path.join(process.cwd(), "README-DEPLOY.md"),
      "utf8",
    );
    assert.match(
      readme,
      /APPSTORE-SUBMISSION\.md/,
      "README-DEPLOY.md must point readers at APPSTORE-SUBMISSION.md",
    );
  });
});
