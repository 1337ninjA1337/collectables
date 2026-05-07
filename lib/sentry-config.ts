import appJson from "../app.json";

export type SentryEnvironment = "development" | "staging" | "production";

export type SentryConfig = {
  dsn: string;
  environment: SentryEnvironment;
  release: string;
  enabled: boolean;
};

const APP_VERSION = (appJson as { expo: { version: string } }).expo.version;
const DEFAULT_RELEASE = `collectables@${APP_VERSION}`;

function normaliseEnvironment(value: string | undefined): SentryEnvironment {
  if (value === "staging") return "staging";
  if (value === "development") return "development";
  return "production";
}

export function resolveSentryConfig(
  env: Record<string, string | undefined>,
  options: { defaultRelease?: string } = {},
): SentryConfig {
  const dsn = (env.EXPO_PUBLIC_SENTRY_DSN ?? "").trim();
  const environment = normaliseEnvironment(env.EXPO_PUBLIC_SENTRY_ENV);
  const explicitRelease = (env.EXPO_PUBLIC_SENTRY_RELEASE ?? "").trim();
  const explicitVersion = (env.EXPO_PUBLIC_APP_VERSION ?? "").trim();
  // Precedence: explicit SENTRY_RELEASE (CI sha) > APP_VERSION > options > app.json.
  const release =
    explicitRelease.length > 0
      ? explicitRelease
      : explicitVersion.length > 0
        ? `collectables@${explicitVersion}`
        : (options.defaultRelease ?? DEFAULT_RELEASE);
  const enabled = dsn.length > 0 && environment !== "development";
  return { dsn, environment, release, enabled };
}

/**
 * Reads the Sentry env vars from `process.env` using *literal* member
 * accesses. Expo's babel plugin (`babel-preset-expo`) only inlines
 * `process.env.EXPO_PUBLIC_*` references when it sees them as direct member
 * expressions in source — passing `process.env` whole to a helper bypasses
 * inlining and the bundled code reads `undefined` at runtime. Keep every
 * supported variable referenced literally below.
 */
export function readSentryEnvFromProcess(): Record<string, string | undefined> {
  return {
    EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN,
    EXPO_PUBLIC_SENTRY_ENV: process.env.EXPO_PUBLIC_SENTRY_ENV,
    EXPO_PUBLIC_SENTRY_RELEASE: process.env.EXPO_PUBLIC_SENTRY_RELEASE,
    EXPO_PUBLIC_APP_VERSION: process.env.EXPO_PUBLIC_APP_VERSION,
  };
}

export const sentryConfig: SentryConfig = resolveSentryConfig(
  readSentryEnvFromProcess(),
);
