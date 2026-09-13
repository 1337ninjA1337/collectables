import "react-native-gesture-handler";

import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

/**
 * The native shell: `GestureHandlerRootView`, plus the side-effect import that
 * has to run before anything else in the app.
 *
 * `react-native-draggable-flatlist` — which IS the reorder list on iOS and
 * Android — needs both, so on native this file is exactly what
 * `app/_layout.tsx` had inline before the split.
 *
 * `gesture-root.web.tsx` is the other half, and it is a plain `<View>`. See
 * that file for why, and for the 964 KiB it takes off the web bundle.
 */
export function GestureRoot({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  return <GestureHandlerRootView style={style}>{children}</GestureHandlerRootView>;
}
