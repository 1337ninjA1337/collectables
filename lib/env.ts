import { Platform } from "react-native";

const configuredUrl = (process.env.EXPO_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");

export function getAppBaseUrl(): string {
  if (configuredUrl) return configuredUrl;
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const parts = window.location.pathname.split("/").filter((p) => p !== "");
    const basePath = parts.length > 0 ? "/" + parts[0] : "";
    return window.location.origin + basePath;
  }
  return "";
}
