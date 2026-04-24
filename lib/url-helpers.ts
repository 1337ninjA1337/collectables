/**
 * Pure URL helpers used by `lib/env.ts`. Kept free of `react-native` imports
 * so they can be unit-tested from plain Node.
 */

export function normalizeConfiguredUrl(url: string | undefined | null): string {
  return (url ?? "").replace(/\/+$/, "");
}

export function inferWebBasePath(pathname: string): string {
  const parts = pathname.split("/").filter((p) => p !== "");
  return parts.length > 0 ? "/" + parts[0] : "";
}

export function resolveAppBaseUrl(
  configuredUrl: string,
  origin: string | null | undefined,
  pathname: string | null | undefined,
): string {
  if (configuredUrl) return configuredUrl;
  if (origin) {
    return origin + inferWebBasePath(pathname ?? "");
  }
  return "";
}
