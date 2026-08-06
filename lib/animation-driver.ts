import { Platform } from "react-native";

/**
 * Whether `Animated` may hand an animation to the native driver.
 *
 * react-native-web has no native animation module, so every
 * `useNativeDriver: true` on the web build logs
 *
 *   Animated: `useNativeDriver` is not supported because the native animated
 *   module is missing. Falling back to JS-based animation.
 *
 * once per animation and then runs the animation on the JS thread anyway. The
 * warning is pure noise — it names a fix ("run `bundle exec pod install`")
 * that is meaningless on web — and it buries real errors in the console.
 *
 * Gating on the platform gives the identical runtime behaviour (JS-driven on
 * web, native-driven on iOS/Android) without the log line. Animations that
 * drive layout or colour props must stay on `useNativeDriver: false`
 * everywhere — the native driver only handles transform/opacity — so those
 * call sites deliberately do NOT use this constant (see
 * `components/swipe-tabs.tsx`, which animates width/height).
 */
export const USE_NATIVE_DRIVER = Platform.OS !== "web";
