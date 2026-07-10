import appJson from "./app.json";
import packageJson from "./package.json";

/**
 * Dynamic Expo config: everything comes from app.json (kept static so
 * structural tests and tooling can parse it), except the version, which is
 * auto-resolved from package.json at build time. The same value is exported
 * as `extra.expoPublicAppVersion` so runtime consumers (expo-constants) can
 * read the effective version without an env var.
 *
 * package.json is imported directly (not via lib/app-version.ts) because
 * Expo's config loader only transpiles this file — it cannot require other
 * local TypeScript modules. lib/app-version.ts mirrors the same field for
 * app/lib code; __tests__/app-version.test.ts pins the two together.
 */
const APP_VERSION = packageJson.version;

export default {
  ...appJson.expo,
  version: APP_VERSION,
  extra: {
    ...appJson.expo.extra,
    expoPublicAppVersion: APP_VERSION,
  },
};
