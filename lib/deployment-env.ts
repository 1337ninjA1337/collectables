/**
 * Shared deployment-environment parser.
 *
 * `lib/sentry-config.ts` and `lib/analytics-config.ts` each carried an
 * identical `normaliseEnvironment` that collapses an `EXPO_PUBLIC_*_ENV` string
 * into one of three canonical buckets. Duplicating it meant a future "preview"
 * bucket added to one config would silently fall back to "production" in the
 * other. This is the single source of truth.
 *
 * Kept as its own dependency-free module (not `lib/env.ts`, which imports
 * `react-native` at module scope and so can't load in the node test runner) so
 * the config modules that consume it stay node-testable and peer-dep-free.
 */
export type DeploymentEnvironment = "development" | "staging" | "production";

/**
 * Collapses a raw `EXPO_PUBLIC_*_ENV` value into a {@link DeploymentEnvironment}.
 * Anything other than the exact strings `"staging"` / `"development"` — including
 * `undefined`, empty, or a typo — falls back to `"production"`, the safe default
 * for a deploy (event reporting stays on, never silently disabled by a bad env).
 */
export function normaliseDeploymentEnv(
  value: string | undefined,
): DeploymentEnvironment {
  if (value === "staging") return "staging";
  if (value === "development") return "development";
  return "production";
}
