import AsyncStorage from "@react-native-async-storage/async-storage";

import { syncCursorKey } from "@/lib/storage-keys";

/**
 * BE-14 — delta pulls.
 *
 * A "sync cursor" is the highest `updated_at` timestamp the client has already
 * pulled for a given entity/user pair. The next cloud pull asks PostgREST for
 * `updated_at=gt.<cursor>` so only rows changed since the last sync come back,
 * instead of refetching the whole table on every `refreshTick`.
 *
 * The reducer (`maxUpdatedAt`) is framework-free and node-testable; the storage
 * helpers are thin AsyncStorage wrappers keyed via `syncCursorKey`.
 */

/** Entities that carry an `updated_at`/`moddatetime` trigger (see BE-9). */
export type SyncEntity = "collections" | "items" | "profiles" | "friend_requests";

/**
 * Returns the most-recent `updated_at` across `rows`, never going backwards
 * from `current`. ISO-8601 timestamps are compared numerically via `Date.parse`
 * (not lexicographically) so mixed sub-second precision / offset formats from
 * PostgREST still order correctly. Unparseable / missing values are skipped.
 *
 * Returns `current` unchanged when no row is newer (so an empty delta pull
 * leaves the cursor untouched).
 */
export function maxUpdatedAt(
  current: string | null,
  rows: readonly { updated_at?: string | null }[],
): string | null {
  let best = current;
  let bestMs = current ? Date.parse(current) : NaN;
  for (const row of rows) {
    const raw = row.updated_at;
    if (!raw) continue;
    const ms = Date.parse(raw);
    if (Number.isNaN(ms)) continue;
    if (Number.isNaN(bestMs) || ms > bestMs) {
      best = raw;
      bestMs = ms;
    }
  }
  return best;
}

/** Read the stored delta-pull cursor for an entity, or null if never synced. */
export async function getSyncCursor(
  entity: SyncEntity,
  userId: string,
): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(syncCursorKey(entity, userId));
  } catch {
    // A read failure just means we fall back to a full pull — never fatal.
    return null;
  }
}

/**
 * Persist the delta-pull cursor for an entity. No-ops when `cursor` is null or
 * equal to `previous`, so a delta pull that returned nothing newer doesn't
 * trigger a needless AsyncStorage write.
 */
export async function setSyncCursor(
  entity: SyncEntity,
  userId: string,
  cursor: string | null,
  previous?: string | null,
): Promise<void> {
  if (!cursor || cursor === previous) return;
  try {
    await AsyncStorage.setItem(syncCursorKey(entity, userId), cursor);
  } catch {
    // Best-effort: a failed cursor write just re-pulls more next time.
  }
}
