import {
  applyFlushToQueue,
  flushPendingQueue,
  type DeliverFn,
  type SentEntry,
} from "@/lib/sync-engine";

/**
 * BE-13c: a uuid-keyed pending-upsert queue for collections/items, built on the
 * BE-13a `sync-engine` core. Every owned collection/item write goes to the cloud
 * immediately; when that write fails (offline, Supabase unreachable, transient
 * 5xx) the full entity is parked here and persisted to AsyncStorage, then
 * re-delivered idempotently on the next reconnect/refresh.
 *
 * Unlike chat — which groups its queue by `chatId` so a partial flush of one
 * chat doesn't block another — collection/item upserts have no per-stream
 * ordering constraint (each row is keyed by its own uuid and the upsert is an
 * idempotent `ON CONFLICT DO UPDATE`), so the whole queue lives under one fixed
 * group key. A failed delivery still stops that group for the current flush,
 * which is exactly what we want offline: leave the rest queued for next time.
 *
 * The module is pure — no React, no Supabase, no AsyncStorage — so every branch
 * is unit-testable in plain node. Callers inject the cloud upsert as `deliver`.
 */

/** The single group every queued upsert lives under (no per-stream ordering). */
export const PENDING_UPSERT_GROUP = "";

/** A pending-upsert queue: one fixed group of entities awaiting (re)delivery. */
export type PendingUpsertQueue<T> = Record<string, T[]>;

/**
 * Add `entity` to the queue, replacing any already-queued copy with the same id
 * (latest write wins; the queue never holds two pending rows for one id). The
 * input is never mutated.
 */
export function enqueueUpsert<T>(
  queue: PendingUpsertQueue<T>,
  entity: T,
  getId: (entity: T) => string,
): PendingUpsertQueue<T> {
  const group = queue[PENDING_UPSERT_GROUP] ?? [];
  const id = getId(entity);
  const without = group.filter((e) => getId(e) !== id);
  return { ...queue, [PENDING_UPSERT_GROUP]: [...without, entity] };
}

/**
 * Drop the entity with `id` from the queue (used after a direct write that
 * succeeded, so a copy parked by an earlier failed attempt doesn't re-send).
 * Prunes the group when it empties. The input is never mutated; a queue that
 * didn't hold the id is returned unchanged.
 */
export function dequeueUpsert<T>(
  queue: PendingUpsertQueue<T>,
  id: string,
  getId: (entity: T) => string,
): PendingUpsertQueue<T> {
  const group = queue[PENDING_UPSERT_GROUP];
  if (!group) return queue;
  const without = group.filter((e) => getId(e) !== id);
  if (without.length === group.length) return queue;
  const next = { ...queue };
  if (without.length > 0) next[PENDING_UPSERT_GROUP] = without;
  else delete next[PENDING_UPSERT_GROUP];
  return next;
}

/** True when the queue holds at least one pending entity. */
export function hasPendingUpserts<T>(queue: PendingUpsertQueue<T>): boolean {
  const group = queue[PENDING_UPSERT_GROUP];
  return group != null && group.length > 0;
}

/**
 * Flush the queue through the shared engine: re-deliver each entity in order,
 * stopping at the first failure. Returns both the `sent` entries and a `next`
 * queue with every delivered entity dropped (group pruned when it empties).
 * Entities are already uuid-keyed, so the engine's idempotency key equals the
 * row id and no cache-id remap is ever needed.
 *
 * `next` is convenient for tests and single-threaded callers. A concurrent
 * caller that may enqueue fresh entities mid-flush should instead apply `sent`
 * to the *current* queue via {@link applyDeliveredUpserts} inside a state
 * updater, so an offline write parked while the flush was in flight isn't lost.
 */
export async function flushPendingUpserts<T>(
  queue: PendingUpsertQueue<T>,
  getId: (entity: T) => string,
  deliver: DeliverFn<T>,
): Promise<{ sent: SentEntry[]; next: PendingUpsertQueue<T> }> {
  const { sent } = await flushPendingQueue<T>(queue, { getId, deliver });
  const next = sent.length === 0 ? queue : applyFlushToQueue(queue, sent, getId);
  return { sent, next };
}

/**
 * Drop every delivered entity (`sent`) from `queue`, matched per group by its
 * pre-flush id. Use inside a state updater so the flush result is applied to
 * the latest queue rather than a stale snapshot.
 */
export function applyDeliveredUpserts<T>(
  queue: PendingUpsertQueue<T>,
  sent: readonly SentEntry[],
  getId: (entity: T) => string,
): PendingUpsertQueue<T> {
  return applyFlushToQueue(queue, sent, getId);
}
