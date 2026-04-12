import * as Linking from "expo-linking";
import { Platform } from "react-native";

/**
 * Public https domain for universal links. Configure it via
 * EXPO_PUBLIC_WEB_BASE_URL in .env (e.g. "https://collectables.app") to
 * generate QR codes that every phone camera (iOS especially) recognises
 * as a clickable link.
 */
const WEB_BASE_URL = (process.env.EXPO_PUBLIC_WEB_BASE_URL ?? "").replace(/\/+$/, "");

/**
 * Build a shareable deep link for a given in-app path (e.g. "collection/123",
 * "item/abc"). Preference order:
 *
 *   1. https universal link if EXPO_PUBLIC_WEB_BASE_URL is configured — best
 *      for QR codes because iPhone/Android cameras recognise https out of the
 *      box and universal links can still deep-link into the installed app.
 *   2. On web, use the current origin so scanning opens the live web app.
 *   3. Otherwise fall back to Linking.createURL which emits the app's scheme
 *      (collectables://...) in production or exp://... in Expo Go — both work
 *      once the app is installed, but won't render as a tappable preview in
 *      the iOS camera.
 */
export function buildDeepLink(path: string): string {
  const clean = path.replace(/^\/+/, "");
  if (WEB_BASE_URL) {
    return `${WEB_BASE_URL}/${clean}`;
  }
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const origin = window.location.origin.replace(/\/+$/, "");
    return `${origin}/${clean}`;
  }
  return Linking.createURL(clean);
}
