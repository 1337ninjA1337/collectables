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
