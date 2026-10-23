import { useEffect, useRef, type MutableRefObject } from "react";

/**
 * Whether this component is still mounted, readable from a closure that
 * outlived it.
 *
 * ## The failure it exists for
 *
 * A `setState` after an `await`, on a screen the user already left. Every
 * caller here does the same two things: it awaits a write or a fetch, and then
 * reports the outcome into state. Both halves are correct and the gap between
 * them belongs to the user, who can navigate away — and on a slow connection,
 * which is exactly when the await is long, usually does.
 *
 * Four hand-written copies before this hook: `app/profile/[id].tsx` (a
 * pull-to-refresh with nothing to hang a cancellation flag on),
 * `app/chat/[id].tsx` (the send button's in-flight state), and the two create
 * forms, whose `finally` runs AFTER a `router.replace` has already taken the
 * screen down — the one case where the unmount is not the user's doing but the
 * handler's own last statement.
 *
 * ## Why the assignment is in an effect, where `useLatestRef`'s is not
 *
 * `useLatestRef` writes during render because it is reporting a value the
 * render produced. This reports a lifecycle fact, and the only honest source
 * for "still mounted" is the effect that React runs on mount and the cleanup it
 * runs on unmount. A render-time `true` would also be wrong in the one case
 * that matters most: Strict Mode mounts, unmounts and re-mounts, so the
 * cleanup's `false` has to be undone by a re-mount rather than by the next
 * render of a component that is already gone.
 *
 * ## What it does NOT do
 *
 * It does not cancel anything. A caller that can abort its work should —
 * `active` flags inside an effect are a better answer, because they stop the
 * work rather than discarding its result. This is for the awaits nothing can
 * recall: a cloud insert that has already happened, a navigation already
 * dispatched.
 */
export function useMountedRef(): MutableRefObject<boolean> {
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  return mountedRef;
}
