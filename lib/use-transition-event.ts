import { useEffect, useRef } from "react";

/**
 * Rising-edge predicate for "first X" analytics funnels: true only for the
 * had-none → has-some transition. Pure so imperative call sites (an async
 * save handler that snapshots `prev` before a mutation and computes `next`
 * after it) share one tested implementation with the render-driven
 * `useTransitionEvent` hook below — `item_photo_attached` today, future
 * `first_listing_published` / `first_friend_added` funnels for free.
 */
export function isRisingEdge(prev: boolean, next: boolean): boolean {
  return !prev && next;
}

/**
 * Fires `fire()` exactly once per false → true transition of `value` across
 * renders. The mount render only establishes the baseline: a value that is
 * already true when the component mounts does NOT fire — re-opening a screen
 * for an item that already has photos is not "first photo attached".
 *
 * `fire` is kept in a ref so an inline closure (the common
 * `() => trackEvent(...)` shape) never re-arms the effect; only `value`
 * changes are observed.
 */
export function useTransitionEvent(value: boolean, fire: () => void): void {
  const prevRef = useRef(value);
  const fireRef = useRef(fire);
  fireRef.current = fire;
  useEffect(() => {
    if (isRisingEdge(prevRef.current, value)) fireRef.current();
    prevRef.current = value;
  }, [value]);
}
