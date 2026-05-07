import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  readAnalyticsEnvFromProcess,
  resolveAnalyticsConfig,
} from "../lib/analytics-config";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("resolveAnalyticsConfig", () => {
  it("disables analytics when the PostHog key is missing", () => {
    const cfg = resolveAnalyticsConfig({});
    assert.equal(cfg.posthogKey, "");
    assert.equal(cfg.enabled, false);
  });

  it("disables analytics in development even when the key is present", () => {
    const cfg = resolveAnalyticsConfig({
      EXPO_PUBLIC_POSTHOG_KEY: "phc_dev",
      EXPO_PUBLIC_ANALYTICS_ENV: "development",
    });
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.environment, "development");
  });

  it("enables analytics in production with a key present", () => {
    const cfg = resolveAnalyticsConfig({
      EXPO_PUBLIC_POSTHOG_KEY: "phc_prod",
      EXPO_PUBLIC_ANALYTICS_ENV: "production",
    });
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.environment, "production");
  });

  it("enables analytics in staging too", () => {
    const cfg = resolveAnalyticsConfig({
      EXPO_PUBLIC_POSTHOG_KEY: "phc_staging",
      EXPO_PUBLIC_ANALYTICS_ENV: "staging",
    });
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.environment, "staging");
  });

  it("falls back to EXPO_PUBLIC_SENTRY_ENV when EXPO_PUBLIC_ANALYTICS_ENV is absent", () => {
    const cfg = resolveAnalyticsConfig({
      EXPO_PUBLIC_POSTHOG_KEY: "phc_x",
      EXPO_PUBLIC_SENTRY_ENV: "production",
    });
    assert.equal(cfg.environment, "production");
    assert.equal(cfg.enabled, true);
  });

  it("collapses unknown environment values to production", () => {
    const cfg = resolveAnalyticsConfig({
      EXPO_PUBLIC_POSTHOG_KEY: "phc",
      EXPO_PUBLIC_ANALYTICS_ENV: "wat",
    });
    assert.equal(cfg.environment, "production");
  });

  it("defaults the host to the EU PostHog cloud when missing", () => {
    const cfg = resolveAnalyticsConfig({
      EXPO_PUBLIC_POSTHOG_KEY: "phc",
    });
    assert.equal(cfg.posthogHost, "https://eu.posthog.com");
  });

  it("respects an explicit host override", () => {
    const cfg = resolveAnalyticsConfig({
      EXPO_PUBLIC_POSTHOG_KEY: "phc",
      EXPO_PUBLIC_POSTHOG_HOST: "https://us.i.posthog.com",
    });
    assert.equal(cfg.posthogHost, "https://us.i.posthog.com");
  });

  it("trims whitespace around the PostHog key, host, and Clarity ID", () => {
    const cfg = resolveAnalyticsConfig({
      EXPO_PUBLIC_POSTHOG_KEY: "  phc_with_space  ",
      EXPO_PUBLIC_POSTHOG_HOST: "  https://eu.posthog.com  ",
      EXPO_PUBLIC_CLARITY_PROJECT_ID: "  abc123  ",
    });
    assert.equal(cfg.posthogKey, "phc_with_space");
    assert.equal(cfg.posthogHost, "https://eu.posthog.com");
    assert.equal(cfg.clarityId, "abc123");
  });

  it("falls back to the default host when the env value is whitespace-only", () => {
    const cfg = resolveAnalyticsConfig({
      EXPO_PUBLIC_POSTHOG_KEY: "phc",
      EXPO_PUBLIC_POSTHOG_HOST: "   ",
    });
    assert.equal(cfg.posthogHost, "https://eu.posthog.com");
  });

  it("returns an empty Clarity ID when missing — Clarity is optional, web-only", () => {
    const cfg = resolveAnalyticsConfig({
      EXPO_PUBLIC_POSTHOG_KEY: "phc",
    });
    assert.equal(cfg.clarityId, "");
    // Clarity emptiness does not gate enabled; PostHog key is the gate.
    assert.equal(cfg.enabled, true);
  });
});

describe("analytics-config — env inlining (Metro/babel)", () => {
  it("readAnalyticsEnvFromProcess references each EXPO_PUBLIC_* var literally", () => {
    const src = read("lib/analytics-config.ts");
    for (const name of [
      "EXPO_PUBLIC_POSTHOG_KEY",
      "EXPO_PUBLIC_POSTHOG_HOST",
      "EXPO_PUBLIC_CLARITY_PROJECT_ID",
    ]) {
      assert.match(
        src,
        new RegExp(`process\\.env\\.${name}\\b`),
        `lib/analytics-config.ts must reference process.env.${name} literally so Metro inlines it`,
      );
    }
  });

  it("does not pass `process.env` whole into resolveAnalyticsConfig", () => {
    const src = read("lib/analytics-config.ts");
    assert.doesNotMatch(
      src,
      /resolveAnalyticsConfig\(\s*process\.env\b/,
      "Use readAnalyticsEnvFromProcess() so each EXPO_PUBLIC_* is inlined — passing process.env whole would leave values undefined at runtime",
    );
  });

  it("readAnalyticsEnvFromProcess returns the expected key set", () => {
    const env = readAnalyticsEnvFromProcess();
    const keys = Object.keys(env).sort();
    assert.deepStrictEqual(keys, [
      "EXPO_PUBLIC_ANALYTICS_ENV",
      "EXPO_PUBLIC_CLARITY_PROJECT_ID",
      "EXPO_PUBLIC_POSTHOG_HOST",
      "EXPO_PUBLIC_POSTHOG_KEY",
      "EXPO_PUBLIC_SENTRY_ENV",
    ]);
  });
});

describe("analytics-config — purity (no react-native imports)", () => {
  it("module imports nothing from react-native or platform SDKs", () => {
    const src = read("lib/analytics-config.ts");
    assert.doesNotMatch(
      src,
      /from\s+["'](react-native|@react-native|posthog-react-native|posthog-js)/,
      "lib/analytics-config.ts must remain pure so non-RN tests can import it without a metro shim",
    );
  });
});
