/*
 * Two imports of `react-native-gesture-handler`, which is what
 * `import/no-duplicates` reports here — and it reports it on whichever of the
 * two is not disabled, so the pair is wrapped rather than one line marked.
 *
 * Merging them would be behaviourally identical TODAY: both resolve to one
 * module, ESM evaluates it once at its first import, and the two statements
 * between them are `import type` and erase completely. The reason not to merge
 * is the day somebody sorts this file's imports — `react` before
 * `react-native-gesture-handler` is the order every other module here uses,
 * and under that order a single merged import no longer runs the side effect
 * before anything else. A bare `import "x";` on the first line cannot be moved
 * by a sort that is rearranging named imports, which is the whole of what it is
 * for.
 */
/* eslint-disable import/no-duplicates */
import "react-native-gesture-handler";

import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
/* eslint-enable import/no-duplicates */

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
