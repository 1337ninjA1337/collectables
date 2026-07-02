import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  analyticsConfig,
  cloudinaryConfig,
  resolveAnalyticsConfig,
  resolveCloudinaryConfig,
  resolveSentryConfig,
  runtimeConfig,
  sentryConfig,
} from "../lib/runtime-config";

describe("runtime-config aggregator", () => {
  it("re-exports the memoised config singletons", () => {
    assert.equal(runtimeConfig.cloudinary, cloudinaryConfig);
    assert.equal(runtimeConfig.sentry, sentryConfig);
    assert.equal(runtimeConfig.analytics, analyticsConfig);
  });

  it("exposes exactly the known env-driven config slices", () => {
    assert.deepEqual(
      Object.keys(runtimeConfig).sort(),
      ["analytics", "cloudinary", "sentry"],
    );
  });

  it("re-exports the pure resolvers so callers need one import", () => {
    const cloud = resolveCloudinaryConfig({});
    assert.equal(cloud.cloudName, "dt57phtma");

    const sentry = resolveSentryConfig({});
    assert.equal(sentry.enabled, false);

    const analytics = resolveAnalyticsConfig({});
    assert.equal(analytics.enabled, false);
  });

  it("singletons match what the underlying resolvers would produce", () => {
    // The aggregator must not silently diverge from the source helpers.
    assert.equal(
      runtimeConfig.cloudinary.cloudName,
      cloudinaryConfig.cloudName,
    );
    assert.equal(runtimeConfig.sentry.release, sentryConfig.release);
  });
});
