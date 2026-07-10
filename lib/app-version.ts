import packageJson from "../package.json";

/**
 * Single source of truth for the app version: package.json's `version`.
 *
 * `app.config.ts` re-exports this as both `expo.version` and
 * `extra.expoPublicAppVersion`, and `lib/sentry-config.ts` uses it as the
 * final release fallback (`collectables@<version>`), so bumping the npm
 * version updates the Expo config and Sentry's release record in one place —
 * no per-deploy `EXPO_PUBLIC_APP_VERSION` env var required.
 */
export const APP_VERSION: string = (packageJson as { version: string })
  .version;
