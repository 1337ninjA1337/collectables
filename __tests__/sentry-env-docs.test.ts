import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

const readme = readFileSync(path.join(root, "README-DEPLOY.md"), "utf8");
const appstore = readFileSync(
  path.join(root, "APPSTORE-SUBMISSION.md"),
  "utf8",
);
const packageJson = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);

const SENTRY_ENV_VARS = [
  "EXPO_PUBLIC_SENTRY_DSN",
  "EXPO_PUBLIC_SENTRY_ENV",
] as const;

describe("Sentry env documentation parity", () => {
  it("ships @sentry/react-native as a runtime dependency", () => {
    const deps = packageJson.dependencies ?? {};
    assert.ok(
      typeof deps["@sentry/react-native"] === "string" &&
        deps["@sentry/react-native"].length > 0,
      "package.json must declare '@sentry/react-native' under dependencies",
    );
  });

  it("documents both Sentry env vars in README-DEPLOY.md", () => {
    for (const name of SENTRY_ENV_VARS) {
      assert.ok(
        readme.includes(name),
        `README-DEPLOY.md must reference '${name}' in the secrets table`,
      );
    }
  });

  it("documents both Sentry env vars in APPSTORE-SUBMISSION.md (EAS secrets)", () => {
    for (const name of SENTRY_ENV_VARS) {
      assert.ok(
        appstore.includes(name),
        `APPSTORE-SUBMISSION.md must reference '${name}' under the EAS secret block`,
      );
    }
  });

  it("flags Sentry as the planned crash reporter in APPSTORE-SUBMISSION.md", () => {
    assert.match(
      appstore,
      /@sentry\/react-native/,
      "APPSTORE-SUBMISSION.md must mention the Sentry SDK package once it's wired",
    );
  });
});
