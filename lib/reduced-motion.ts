import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * "Reduce motion" — the system setting every animated surface in this app
 * ignored until 2026-09-17.
 *
 * ## What it is actually for
 *
 * Not a preference about taste. Vestibular disorders are the reason the
 * setting exists: for some people a sliding panel or a looping shimmer causes
 * nausea, dizziness or a migraine, and the platform has an API that says so.
 * iOS, Android and every desktop browser expose it, React Native forwards it,
 * and four surfaces here — the toast entrance, the skeleton shimmer, the swipe
 * pager and the wishlist sheet — ran their animations unconditionally.
 *
 * ## Zero is not always the answer
 *
 * The naive fix is `duration: reduced ? 0 : ms` everywhere, and it is wrong in
 * two of the three shapes this app has:
 *
 *  - **A transition with a completion callback** (the pager's commit, the
 *    sheet's dismiss) must still RUN, because the callback is what changes the
 *    tab or closes the sheet. `duration: 0` is right: the animation completes
 *    on the next frame and the callback fires.
 *  - **A spring back to rest** with no callback has nothing to wait for, so
 *    the instant equivalent is `value.setValue(rest)` and no animation at all.
 *    A zero-duration spring is a spring.
 *  - **A loop** must not start. `Animated.loop` of a zero-duration timing is
 *    not a still image; it is a frame callback that never stops, which is a
 *    battery drain handed to the user who asked for less.
 *
 * So this module exports the SIGNAL and the arithmetic, and each surface picks
 * the shape that is right for it. A single "make it instant" helper would have
 * to know which of the three it was being called on.
 */

/** The duration an animation should run for, given the preference. */
export function motionDuration(ms: number, reduced: boolean): number {
  return reduced ? 0 : ms;
}

/**
 * Whether the user has asked for reduced motion, kept current.
 *
 * Both halves matter. The initial read answers for the app's first paint; the
 * subscription answers for the user who turns the setting on BECAUSE this app
 * made them ill, which is the moment it most needs to be heard — a value read
 * once at mount would leave every already-mounted surface animating until the
 * screen was navigated away from and back.
 *
 * Defaults to `false` — motion allowed — when the platform cannot answer.
 * That is the way round it has to be: an app that read a missing API as "the
 * user wants no motion" would silently drop every animation on a platform
 * whose only fault is not implementing the query.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        // The promise can settle after the tree is down; a `setState` then is
        // a warning in dev and a leak-shaped no-op in production.
        if (active) setReduced(enabled);
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
      setReduced(enabled);
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  return reduced;
}

/**
 * The same signal as a ref, for the callbacks that cannot read state.
 *
 * Two of the four surfaces build a `PanResponder` inside `useRef(...).current`,
 * which is created ONCE: a `reduced` captured in that closure is the value
 * from the first render, forever. The gesture handlers read this instead, and
 * the ref is updated on every render by the hook itself rather than by a line
 * each caller has to remember.
 */
export function useReducedMotionRef(): { readonly current: boolean } {
  const reduced = useReducedMotion();
  const ref = useRef(reduced);
  ref.current = reduced;
  return ref;
}
