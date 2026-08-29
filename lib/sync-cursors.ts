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
 *
 * WITHIN ONE MILLISECOND THE STRING DECIDES (2026-08-29). `Date.parse` resolves
 * to milliseconds and `updated_at` is a `timestamptz`, which Postgres keeps to
 * MICROSECONDS — so `.123456` and `.123900` parse to the same number, `ms >
 * bestMs` was false, and this function returned whichever of them the array
 * happened to hold first rather than the larger one. Same-millisecond rows are
 * not a corner case here: `moddatetime` stamps every row of one statement with
 * the same `now()`, so any multi-row write produces a batch of them.
 *
 * The cost is paid by the caller, because the cursor is used as `updated_at=gt`
 * — a cursor one microsecond short of the batch maximum re-downloads every row
 * above it on the NEXT pull, and the one after that, until the batch narrows to
 * a single row. It converges, quietly, having spent the egress this projection
 * was narrowed to save. It also made the cursor depend on row order, so two
 * devices reading the same rows stored different cursors.
 *
 * The tiebreak is the raw string, which is the sub-millisecond precision
 * `Date.parse` discarded. It is only ever consulted between two timestamps
 * already known to name the same millisecond, so the prefix through that
 * millisecond is identical and what remains to compare is the fractional tail —
 * the one place lexicographic order is exactly right. Two spellings of the same
 * instant (`…Z` and `…+00:00`) compare arbitrarily and correctly: either is a
 * cursor naming that instant.
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
    const newer =
      Number.isNaN(bestMs) || ms > bestMs || (ms === bestMs && best !== null && raw > best);
    if (newer) {
      best = raw;
      bestMs = ms;
    }
  }
  return best;
}

/**
 * How far short of the batch maximum a persisted cursor stops.
 *
 * Ten seconds because the window it covers is one transaction's lifetime, and
 * these are single-row upserts. It is spent on a re-read rather than on a
 * write, so being generous is nearly free; being short is not recoverable.
 */
export const SYNC_OVERLAP_MS = 10_000;

/**
 * The cursor to PERSIST, which is deliberately behind the batch maximum.
 *
 * `updated_at` is `now()` under `moddatetime`, and `now()` in Postgres is the
 * transaction's START time — while a row becomes visible to a reader at its
 * COMMIT. A write that began before this pull's snapshot and committed after it
 * is therefore absent from the batch AND carries a timestamp at or below the
 * batch maximum. Store that maximum and the next `updated_at=gt` pull steps
 * straight over the row: it is not deleted, so no tombstone covers it, and it
 * is not new, so nothing else asks for it. The edit is simply never seen on
 * this device again until somebody touches that row a second time.
 *
 * The fix is the standard one — persist a cursor a margin behind the maximum,
 * so the next pull re-reads the window the race lives in. What makes it cheap
 * here rather than merely correct is the no-op contract on the two cloud
 * merges: a re-read row that changed nothing returns the local array by
 * reference, so React does not re-render and neither AsyncStorage blob is
 * rewritten. The overlap costs one small query.
 *
 * IT DOES NOT CATCH UP ON ITS OWN, and that is the accepted trade rather than
 * an oversight. With no new writes the batch maximum stops moving, so the
 * stored cursor stays a margin behind it and each pull re-reads the same
 * bounded window — the rows written in the ten seconds before the last write.
 * Rewinding relative to `Date.now()` instead would let it converge, at the cost
 * of trusting a device clock against a server timestamp; a phone whose clock
 * runs fast by more than the margin would defeat the guard silently, which is
 * the failure this exists to prevent.
 *
 * Never returns a value below `previous`: the cursor is monotonic, so a short
 * batch cannot walk it backwards into rows already applied.
 */
export function overlapCursor(
  next: string | null,
  previous: string | null,
  marginMs: number = SYNC_OVERLAP_MS,
): string | null {
  if (!next) return previous;
  const nextMs = Date.parse(next);
  if (Number.isNaN(nextMs)) return previous;
  const rewound = new Date(nextMs - marginMs).toISOString();
  if (previous === null) return rewound;
  const previousMs = Date.parse(previous);
  if (Number.isNaN(previousMs)) return rewound;
  return previousMs >= Date.parse(rewound) ? previous : rewound;
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
