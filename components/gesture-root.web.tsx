import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

/**
 * The web shell, which is a plain `<View>` — and that is the single largest
 * saving anybody has found in this bundle.
 *
 * ## 964.2 KiB, measured
 *
 * `app/_layout.tsx` imported `react-native-gesture-handler` for its side
 * effects and wrapped the app in `GestureHandlerRootView`. Nothing on web
 * needs either: `components/DraggableList.web.tsx` exists precisely because
 * `react-native-draggable-flatlist` wants gesture-handler and reanimated
 * worklets "that the web build does not carry", and the two other gestures in
 * the app (`components/swipe-tabs.tsx`, the wishlist sheet) are React
 * Native's own `PanResponder`.
 *
 * It carried them anyway, because the root view is an import and an import is
 * a dependency whatever the component does with it. `npm run bundle:composition`
 * put numbers on it: reanimated 632.9 KiB, gesture-handler 202.3, worklets
 * 57.8, hammerjs 25.6, semver 16.7 — 4696.3 KiB down to 3732.1, a fifth of
 * everything the deployed site downloads, for a provider that renders a
 * `<div>` there.
 *
 * ## Why this is not a `Platform.OS` branch
 *
 * A conditional would still import the module, and the import is the cost.
 * The split has to be at the FILE level, which is the same reason
 * `DraggableList.web.tsx` is a file rather than a branch —
 * `check-platform-pairs` keeps the two halves' exports in step.
 *
 * ## What would bring it back
 *
 * A web screen that mounts a gesture-handler component. There is no such
 * screen, and the day somebody writes one it will need this root — so the
 * pair stays, and the native half keeps the real thing.
 */
export function GestureRoot({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  return <View style={style}>{children}</View>;
}
