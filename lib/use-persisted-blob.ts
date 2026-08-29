import { useEffect } from "react";

import AsyncStorage from "@react-native-async-storage/async-storage";

import { captureException } from "@/lib/sentry";
import { storageKeyLabel } from "@/lib/storage-keys";

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
 * happened. One `captureException` per keyspace per session says which blob
 * stopped persisting without turning a full disk into a thousand events.
 *
 * The KEYSPACE, not the key: every per-user key ends in the account's auth id,
 * and `storageKeyLabel` takes it out. `scrubPII` reads event bodies, not the
 * `extra` a caller assembles, so a raw key here would be an identifier nobody
 * decided to send.
 */
export function usePersistedBlob(key: string | null, value: unknown, enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !key) return;
    AsyncStorage.setItem(key, JSON.stringify(value)).catch((error: unknown) => {
      reportPersistFailure(key, error);
    });
  }, [key, value, enabled]);
}

/**
 * Keyspaces already reported this session.
 *
 * Per keyspace rather than per key so signing in as a second account does not
 * re-report the same broken store, and per session rather than per mount so a
 * provider that remounts on every navigation cannot turn one full disk into a
 * stream. Sentry's own limiter would eventually cap the volume; this decides
 * WHICH events survive instead of letting the first minute of a full disk
 * spend the budget.
 */
const reportedKeyspaces = new Set<string>();

function reportPersistFailure(key: string, error: unknown): void {
  const keyspace = storageKeyLabel(key);
  if (reportedKeyspaces.has(keyspace)) return;
  reportedKeyspaces.add(keyspace);
  captureException(error, {
    scope: "use-persisted-blob.setItem",
    extra: { keyspace },
  });
}

/** Module scope survives between suites in one process; a seeding suite resets. */
export function __resetPersistFailureReportsForTests(): void {
  reportedKeyspaces.clear();
}
