import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const POSTHOG_VARS = [
  "EXPO_PUBLIC_POSTHOG_KEY",
  "EXPO_PUBLIC_POSTHOG_HOST",
  "EXPO_PUBLIC_CLARITY_PROJECT_ID",
];

describe("Analytics #2 — deps + env wiring", () => {
  it("package.json declares posthog-react-native + posthog-js as runtime deps", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
    };
    const deps = pkg.dependencies ?? {};
    assert.ok(
      typeof deps["posthog-react-native"] === "string" &&
        deps["posthog-react-native"].length > 0,
      "package.json must declare posthog-react-native under dependencies",
    );
    assert.ok(
      typeof deps["posthog-js"] === "string" && deps["posthog-js"].length > 0,
      "package.json must declare posthog-js under dependencies (web bundle)",
    );
  });

  it("README-DEPLOY.md documents each EXPO_PUBLIC_POSTHOG_* / CLARITY env var", () => {
    const src = read("README-DEPLOY.md");
    for (const name of POSTHOG_VARS) {
      assert.match(
        src,
        new RegExp(`\\|\\s*\`${name}\``),
        `README-DEPLOY.md must document the ${name} GitHub Actions secret in the secrets table`,
      );
    }
  });

  it("README-DEPLOY.md cites the EU PostHog host as the default", () => {
    const src = read("README-DEPLOY.md");
    assert.match(
      src,
      /eu\.posthog\.com/,
      "README-DEPLOY.md must mention https://eu.posthog.com as the default host so engineers know where data lands",
    );
  });

  it("APPSTORE-SUBMISSION.md documents each posthog/clarity EAS secret", () => {
    const src = read("APPSTORE-SUBMISSION.md");
    for (const name of POSTHOG_VARS) {
      assert.match(
        src,
        new RegExp(`eas secret:create[^\\n]*--name\\s+${name}\\b`),
        `APPSTORE-SUBMISSION.md must document an eas secret:create entry for ${name}`,
      );
    }
  });

  it("APPSTORE-SUBMISSION.md preserves the existing supabase/sentry EAS secrets", () => {
    const src = read("APPSTORE-SUBMISSION.md");
    for (const name of [
      "EXPO_PUBLIC_SUPABASE_URL",
      "EXPO_PUBLIC_SENTRY_DSN",
    ]) {
      assert.match(
        src,
        new RegExp(`--name\\s+${name}\\b`),
        `APPSTORE-SUBMISSION.md must keep the existing eas secret entry for ${name}`,
      );
    }
  });
});
