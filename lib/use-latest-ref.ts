import { useRef, type MutableRefObject } from "react";

/**
 * The latest value, readable from a closure that outlives the render.
 *
 * Eleven render-time `ref.current = value` assignments across eight files, all
 * doing this, and three different reasons for it:
 *
 *  - **A closure built once.** `components/swipe-tabs.tsx` builds its
 *    `PanResponder` inside `useRef(PanResponder.create(…)).current`, which runs
 *    on the first render only. Anything captured in those handlers is the first
 *    render's value for the life of the component — which is how the tab
 *    announcement would have kept speaking the language the app was STARTED in
 *    after the user changed it.
 *  - **A callback whose identity changes and must not restart anything.**
 *    `components/toast-host.tsx`'s `onDismiss` closes over the toast id, so it
 *    is a new function every render; in the effect's dependency list it would
 *    restart the dismissal timer on every render of the host, and the toast
 *    would never dismiss. `use-transition-event`, `use-visibility-refresh`,
 *    `use-entry-currency` and `use-dwell-time` all carry the same sentence in
 *    their own words.
 *  - **Render state read by something stable.** `app/index.tsx` and
 *    `app/collection/[id].tsx` hand their current list to a drag handler that
 *    is not rebuilt per render.
 *
 * ## What the hook actually adds
 *
 * The assignment, which was a line each caller had to remember. Writing it out
 * is two lines that look like bookkeeping and read like nothing, and the
 * failure when it is forgotten is not a crash: the ref simply keeps the first
 * value, and the component behaves correctly until the value changes — which in
 * four of these cases is a language switch, a second toast, or a reorder, none
 * of which the first render can see. `useReducedMotionRef` was written with the
 * assignment inside it for exactly that reason, and is now this hook plus its
 * own signal — the one site that was already right, which is what suggested
 * the other ten.
 *
 * ## Why the assignment is in the render body and not an effect
 *
 * It looks like the thing React tells you not to do, and the distinction is
 * that this ref is never READ during render — only from callbacks, effects and
 * handlers, all of which run after the commit. An effect would be correct and
 * later: a handler that fires between the render and the effect (a gesture
 * mid-flight, a timer already scheduled) would read the previous value, which
 * is the bug this exists to prevent rather than a smaller version of it.
 *
 * Returns a mutable ref on purpose. Most callers only read it, but
 * `use-transition-event` keeps a second ref it writes from inside its effect,
 * and a `readonly` type here would push that one back to a hand-rolled
 * `useRef` — one holdout is how an idiom stays two idioms.
 */
export function useLatestRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
