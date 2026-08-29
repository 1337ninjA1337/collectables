import { useEffect } from "react";

import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Persist one JSON blob to AsyncStorage under one key, writing only when that
 * blob's own reference changes.
 *
 * ## Why this exists
 *
 * `CollectionsProvider` persisted its five blobs — collections, items, followed
 * collection ids, and the two pending-upsert queues — from a SINGLE effect
 * whose dependency array listed all five states. `useEffect` fires when ANY
 * dependency changes, so every write rewrote every blob: adding one item
 * re-serialised the whole collection list, the followed-id list and both
 * offline queues, and a delta pull that touched only collections still rewrote
 * the items blob. For a user with a few hundred items that is the largest
 * `JSON.stringify` in the app, run four extra times for nothing.
 *
 * The delta path made this sharper rather than merely wasteful. The two cloud
 * merges were given a no-op contract — a re-read row that changed nothing
 * returns the local array BY REFERENCE — precisely so an overlap re-read costs
 * one query instead of a re-render and a storage write. That contract stops at
 * the provider boundary while one effect owns all five keys: `setLocalItems`
 * can honour it perfectly and `localCollections` changing next to it still
 * rewrites the items blob. Splitting the effect per key is what makes the
 * unchanged reference actually mean "nothing written".
 *
 * ## The dependency contract
 *
 * `value` is compared by REFERENCE, like any `useEffect` dependency. Pass a
 * state value (or something memoised); an object literal built fresh in the
 * component body is a new reference on every render and would write on every
 * render, which is worse than the batching this replaces. `social-context.tsx`
 * keeps its two literal-building persist effects for exactly that reason.
 *
 * A null `key` or `enabled === false` writes nothing — the caller's "no user
 * yet" / "not hydrated yet" gate. Writing before hydration completes would
 * persist the empty initial state over the stored blob, so `enabled` is the
 * provider's `ready` flag and is not optional in spirit even though it has a
 * default.
 *
 * Failures are swallowed: a blob that fails to persist is re-derived from the
 * cloud on the next pull, and there is nothing useful to do at this level.
 */
export function usePersistedBlob(
  key: string | null,
  value: unknown,
  enabled: boolean = true,
): void {
  useEffect(() => {
    if (!enabled || !key) return;
    AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => undefined);
  }, [key, value, enabled]);
}
