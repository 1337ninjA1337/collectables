/**
 * Single aggregation point for every env-driven runtime config module.
 *
 * Today each feature (Cloudinary uploads, Sentry crash tracking, PostHog/
 * Clarity analytics) owns its own `lib/*-config.ts` helper that memoises a
 * validated config object from `process.env`. Modules that need any config
 * import that helper directly, so the env-validation surface is spread across
 * the codebase and it is not obvious where the *next* env-driven knob should
 * live.
 *
 * This barrel re-exports the memoised configs (and their pure resolvers/types)
 * so callers can pull `runtimeConfig.sentry`, `runtimeConfig.cloudinary`, or
 * `runtimeConfig.analytics` from one place. When a new env-driven feature lands
 * (e.g. a future PostHog reverse-proxy toggle), add its `*-config.ts` helper
 * and wire it in here — the parity test keeps the docs honest.
 *
 * Pure re-exports only: importing this file has the same side effects as
 * importing the underlying `*-config.ts` modules (each memoises off
 * `process.env` at module-eval time), so it stays safe to import from tests.
 */
import {
  analyticsConfig,
  resolveAnalyticsConfig,
  type AnalyticsConfig,
} from "@/lib/analytics-config";
import {
  cloudinaryConfig,
  resolveCloudinaryConfig,
  type CloudinaryConfig,
} from "@/lib/cloudinary-config";
import {
  resolveSentryConfig,
  sentryConfig,
  type SentryConfig,
} from "@/lib/sentry-config";

export type { AnalyticsConfig, CloudinaryConfig, SentryConfig };
export {
  analyticsConfig,
  cloudinaryConfig,
  resolveAnalyticsConfig,
  resolveCloudinaryConfig,
  resolveSentryConfig,
  sentryConfig,
};

/**
 * The shape of the aggregated runtime config. Extend this (and
 * {@link runtimeConfig}) when a new env-driven module is co-located here.
 */
export type RuntimeConfig = {
  analytics: AnalyticsConfig;
  cloudinary: CloudinaryConfig;
  sentry: SentryConfig;
};

/**
 * Memoised snapshot of every env-driven config resolved at module-eval time.
 * A single object callers can destructure instead of importing three helpers.
 */
export const runtimeConfig: RuntimeConfig = {
  analytics: analyticsConfig,
  cloudinary: cloudinaryConfig,
  sentry: sentryConfig,
};
