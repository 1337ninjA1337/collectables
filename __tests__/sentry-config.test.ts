import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveSentryConfig } from "../lib/sentry-config";

const appJson = JSON.parse(
  readFileSync(path.join(process.cwd(), "app.json"), "utf8"),
);
const APP_VERSION: string = appJson.expo.version;

describe("resolveSentryConfig", () => {
  it("disables the SDK when no DSN is provided", () => {
    const cfg = resolveSentryConfig({});
    assert.equal(cfg.dsn, "");
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.environment, "production");
  });

  it("disables the SDK in development even if a DSN is provided", () => {
    const cfg = resolveSentryConfig({
      EXPO_PUBLIC_SENTRY_DSN: "https://abc@o0.ingest.sentry.io/1",
      EXPO_PUBLIC_SENTRY_ENV: "development",
    });
    assert.equal(cfg.dsn, "https://abc@o0.ingest.sentry.io/1");
    assert.equal(cfg.environment, "development");
    assert.equal(cfg.enabled, false);
  });

  it("enables the SDK in production when DSN is provided", () => {
    const cfg = resolveSentryConfig({
      EXPO_PUBLIC_SENTRY_DSN: "https://abc@o0.ingest.sentry.io/1",
      EXPO_PUBLIC_SENTRY_ENV: "production",
    });
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.environment, "production");
  });

  it("treats staging as enabled when DSN is provided", () => {
    const cfg = resolveSentryConfig({
      EXPO_PUBLIC_SENTRY_DSN: "https://abc@o0.ingest.sentry.io/1",
      EXPO_PUBLIC_SENTRY_ENV: "staging",
    });
    assert.equal(cfg.environment, "staging");
    assert.equal(cfg.enabled, true);
  });

  it("falls back to production when SENTRY_ENV is unset or unknown", () => {
    assert.equal(
      resolveSentryConfig({
        EXPO_PUBLIC_SENTRY_DSN: "https://x@o0.ingest.sentry.io/1",
      }).environment,
      "production",
    );
    assert.equal(
      resolveSentryConfig({
        EXPO_PUBLIC_SENTRY_DSN: "https://x@o0.ingest.sentry.io/1",
        EXPO_PUBLIC_SENTRY_ENV: "qa",
      }).environment,
      "production",
    );
  });

  it("trims whitespace around the DSN", () => {
    const cfg = resolveSentryConfig({
      EXPO_PUBLIC_SENTRY_DSN: "   https://x@o0.ingest.sentry.io/1   ",
      EXPO_PUBLIC_SENTRY_ENV: "production",
    });
    assert.equal(cfg.dsn, "https://x@o0.ingest.sentry.io/1");
    assert.equal(cfg.enabled, true);
  });

  it("treats whitespace-only DSN as missing", () => {
    const cfg = resolveSentryConfig({
      EXPO_PUBLIC_SENTRY_DSN: "   ",
      EXPO_PUBLIC_SENTRY_ENV: "production",
    });
    assert.equal(cfg.dsn, "");
    assert.equal(cfg.enabled, false);
  });

  it("derives release from EXPO_PUBLIC_APP_VERSION when set", () => {
    const cfg = resolveSentryConfig({
      EXPO_PUBLIC_APP_VERSION: "2.4.1",
    });
    assert.equal(cfg.release, "collectables@2.4.1");
  });

  it("falls back to app.json version when EXPO_PUBLIC_APP_VERSION is unset", () => {
    const cfg = resolveSentryConfig({});
    assert.equal(cfg.release, `collectables@${APP_VERSION}`);
  });

  it("honours defaultRelease override when EXPO_PUBLIC_APP_VERSION is unset", () => {
    const cfg = resolveSentryConfig(
      {},
      { defaultRelease: "collectables@override" },
    );
    assert.equal(cfg.release, "collectables@override");
  });

  it("EXPO_PUBLIC_APP_VERSION takes precedence over defaultRelease", () => {
    const cfg = resolveSentryConfig(
      { EXPO_PUBLIC_APP_VERSION: "9.9.9" },
      { defaultRelease: "collectables@override" },
    );
    assert.equal(cfg.release, "collectables@9.9.9");
  });
});

describe("lib/sentry-config.ts purity", () => {
  it("does not import react-native or any RN module", () => {
    const src = readFileSync(
      path.join(process.cwd(), "lib", "sentry-config.ts"),
      "utf8",
    );
    assert.doesNotMatch(
      src,
      /from\s+["']react-native["']/,
      "lib/sentry-config.ts must remain pure (no react-native import)",
    );
    assert.doesNotMatch(
      src,
      /from\s+["']@sentry\/react-native["']/,
      "lib/sentry-config.ts must not import the Sentry SDK directly",
    );
  });
});
