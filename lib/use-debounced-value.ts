import { useEffect, useState } from "react";

import {
  DEFAULT_DEBOUNCE_MS,
  PROFILE_SEARCH_DEBOUNCE_MS,
  commitDebouncedValue,
  isImmediateDelay,
  resolveDebounceDelay,
} from "@/lib/debounce-helpers";

export {
  DEFAULT_DEBOUNCE_MS,
  PROFILE_SEARCH_DEBOUNCE_MS,
  commitDebouncedValue,
  isImmediateDelay,
  resolveDebounceDelay,
};

/**
 * Trailing-edge debounce over a render value.
 *
 * Returns `value` unchanged on first render, then lags it by `delayMs`: each
 * new `value` cancels the pending settle and schedules a fresh one, so a
 * burst of keystrokes produces exactly one downstream update. The timer is
 * cleared on unmount and on every re-run, so nothing fires into an unmounted
 * tree (both hand-rolled copies this hook replaced already got that right —
 * it is pinned here so the third consumer doesn't have to remember).
 *
 * Two consumers exist today, both debouncing a `searchProfiles()` round trip
 * (`app/people.tsx`, `components/search-overlay.tsx`). The third case this was
 * built for is live-as-you-type filtering inside a collection: `ItemFilterBar`
 * only applies its `query` on Apply today, and a collection with thousands of
 * items must not re-run `applyItemFilters` per keystroke when that lands.
 *
 * Caller requirement for non-primitive values: pass a STABLE reference (a
 * `useMemo`'d object/array), the way `useChunkedList` requires of its `items`.
 * The effect re-arms on every `value` identity change, so an object rebuilt
 * inline each render restarts the timer forever and the value never settles.
 * Strings and numbers — which both current consumers pass — compare by value
 * and are always safe.
 *
 * Deliberately NOT wired into `ItemFilterBar`'s draft yet: the sheet's Apply
 * button reads `draft` directly, so debouncing the value it hands to
 * `onChange` would apply a stale query to anyone who taps Apply within
 * `delayMs` of their last keystroke. The debounce belongs on the live path
 * when the live path exists, not on the commit path that exists now.
 */
export function useDebouncedValue<T>(value: T, delayMs: number = DEFAULT_DEBOUNCE_MS): T {
  const delay = resolveDebounceDelay(delayMs);
  const [settled, setSettled] = useState<T>(value);

  // `value` is compared by React's own dep check, so an unchanged value never
  // re-arms the timer — that is the "no-op keystroke" guard, and it is why
  // `settled` is not (and must not be) a dependency: listing it would re-run
  // the effect on every settle and restart the timer forever.
  useEffect(() => {
    const commit = () => setSettled((current) => commitDebouncedValue(current, value));
    if (isImmediateDelay(delay)) {
      commit();
      return;
    }
    const timer = setTimeout(commit, delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return settled;
}
