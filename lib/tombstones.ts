import AsyncStorage from "@react-native-async-storage/async-storage";

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

/** Read the stored tombstone-id set for an entity, or `[]` if none. */
export async function getTombstones(
  entity: TombstoneEntity,
  userId: string,
): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(tombstoneKey(entity, userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    // A read/parse failure just means we re-learn tombstones on the next pull.
    return [];
  }
}

/**
 * Persist the tombstone-id set for an entity. No-ops when `ids` is the same
 * reference as `previous` (the merge helpers return the original reference when
 * nothing changed), so an idempotent pull doesn't trigger a needless write.
 */
export async function setTombstones(
  entity: TombstoneEntity,
  userId: string,
  ids: readonly string[],
  previous?: readonly string[],
): Promise<void> {
  if (previous !== undefined && ids === previous) return;
  try {
    await AsyncStorage.setItem(tombstoneKey(entity, userId), JSON.stringify(ids));
  } catch {
    // Best-effort: a failed write just re-learns tombstones from the next pull.
  }
}
