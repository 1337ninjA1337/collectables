import AsyncStorage from "@react-native-async-storage/async-storage";

import { reportStorageFailure } from "@/lib/report-storage-failure";
import { tombstoneKey } from "@/lib/storage-keys";

/**
 * BE-15a — soft-delete tombstones (generalising the social graph's
 * `deletedProfileIds`).
 *
 * The sync conflict policy is Last-Write-Wins by `updated_at`. A row is removed
 * not by a hard `DELETE` (which a delta pull can never observe) but by setting
 * `deleted_at` (see migration `20260623_soft_delete_deleted_at.sql`); the BE-9
 * moddatetime trigger bumps `updated_at` on that UPDATE so the tombstone rides
 * the normal `updated_at=gt.<cursor>` delta pull (BE-14) to every peer.
 *
 * This module is the framework-free client half: it splits a freshly pulled
 * batch into still-alive rows vs tombstoned ids, removes tombstoned entries
 * from a local cache, and accumulates the tombstone-id set so a later full or
 * seed load can't resurrect a remotely deleted entity. No React, no Supabase —
 * fully node-testable; the AsyncStorage wrappers are thin and keyed via
 * `tombstoneKey`.
 */

/** Entities that carry a soft-delete `deleted_at` column (see BE-15a). */
export type TombstoneEntity = "collections" | "items" | "profiles" | "friend_requests";

/**
 * Split a freshly pulled batch of cloud rows into the still-alive rows and the
 * ids of rows the cloud has tombstoned (`deleted_at` set to a non-null value).
 *
 * `getDeletedAt` is treated as a tombstone marker for any non-null/non-empty
 * value, so a string timestamp, a Date, or a truthy flag all count. Rows with a
 * null/undefined/empty marker are alive and pass through untouched (same order).
 */
export function partitionByTombstone<T>(
  rows: readonly T[],
  options: { getId: (row: T) => string; getDeletedAt: (row: T) => unknown },
): { alive: T[]; tombstonedIds: string[] } {
  const { getId, getDeletedAt } = options;
  const alive: T[] = [];
  const tombstonedIds: string[] = [];
  for (const row of rows) {
    const marker = getDeletedAt(row);
    if (marker === null || marker === undefined || marker === "" || marker === false) {
      alive.push(row);
    } else {
      tombstonedIds.push(getId(row));
    }
  }
  return { alive, tombstonedIds };
}

/**
 * Remove every entry whose id is in `tombstonedIds` from `items`. Returns the
 * same array reference when nothing was tombstoned (no needless re-render /
 * persist), mirroring the no-op contract of `sync-cursors`/`pending-*`.
 */
export function applyTombstones<T>(
  items: readonly T[],
  tombstonedIds: readonly string[],
  getId: (item: T) => string,
): T[] {
  if (tombstonedIds.length === 0) return items as T[];
  const dead = new Set(tombstonedIds);
  const kept = items.filter((item) => !dead.has(getId(item)));
  // Preserve the input reference when nothing actually matched.
  return kept.length === items.length ? (items as T[]) : kept;
}

/**
 * Union an existing persisted tombstone-id set with newly observed ids, keeping
 * first-seen order and de-duplicating. Returns the original `existing`
 * reference when every incoming id was already present, so callers can skip the
 * persist write.
 */
export function mergeTombstoneIds(
  existing: readonly string[],
  incoming: readonly string[],
): string[] {
  if (incoming.length === 0) return existing as string[];
  const seen = new Set(existing);
  const added: string[] = [];
  for (const id of incoming) {
    if (!seen.has(id)) {
      seen.add(id);
      added.push(id);
    }
  }
  return added.length === 0 ? (existing as string[]) : [...existing, ...added];
}

/**
 * Read the stored tombstone-id set for an entity: `[]` when none was stored,
 * and NULL when the store could not be read.
 *
 * The two used to be the same answer, and the difference is a resurrection.
 * Every caller reads the set only to `mergeTombstoneIds` new ids into it and
 * write the union back, so a transient read failure answered `[]` narrows the
 * PERSISTED set to whatever this one pull happened to see — permanently, since
 * the write succeeds and there is nothing left to re-learn from. The rows whose
 * tombstones were dropped come back on the next hydrate, out of the local cache
 * or the seed, and the user sees something they deleted.
 *
 * Null is therefore "do not write", not "empty". A caller that treats it as
 * empty is back where this started, so the shape refuses to be ignored: `?? []`
 * is a decision somebody has to type.
 *
 * ONLY THE STORE'S FAILURE IS NULL, not the content's. Unparseable or
 * wrong-shaped stored text is `[]`: the store ANSWERED, and what it held is not
 * a tombstone set, so there is nothing to preserve and re-learning from the
 * next pull is right. Folding both into one catch would make a corrupt blob
 * permanently null — and a caller that holds its cursor on null would then hold
 * it forever, which is a stuck sync rather than the bounded re-pull the null is
 * supposed to buy.
 *
 * AND IT IS REPORTED, because the safe answer is also an unbounded one. Every
 * caller of this null holds something: the delta pull holds its `updated_at`
 * cursor, so the same window re-pulls on every refresh with no ceiling and no
 * counter. A store that is permanently unreadable rather than transiently one
 * looks, from the outside, exactly like a device that is simply syncing —
 * which is why it would never be investigated. One report per session says the
 * loop is a loop.
 */
export async function getTombstones(
  entity: TombstoneEntity,
  userId: string,
): Promise<string[] | null> {
  const key = tombstoneKey(entity, userId);
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(key);
  } catch (error: unknown) {
    // Unreadable store, which is not the same as an empty one — see above.
    reportStorageFailure("tombstones.getItem", key, error);
    return null;
  }
  if (!raw) return [];
  try {
    // NOT reported: the store ANSWERED, so nothing is stuck. The `[]` this
    // returns lets the next pull re-learn the set, which is a bounded recovery
    // rather than the open-ended hold the null above buys.
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    // Stored garbage: the store answered and held something that is not a set.
    return [];
  }
}

/**
 * Persist the tombstone-id set for an entity, reporting whether the set on disk
 * now covers `ids`.
 *
 * True when the write landed AND when there was nothing to write (`ids` is the
 * same reference as `previous`, which the merge helpers return when nothing
 * changed) — both mean the stored set is current. False only when the write
 * itself failed.
 *
 * THE RETURN VALUE IS THE POINT. This used to be `void` under a comment saying
 * a failed write just re-learns the tombstones from the next pull, and that was
 * not true: the delta pull advanced its `updated_at` cursor immediately
 * afterwards, so the next pull asked for rows newer than the tombstone it had
 * just failed to store and never saw it again. A soft-delete is an UPDATE like
 * any other — nothing re-sends it — so the deleted row stayed in the local
 * cache and came back on the next hydrate. The caller now holds the cursor
 * until this says the tombstone is safe.
 *
 * FALSE IS ALSO REPORTED. The held cursor is correct and has no ceiling: the
 * delta re-pulls the same window on every refresh until the write lands, and
 * on a device whose store is permanently full it never lands. Returning the
 * boolean fixes the resurrection; the report is what makes a store that stays
 * broken distinguishable from one that recovered on the second try.
 */
export async function setTombstones(
  entity: TombstoneEntity,
  userId: string,
  ids: readonly string[],
  previous?: readonly string[],
): Promise<boolean> {
  if (previous !== undefined && ids === previous) return true;
  const key = tombstoneKey(entity, userId);
  try {
    await AsyncStorage.setItem(key, JSON.stringify(ids));
    return true;
  } catch (error: unknown) {
    reportStorageFailure("tombstones.setItem", key, error);
    return false;
  }
}
