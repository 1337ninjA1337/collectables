import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { APP_VERSION } from "../lib/app-version";
import appConfig from "../app.config";
import { resolveSentryConfig } from "../lib/sentry-config";

const packageJson = JSON.parse(
  readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
);
const appJson = JSON.parse(
  readFileSync(path.join(process.cwd(), "app.json"), "utf8"),
);

describe("lib/app-version", () => {
  it("APP_VERSION mirrors package.json's version field", () => {
    assert.equal(APP_VERSION, packageJson.version);
  });

  it("is a plausible semver-ish string", () => {
    assert.match(APP_VERSION, /^\d+\.\d+\.\d+/);
  });
});

describe("app.config.ts", () => {
  it("auto-resolves expo.version from package.json", () => {
    assert.equal(appConfig.version, packageJson.version);
  });

  it("exports extra.expoPublicAppVersion for runtime consumers", () => {
    assert.equal(appConfig.extra.expoPublicAppVersion, packageJson.version);
  });

  it("preserves every app.json expo field except version/extra verbatim", () => {
    for (const key of Object.keys(appJson.expo)) {
      if (key === "version" || key === "extra") continue;
      assert.deepEqual(
        (appConfig as Record<string, unknown>)[key],
        appJson.expo[key],
        `app.config.ts dropped or mutated expo.${key} from app.json`,
      );
    }
  });

  it("preserves pre-existing app.json extra keys alongside the new one", () => {
    for (const key of Object.keys(appJson.expo.extra ?? {})) {
      assert.deepEqual(
        (appConfig.extra as Record<string, unknown>)[key],
        appJson.expo.extra[key],
        `app.config.ts dropped extra.${key} from app.json`,
      );
    }
  });
});

describe("Sentry release stays in sync with package.json", () => {
  it("default release is collectables@<package.json version>", () => {
    const cfg = resolveSentryConfig({});
    assert.equal(cfg.release, `collectables@${packageJson.version}`);
  });

  it("explicit CI release still wins over the package.json fallback", () => {
    const cfg = resolveSentryConfig({
      EXPO_PUBLIC_SENTRY_RELEASE: "collectables@deadbeef",
    });
    assert.equal(cfg.release, "collectables@deadbeef");
  });
});
