import * as Linking from "expo-linking";

import { getAppBaseUrl } from "@/lib/env";

export function buildDeepLink(path: string): string {
  const clean = path.replace(/^\/+/, "");
  const base = getAppBaseUrl();
  if (base) {
    return `${base}/${clean}`;
  }
  return Linking.createURL(clean);
}
