import {
  normaliseDeploymentEnv,
  type DeploymentEnvironment,
} from "@/lib/deployment-env";

export type AnalyticsEnvironment = DeploymentEnvironment;

export type AnalyticsConfig = {
  posthogKey: string;
  posthogHost: string;
  clarityId: string;
  environment: AnalyticsEnvironment;
  enabled: boolean;
};

const DEFAULT_POSTHOG_HOST = "https://eu.posthog.com";

/**
 * Incident-response kill-switch parser. When `EXPO_PUBLIC_ANALYTICS_DISABLED`
 * is a truthy literal ("1", "true", "yes"), all analytics — PostHog *and*
 * Clarity, both gated by `AnalyticsConfig.enabled` — are forced off regardless
 * of key/environment. Lets an operator drop third-party tracking by flipping a
 * GitHub secret and re-running the deploy, with no code change. Mirrors
 * `isRealtimeDisabledByEnv` in `lib/supabase-realtime.ts`; kept inline here so
 * this module stays pure (no react-native import from `lib/env.ts`).
 */
export function isAnalyticsDisabledByEnv(rawValue: string | undefined): boolean {
  if (!rawValue) return false;
  const normalised = rawValue.trim().toLowerCase();
  return normalised === "1" || normalised === "true" || normalised === "yes";
}

export function resolveAnalyticsConfig(
  env: Record<string, string | undefined>,
): AnalyticsConfig {
  const posthogKey = (env.EXPO_PUBLIC_POSTHOG_KEY ?? "").trim();
  const posthogHostRaw = (env.EXPO_PUBLIC_POSTHOG_HOST ?? "").trim();
  const posthogHost = posthogHostRaw.length > 0 ? posthogHostRaw : DEFAULT_POSTHOG_HOST;
  const clarityId = (env.EXPO_PUBLIC_CLARITY_PROJECT_ID ?? "").trim();
  const environment = normaliseDeploymentEnv(
    env.EXPO_PUBLIC_ANALYTICS_ENV ?? env.EXPO_PUBLIC_SENTRY_ENV,
  );
  const killSwitch = isAnalyticsDisabledByEnv(env.EXPO_PUBLIC_ANALYTICS_DISABLED);
  const enabled = !killSwitch && posthogKey.length > 0 && environment !== "development";
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
    EXPO_PUBLIC_ANALYTICS_DISABLED: process.env.EXPO_PUBLIC_ANALYTICS_DISABLED,
  };
}

export const analyticsConfig: AnalyticsConfig = resolveAnalyticsConfig(
  readAnalyticsEnvFromProcess(),
);
