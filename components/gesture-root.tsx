/*
 * Two imports of `react-native-gesture-handler`, which is what
 * `import/no-duplicates` reports here — and it reports it on whichever of the
 * two is not disabled, so the pair is wrapped rather than one line marked.
 * `ZEROED_RULES` in `lib/eslint-gate.ts` names this file as the one disable
 * holding that rule at zero, so this paragraph is the argument the gate points
 * at.
 *
 * Merging them is behaviourally identical TODAY and this file cannot prove
 * otherwise: both resolve to one module, ESM evaluates it once at its first
 * import, the two statements between them are `import type` and erase, and
 * nothing in this repository builds for native, so no test here can tell the
 * two spellings apart.
 *
 * The reason the bare import stays is what it IS: the line
 * `react-native-gesture-handler`'s own setup instructions ask for at the top
 * of the entry file, before any other import. It was literally the first line
 * of `app/_layout.tsx` until the web-bundle split moved it one module down,
 * and `gesture-root-split.test.ts` pins the chain that keeps its position —
 * the layout imports this module before anything else, and this module runs
 * that line before anything else. Merging it into the named import would
 * delete the thing the library documents and leave behind an ordering that
 * holds by accident.
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
