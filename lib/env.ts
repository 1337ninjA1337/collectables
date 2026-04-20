import { Platform } from "react-native";

const configuredUrl = (process.env.EXPO_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");

export function getAppBaseUrl(): string {
  if (configuredUrl) return configuredUrl;
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.origin + (window.location.pathname.replace(/\/[^/]*$/, "") || "");
  }
  return "";
}
