import { Platform } from "react-native";

import { normalizeConfiguredUrl, resolveAppBaseUrl } from "@/lib/url-helpers";

const configuredUrl = normalizeConfiguredUrl(process.env.EXPO_PUBLIC_APP_URL);

export function getAppBaseUrl(): string {
  const isWeb = Platform.OS === "web" && typeof window !== "undefined";
  return resolveAppBaseUrl(
    configuredUrl,
    isWeb ? window.location.origin : null,
    isWeb ? window.location.pathname : null,
  );
}

// Callers must pass the raw value via a *literal* `process.env.EXPO_PUBLIC_X`
// access (not the var name) — Metro/babel only inlines literal member accesses,
// so a computed env index lookup would read undefined in the web bundle.
export function resolveNumericEnv(rawValue: string | undefined, defaultValue: number): number {
  if (!rawValue) return defaultValue;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return parsed;
}
