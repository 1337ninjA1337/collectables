import {
  normaliseDeploymentEnv,
  type DeploymentEnvironment,
} from "@/lib/deployment-env";
import { makeExpoPublicEnvReader } from "@/lib/expo-public-env";

export type AnalyticsEnvironment = DeploymentEnvironment;

export type AnalyticsConfig = {
  posthogKey: string;
  posthogHost: string;
  clarityId: string;
  environment: AnalyticsEnvironment;
  enabled: boolean;
  mirrorDisabled: boolean;
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
  // Narrower kill-switch for the analytics-mirror long-tail store: when set
  // (same truthy literals), any client-side wiring that would configure or
  // advertise the PostHog→Supabase mirror webhook must treat the mirror as
  // off, while PostHog/Clarity themselves stay live. The full kill-switch
  // implies it — a mirror of a disabled stream is meaningless.
  const mirrorDisabled =
    !enabled ||
    isAnalyticsDisabledByEnv(env.EXPO_PUBLIC_ANALYTICS_MIRROR_DISABLED);
  return { posthogKey, posthogHost, clarityId, environment, enabled, mirrorDisabled };
}

/** Every EXPO_PUBLIC_ var the analytics resolver supports, declared once. */
export const ANALYTICS_ENV_VAR_NAMES = [
  "EXPO_PUBLIC_POSTHOG_KEY",
  "EXPO_PUBLIC_POSTHOG_HOST",
  "EXPO_PUBLIC_CLARITY_PROJECT_ID",
  "EXPO_PUBLIC_ANALYTICS_ENV",
  "EXPO_PUBLIC_SENTRY_ENV",
  "EXPO_PUBLIC_ANALYTICS_DISABLED",
  "EXPO_PUBLIC_ANALYTICS_MIRROR_DISABLED",
] as const;

/**
 * Reads the analytics env vars from `process.env` using *literal* member
 * accesses so Expo's babel plugin (`babel-preset-expo`) inlines each value
 * into the JS bundle at build time. Passing `process.env` whole bypasses
 * inlining and the bundled code reads `undefined` at runtime — the bug
 * fixed for Sentry in `lib/sentry-config.ts:readSentryEnvFromProcess`. The
 * `makeExpoPublicEnvReader` wrapper enforces name-tuple ↔ literal-object
 * parity at compile time (see lib/expo-public-env.ts).
 */
export const readAnalyticsEnvFromProcess = makeExpoPublicEnvReader(
  "lib/analytics-config.ts",
  ANALYTICS_ENV_VAR_NAMES,
  () => ({
    EXPO_PUBLIC_POSTHOG_KEY: process.env.EXPO_PUBLIC_POSTHOG_KEY,
    EXPO_PUBLIC_POSTHOG_HOST: process.env.EXPO_PUBLIC_POSTHOG_HOST,
    EXPO_PUBLIC_CLARITY_PROJECT_ID: process.env.EXPO_PUBLIC_CLARITY_PROJECT_ID,
    EXPO_PUBLIC_ANALYTICS_ENV: process.env.EXPO_PUBLIC_ANALYTICS_ENV,
    EXPO_PUBLIC_SENTRY_ENV: process.env.EXPO_PUBLIC_SENTRY_ENV,
    EXPO_PUBLIC_ANALYTICS_DISABLED: process.env.EXPO_PUBLIC_ANALYTICS_DISABLED,
    EXPO_PUBLIC_ANALYTICS_MIRROR_DISABLED:
      process.env.EXPO_PUBLIC_ANALYTICS_MIRROR_DISABLED,
  }),
);

export const analyticsConfig: AnalyticsConfig = resolveAnalyticsConfig(
  readAnalyticsEnvFromProcess(),
);
