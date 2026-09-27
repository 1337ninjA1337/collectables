import { useState } from "react";

/**
 * A value built on the first render and never again.
 *
 * Six sites in this tree wrote that as `useRef(create()).current` — two
 * `PanResponder`s (`components/swipe-tabs.tsx`, `app/wishlist.tsx`) and four
 * `new Animated.Value(0)`s. The idiom is the one React Native's own docs use,
 * it is stable, and two things are wrong with it:
 *
 *  - **It is a ref READ during render**, which is the half of the
 *    `useLatestRef` contract `lib/check-latest-ref.ts`'s header declines to
 *    decide and `react-hooks/refs` does. The rule is not wrong about the
 *    shape — it cannot see that this particular ref is written once, on the
 *    line that declares it, and is therefore safe to read. It reports once
 *    per closure that captures the value, which is why `swipe-tabs`'s single
 *    `translateX` line accounted for 14 of that file's 17 errors.
 *  - **It calls `create()` on every render and throws the result away.**
 *    `useRef(x)` evaluates `x` before the hook can decline it; only the FIRST
 *    result is ever kept. So `swipe-tabs` built a complete `PanResponder` —
 *    five closures and a handler table — on every render of every tab
 *    change, and discarded it. "Built inside `useRef(...).current`, which
 *    runs on the first render only" was a sentence about the value that is
 *    RETAINED, not about the work that is done.
 *
 * `useState`'s lazy initialiser is the version React documents for this:
 * called once, on mount, and never on a re-render. There is no setter, which
 * is the point — a constant with a setter is state, and this returns the value
 * rather than the pair so that a caller cannot quietly become the other thing.
 *
 * ## Not `useMemo(create, [])`
 *
 * `useMemo` is a performance hint that React is allowed to discard and
 * re-run; a `PanResponder` rebuilt mid-gesture or an `Animated.Value` replaced
 * mid-animation is a dropped gesture and a jumped frame, and the failure would
 * appear under memory pressure on a device nobody here is holding. The state
 * initialiser is a guarantee.
 *
 * ## The hazard this does NOT remove
 *
 * Anything `create` captures is captured from the first render, forever —
 * which is exactly why `swipe-tabs` and `wishlist` read `active`, `tabs`,
 * `onChange`, the translator and the reduced-motion setting through
 * {@link useLatestRef} instead of closing over them. Moving the construction
 * off `useRef` changes which render's values are RETAINED not at all; it
 * changes how many times they are BUILT, and whether the line reads as a ref
 * access to a reader or a linter.
 */
export function useConstant<T>(create: () => T): T {
  const [value] = useState(create);
  return value;
}
