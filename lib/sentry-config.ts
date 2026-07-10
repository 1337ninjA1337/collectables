import {
  normaliseDeploymentEnv,
  type DeploymentEnvironment,
} from "@/lib/deployment-env";
import { makeExpoPublicEnvReader } from "@/lib/expo-public-env";

import { APP_VERSION } from "@/lib/app-version";

export type SentryEnvironment = DeploymentEnvironment;

/**
 * INVARIANT — `SENTRY_AUTH_TOKEN` is never required for runtime capture.
 *
 * The auth token (with `SENTRY_ORG`/`SENTRY_PROJECT`) is a CI-only secret
 * consumed by the deploy workflow's "Upload sourcemaps to Sentry" step; the
 * shipped bundle needs nothing beyond the public DSN for events to flow.
 * Without the token the pipeline still works end-to-end — stack traces just
 * arrive minified. That gap ("runtime works" vs "debugging works") is
 * surfaced at runtime via `sourcemapsExpected`: the deploy workflow inlines
 * `EXPO_PUBLIC_SENTRY_SOURCEMAPS=1` when (and only when) the token was
 * present at build time, so diagnostics can show "events flowing but stack
 * traces minified — add SENTRY_AUTH_TOKEN" without a new secret-validation
 * pass. Never gate `enabled` on this flag.
 */
export type SentryConfig = {
  dsn: string;
  environment: SentryEnvironment;
  release: string;
  enabled: boolean;
  tracesSampleRate: number;
  /** True when the deploy that produced this bundle ran the sourcemap-upload step. */
  sourcemapsExpected: boolean;
};

const DEFAULT_RELEASE = `collectables@${APP_VERSION}`;
export const DEFAULT_TRACES_SAMPLE_RATE = 0.1;

/**
 * Parses `EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` into a performance sampling
 * rate. Falls back to {@link DEFAULT_TRACES_SAMPLE_RATE} when the value is
 * unset, non-numeric, or out of the valid `[0, 1]` range so an operator can't
 * accidentally disable or over-sample tracing with a typo. Pure + exported.
 */
export function resolveTracesSampleRate(value: string | undefined): number {
  const trimmed = (value ?? "").trim();
  if (trimmed.length === 0) return DEFAULT_TRACES_SAMPLE_RATE;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return DEFAULT_TRACES_SAMPLE_RATE;
  }
  return parsed;
}

/**
 * Canonical Sentry DSN shape: `https://<publicKey>@<host>/<projectId>`.
 * Guards against an obviously-wrong secret (e.g. a Slack webhook URL pasted
 * into `EXPO_PUBLIC_SENTRY_DSN`) silently flipping `enabled` to true and then
 * failing deep inside the native SDK at runtime. Pure + exported for testing.
 */
const SENTRY_DSN_PATTERN = /^https?:\/\/[^@/]+@[^/]+\/\d+$/;

export function isValidSentryDsn(dsn: string): boolean {
  return SENTRY_DSN_PATTERN.test(dsn.trim());
}

// One-shot guard so a malformed DSN surfaces exactly once in the console
// rather than re-warning on every `resolveSentryConfig` call.
let malformedDsnWarned = false;

export function __resetSentryConfigWarningForTests(): void {
  malformedDsnWarned = false;
}

export function resolveSentryConfig(
  env: Record<string, string | undefined>,
  options: { defaultRelease?: string } = {},
): SentryConfig {
  const dsn = (env.EXPO_PUBLIC_SENTRY_DSN ?? "").trim();
  const environment = normaliseDeploymentEnv(env.EXPO_PUBLIC_SENTRY_ENV);
  const explicitRelease = (env.EXPO_PUBLIC_SENTRY_RELEASE ?? "").trim();
  const explicitVersion = (env.EXPO_PUBLIC_APP_VERSION ?? "").trim();
  // Precedence: explicit SENTRY_RELEASE (CI sha) > APP_VERSION > options > package.json.
  const release =
    explicitRelease.length > 0
      ? explicitRelease
      : explicitVersion.length > 0
        ? `collectables@${explicitVersion}`
        : (options.defaultRelease ?? DEFAULT_RELEASE);
  // A present-but-malformed DSN must NOT enable Sentry — the SDK would only
  // fail at init time. Surface the misconfig once so the operator can fix the
  // secret instead of silently shipping a broken telemetry pipeline.
  const dsnValid = dsn.length === 0 || isValidSentryDsn(dsn);
  if (dsn.length > 0 && !dsnValid && !malformedDsnWarned) {
    malformedDsnWarned = true;
    console.error(
      "[sentry] EXPO_PUBLIC_SENTRY_DSN is malformed (expected https://<key>@<host>/<projectId>); telemetry stays disabled.",
    );
  }
  const enabled = dsn.length > 0 && dsnValid && environment !== "development";
  const tracesSampleRate = resolveTracesSampleRate(
    env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
  );
  const sourcemapsExpected = resolveSourcemapsExpected(
    env.EXPO_PUBLIC_SENTRY_SOURCEMAPS,
  );
  return {
    dsn,
    environment,
    release,
    enabled,
    tracesSampleRate,
    sourcemapsExpected,
  };
}

/**
 * Parses `EXPO_PUBLIC_SENTRY_SOURCEMAPS` (inlined by the deploy workflow when
 * `SENTRY_AUTH_TOKEN` was present at build time — see the invariant note on
 * {@link SentryConfig}). Accepts "1"/"true" (any case); everything else —
 * including unset, local dev builds, and CI runs without the token — is
 * false. Pure + exported for testing.
 */
export function resolveSourcemapsExpected(value: string | undefined): boolean {
  const trimmed = (value ?? "").trim().toLowerCase();
  return trimmed === "1" || trimmed === "true";
}

/** Every EXPO_PUBLIC_ var the Sentry resolver supports, declared once. */
export const SENTRY_ENV_VAR_NAMES = [
  "EXPO_PUBLIC_SENTRY_DSN",
  "EXPO_PUBLIC_SENTRY_ENV",
  "EXPO_PUBLIC_SENTRY_RELEASE",
  "EXPO_PUBLIC_APP_VERSION",
  "EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE",
  "EXPO_PUBLIC_SENTRY_SOURCEMAPS",
] as const;

/**
 * Reads the Sentry env vars from `process.env` using *literal* member
 * accesses. Expo's babel plugin (`babel-preset-expo`) only inlines
 * `process.env.EXPO_PUBLIC_*` references when it sees them as direct member
 * expressions in source — passing `process.env` whole to a helper bypasses
 * inlining and the bundled code reads `undefined` at runtime. The
 * `makeExpoPublicEnvReader` wrapper enforces name-tuple ↔ literal-object
 * parity at compile time (see lib/expo-public-env.ts).
 */
export const readSentryEnvFromProcess = makeExpoPublicEnvReader(
  "lib/sentry-config.ts",
  SENTRY_ENV_VAR_NAMES,
  () => ({
    EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN,
    EXPO_PUBLIC_SENTRY_ENV: process.env.EXPO_PUBLIC_SENTRY_ENV,
    EXPO_PUBLIC_SENTRY_RELEASE: process.env.EXPO_PUBLIC_SENTRY_RELEASE,
    EXPO_PUBLIC_APP_VERSION: process.env.EXPO_PUBLIC_APP_VERSION,
    EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE:
      process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
    EXPO_PUBLIC_SENTRY_SOURCEMAPS: process.env.EXPO_PUBLIC_SENTRY_SOURCEMAPS,
  }),
);

export const sentryConfig: SentryConfig = resolveSentryConfig(
  readSentryEnvFromProcess(),
);
