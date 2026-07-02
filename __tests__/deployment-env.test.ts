import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normaliseDeploymentEnv } from "../lib/deployment-env";
import { resolveSentryConfig } from "../lib/sentry-config";
import { resolveAnalyticsConfig } from "../lib/analytics-config";

describe("normaliseDeploymentEnv", () => {
  it("passes through the two non-production buckets exactly", () => {
    assert.equal(normaliseDeploymentEnv("staging"), "staging");
    assert.equal(normaliseDeploymentEnv("development"), "development");
  });

  it("falls back to production for undefined/empty/typo/mixed-case", () => {
    for (const value of [undefined, "", "prod", "Production", "STAGING", " staging"]) {
      assert.equal(normaliseDeploymentEnv(value), "production");
    }
  });

  it("is the single source of truth for both config resolvers", () => {
    // Both configs must resolve environments identically to the shared helper.
    for (const value of ["staging", "development", "production", "typo", undefined]) {
      const expected = normaliseDeploymentEnv(value);
      assert.equal(
        resolveSentryConfig({ EXPO_PUBLIC_SENTRY_ENV: value }).environment,
        expected,
        `sentry-config diverged for ${String(value)}`,
      );
      assert.equal(
        resolveAnalyticsConfig({ EXPO_PUBLIC_ANALYTICS_ENV: value }).environment,
        expected,
        `analytics-config diverged for ${String(value)}`,
      );
    }
  });
});
