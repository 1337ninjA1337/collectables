import { isDevEnvironment } from "./dev-menu";

/**
 * SEC-4 — gate the runtime Supabase config override.
 *
 * `lib/supabase.ts` can read the Supabase URL/key from
 * `window.localStorage` (`collectables-supabase-runtime-config`) and use it
 * over the build-time, GitHub-Secret-injected env. Honoring that in a
 * production web build is a full account-takeover vector: any XSS or a
 * malicious browser extension can repoint the app at an attacker-controlled
 * Supabase project and silently harvest every credential / OTP / session the
 * user enters. It also conflicts with CLAUDE.md's "ALWAYS USE CREDENTIALS
 * FROM GITHUB SECRETS" intent.
 *
 * So the override is only honored when:
 *   - the bundle is a dev build (`__DEV__`), or
 *   - an explicit QA opt-in env (`EXPO_PUBLIC_ALLOW_RUNTIME_SUPABASE_CONFIG`)
 *     is set to the literal string `"true"` for a preview/QA deploy.
 *
 * A production web build (no `__DEV__`, opt-in unset) ignores localStorage
 * config entirely. Pure + parameterised so it is unit-testable under plain
 * Node without pulling the react-native bundle (`dev-menu.ts` has no RN deps).
 */
export function isRuntimeConfigOverrideAllowed(
  isDev: boolean = isDevEnvironment(),
  envOptIn: string | undefined = process.env
    .EXPO_PUBLIC_ALLOW_RUNTIME_SUPABASE_CONFIG,
): boolean {
  return isDev || envOptIn === "true";
}
