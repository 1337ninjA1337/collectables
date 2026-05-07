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

export const sentryConfig: SentryConfig = resolveSentryConfig(
  process.env as Record<string, string | undefined>,
);
