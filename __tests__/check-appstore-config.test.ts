import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  findAppstoreConfigIssues,
  formatAppstoreConfigReport,
  REQUIRED_INFO_PLIST_KEYS,
} from "../lib/check-appstore-config";

/** A minimal valid config mirroring app.json's real shape. */
function validAppJson() {
  return {
    expo: {
      ios: {
        bundleIdentifier: "com.collectables.app",
        infoPlist: {
          NSPhotoLibraryUsageDescription: "photos",
          NSCameraUsageDescription: "camera",
          ITSAppUsesNonExemptEncryption: false,
          CFBundleDevelopmentRegion: "en",
          CFBundleLocalizations: ["en", "ru"],
        },
      },
    },
  };
}

const iconAlwaysExists = () => true;

describe("findAppstoreConfigIssues", () => {
  it("returns no issues for a valid config without an icon", () => {
    assert.deepEqual(
      findAppstoreConfigIssues({
        appJson: validAppJson(),
        iconExists: iconAlwaysExists,
      }),
      [],
    );
  });

  it("flags a missing or empty bundleIdentifier", () => {
    const noId = validAppJson();
    delete (noId.expo.ios as Record<string, unknown>).bundleIdentifier;
    assert.ok(
      findAppstoreConfigIssues({ appJson: noId, iconExists: iconAlwaysExists })
        .join("\n")
        .includes("bundleIdentifier"),
    );

    const emptyId = validAppJson();
    emptyId.expo.ios.bundleIdentifier = "  ";
    assert.ok(
      findAppstoreConfigIssues({
        appJson: emptyId,
        iconExists: iconAlwaysExists,
      })
        .join("\n")
        .includes("bundleIdentifier"),
    );
  });

  it("flags every missing required infoPlist key", () => {
    const config = validAppJson();
    config.expo.ios.infoPlist = {} as never;
    const issues = findAppstoreConfigIssues({
      appJson: config,
      iconExists: iconAlwaysExists,
    });
    for (const key of REQUIRED_INFO_PLIST_KEYS) {
      assert.ok(
        issues.some((issue) => issue.includes(key)),
        `expected an issue mentioning ${key}`,
      );
    }
  });

  it("flags a missing infoPlist object entirely", () => {
    const config = validAppJson();
    delete (config.expo.ios as Record<string, unknown>).infoPlist;
    const issues = findAppstoreConfigIssues({
      appJson: config,
      iconExists: iconAlwaysExists,
    });
    assert.deepEqual(issues, ["expo.ios.infoPlist must be an object"]);
  });

  it("requires ITSAppUsesNonExemptEncryption to be exactly false", () => {
    const config = validAppJson();
    (config.expo.ios.infoPlist as Record<string, unknown>)[
      "ITSAppUsesNonExemptEncryption"
    ] = "false";
    assert.ok(
      findAppstoreConfigIssues({
        appJson: config,
        iconExists: iconAlwaysExists,
      })
        .join("\n")
        .includes("ITSAppUsesNonExemptEncryption"),
    );
  });

  it("requires CFBundleLocalizations to cover the development region", () => {
    const config = validAppJson();
    config.expo.ios.infoPlist.CFBundleLocalizations = ["ru"];
    assert.ok(
      findAppstoreConfigIssues({
        appJson: config,
        iconExists: iconAlwaysExists,
      })
        .join("\n")
        .includes("CFBundleDevelopmentRegion"),
    );
  });

  it("flags empty usage-description strings", () => {
    const config = validAppJson();
    config.expo.ios.infoPlist.NSCameraUsageDescription = "";
    assert.ok(
      findAppstoreConfigIssues({
        appJson: config,
        iconExists: iconAlwaysExists,
      })
        .join("\n")
        .includes("NSCameraUsageDescription must be a non-empty string"),
    );
  });

  it("skips the icon check when the key is absent but enforces it when declared", () => {
    const noIcon = validAppJson();
    assert.deepEqual(
      findAppstoreConfigIssues({ appJson: noIcon, iconExists: () => false }),
      [],
      "absent icon key must not fail (manual asset step)",
    );

    const withIcon = validAppJson();
    (withIcon.expo.ios as Record<string, unknown>).icon = "./assets/icon.png";
    assert.deepEqual(
      findAppstoreConfigIssues({
        appJson: withIcon,
        iconExists: () => true,
      }),
      [],
    );
    assert.ok(
      findAppstoreConfigIssues({
        appJson: withIcon,
        iconExists: () => false,
      })
        .join("\n")
        .includes("does not exist on disk"),
    );
  });

  it("handles a structurally broken app.json", () => {
    assert.deepEqual(
      findAppstoreConfigIssues({ appJson: null, iconExists: iconAlwaysExists }),
      ["app.json must declare a top-level `expo` object"],
    );
    assert.deepEqual(
      findAppstoreConfigIssues({
        appJson: { expo: {} },
        iconExists: iconAlwaysExists,
      }),
      ["app.json must declare an `expo.ios` object"],
    );
  });

  it("passes against the real app.json on disk", () => {
    const real = JSON.parse(
      readFileSync(path.join(process.cwd(), "app.json"), "utf8"),
    );
    assert.deepEqual(
      findAppstoreConfigIssues({
        appJson: real,
        iconExists: (p) => existsSync(path.join(process.cwd(), p)),
      }),
      [],
    );
  });
});

describe("formatAppstoreConfigReport", () => {
  it("returns empty for no issues and a headed list otherwise", () => {
    assert.equal(formatAppstoreConfigReport([]), "");
    const report = formatAppstoreConfigReport(["issue a", "issue b"]);
    assert.match(report, /2 App Store config issue\(s\)/);
    assert.ok(report.includes("issue a") && report.includes("issue b"));
  });
});

describe("lint wiring", () => {
  it("registers lint:appstore in package.json and lint:ci", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    );
    assert.equal(
      pkg.scripts["lint:appstore"],
      "tsx scripts/check-appstore-config.ts",
    );
    assert.ok(
      pkg.scripts["lint:ci"].includes("npm run lint:appstore"),
      "lint:ci must run lint:appstore",
    );
  });

  it("runs the pre-flight in the CI workflow", () => {
    const ci = readFileSync(
      path.join(process.cwd(), ".github", "workflows", "ci.yml"),
      "utf8",
    );
    assert.ok(
      ci.includes("npm run lint:appstore"),
      "ci.yml must run lint:appstore",
    );
  });
});
