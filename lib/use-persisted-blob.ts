import { useEffect } from "react";

import AsyncStorage from "@react-native-async-storage/async-storage";

import { reportStorageFailure } from "@/lib/report-storage-failure";

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
 * yet" / "not hydrated yet" gate. `enabled` is REQUIRED and has no default:
 * writing before hydration completes persists the empty initial state over the
 * stored blob, which is the one catastrophic thing this hook can do, and a
 * default of `true` would make the safe value the one a caller has to remember
 * to pass.
 *
 * ## A failed write is still swallowed, and no longer silent
 *
 * The app cannot recover from a rejected `setItem` at this level: there is no
 * second store to try, and throwing out of an effect would take the provider
 * tree down over a cache write. So the write is still best-effort.
 *
 * What changed is that it is reported. A rejected write is usually a full
 * device store, which fails EVERY write rather than one, and the user finds out
 * on the next launch — when their local edits are gone and the cloud pull is
 * the only truth they have left. Silent local data loss is the failure mode
 * this hook is closest to, and until now nothing anywhere recorded that it
 * happened. One report per keyspace per session says which blob stopped
 * persisting without turning a full disk into a thousand events.
 *
 * The once-per-keyspace budget, and the rule that the KEYSPACE travels and the
 * key does not, now live in `lib/report-storage-failure.ts` — this hook was
 * the first site to need them and is no longer the only one. The sync writes
 * whose failure corrupts rather than merely loses (`lib/tombstones.ts`,
 * `lib/sync-cursors.ts`) share the same budget, so a full device store is one
 * fact reported once per store rather than once per module that noticed it.
 */
export function usePersistedBlob(key: string | null, value: unknown, enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !key) return;
    AsyncStorage.setItem(key, JSON.stringify(value)).catch((error: unknown) => {
      reportStorageFailure("use-persisted-blob.setItem", key, error);
    });
  }, [key, value, enabled]);
}
