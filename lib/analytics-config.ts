export type AnalyticsEnvironment = "development" | "staging" | "production";

export type AnalyticsConfig = {
  posthogKey: string;
  posthogHost: string;
  clarityId: string;
  environment: AnalyticsEnvironment;
  enabled: boolean;
};

const DEFAULT_POSTHOG_HOST = "https://eu.posthog.com";

function normaliseEnvironment(value: string | undefined): AnalyticsEnvironment {
  if (value === "staging") return "staging";
  if (value === "development") return "development";
  return "production";
}

export function resolveAnalyticsConfig(
  env: Record<string, string | undefined>,
): AnalyticsConfig {
  const posthogKey = (env.EXPO_PUBLIC_POSTHOG_KEY ?? "").trim();
  const posthogHostRaw = (env.EXPO_PUBLIC_POSTHOG_HOST ?? "").trim();
  const posthogHost = posthogHostRaw.length > 0 ? posthogHostRaw : DEFAULT_POSTHOG_HOST;
  const clarityId = (env.EXPO_PUBLIC_CLARITY_PROJECT_ID ?? "").trim();
  const environment = normaliseEnvironment(
    env.EXPO_PUBLIC_ANALYTICS_ENV ?? env.EXPO_PUBLIC_SENTRY_ENV,
  );
  const enabled = posthogKey.length > 0 && environment !== "development";
  return { posthogKey, posthogHost, clarityId, environment, enabled };
}

/**
 * Reads the analytics env vars from `process.env` using *literal* member
 * accesses so Expo's babel plugin (`babel-preset-expo`) inlines each value
 * into the JS bundle at build time. Passing `process.env` whole bypasses
 * inlining and the bundled code reads `undefined` at runtime — the bug
 * fixed for Sentry in `lib/sentry-config.ts:readSentryEnvFromProcess`.
 */
export function readAnalyticsEnvFromProcess(): Record<
  string,
  string | undefined
> {
  return {
    EXPO_PUBLIC_POSTHOG_KEY: process.env.EXPO_PUBLIC_POSTHOG_KEY,
    EXPO_PUBLIC_POSTHOG_HOST: process.env.EXPO_PUBLIC_POSTHOG_HOST,
    EXPO_PUBLIC_CLARITY_PROJECT_ID: process.env.EXPO_PUBLIC_CLARITY_PROJECT_ID,
    EXPO_PUBLIC_ANALYTICS_ENV: process.env.EXPO_PUBLIC_ANALYTICS_ENV,
    EXPO_PUBLIC_SENTRY_ENV: process.env.EXPO_PUBLIC_SENTRY_ENV,
  };
}

export const analyticsConfig: AnalyticsConfig = resolveAnalyticsConfig(
  readAnalyticsEnvFromProcess(),
);
