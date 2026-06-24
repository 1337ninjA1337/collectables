import { generateUuidV4, isUuidV4 } from "@/lib/uuid";

/**
 * BE-13: a single, framework-free sync core promoting the pattern that chat's
 * `flushPending` proved out — optimistic local write → uuid-keyed pending queue
 * → idempotent upsert — so collections/items/social can reuse it instead of
 * each re-implementing the same offline-retry bookkeeping.
 *
 * The shape is deliberately pure: no React, no Supabase, no AsyncStorage. The
 * delivery side-effect is injected as `deliver`, and the uuid generator is
 * injectable, so every branch is unit-testable in plain node.
 *
 * A "pending queue" is `Record<groupKey, Entity[]>`. Chat groups by `chatId`
 * (a partial flush of one chat must not block another); a single-stream
 * consumer can use one fixed key (e.g. `""`). Within a group the entities flush
 * in array order and the flush STOPS at the first failure so send order is
 * preserved and the rest stay queued for the next attempt.
 */

/** One entity that reached the server, with its idempotency-key remap. */
export interface SentEntry {
  groupKey: string;
  /** The id the entity carried in the local cache before the flush. */
  oldId: string;
  /**
   * The id the server now holds. Equals `oldId` when it was already a uuid; a
   * fresh uuid when `oldId` was a legacy non-uuid id Postgres would reject.
   */
  newId: string;
}

/**
 * Deliver one entity to the server using `outId` as its primary key. Returns
 * `true` when the row is persisted (a retry after a lost response must be an
 * idempotent no-op, keyed on `outId`), `false`/throw-free `false` when it
 * should stay queued for the next flush.
 */
export type DeliverFn<T> = (entity: T, outId: string) => Promise<boolean>;

/**
 * Minimal gate the flush consults before each delivery. `allow()` returns
 * `false` once the caller's write budget for the current window is spent, at
 * which point the flush stops and leaves the rest queued — identical
 * back-pressure to a failed delivery, so nothing is dropped. Satisfied by
 * {@link createSlidingWindowLimiter}'s return value (BE-29).
 */
export interface FlushRateLimiter {
  allow(now?: number): boolean;
}

export interface FlushOptions<T> {
  /** Read the entity's current local id (the idempotency key candidate). */
  getId: (entity: T) => string;
  deliver: DeliverFn<T>;
  /** Override the uuid mint (tests inject a deterministic generator). */
  newId?: () => string;
  /**
   * Optional app-level write rate limiter. When supplied, each entity must pass
   * `limiter.allow()` before it is delivered; the first denial stops the whole
   * flush (every group), leaving the undelivered entities queued for the next
   * pass. Omit it (the default) to flush without a write budget.
   */
  limiter?: FlushRateLimiter;
}

/**
 * Walk the pending queue and deliver each entity in order. Mirrors chat's
 * `flushPending`: each entity gets a uuid idempotency key (its own id when
 * already a uuid, otherwise a freshly minted one so a legacy non-uuid id is
 * not POSTed and rejected), delivery is sequential per group, and the loop
 * breaks at the first failure in a group to preserve send order.
 *
 * Returns the delivered entries (with id remaps) so the caller can drop them
 * from the queue via {@link applyFlushToQueue} and rewrite any cache rows whose
 * id changed via {@link remapsOnly}. Returns an empty `sent` when nothing was
 * delivered, letting the caller skip a no-op state update.
 */
export async function flushPendingQueue<T>(
  pending: Record<string, readonly T[]>,
  options: FlushOptions<T>,
): Promise<{ sent: SentEntry[] }> {
  const { getId, deliver, newId = generateUuidV4, limiter } = options;
  const sent: SentEntry[] = [];

  for (const [groupKey, entities] of Object.entries(pending)) {
    if (!entities || entities.length === 0) continue;
    let limited = false;
    for (const entity of entities) {
      // App-level write rate limit (BE-29): once the window's write budget is
      // spent, stop the whole flush and leave everything still queued. Checked
      // before minting an id / delivering so a denied entity is untouched.
      if (limiter && !limiter.allow()) {
        limited = true;
        break;
      }
      const oldId = getId(entity);
      const outId = isUuidV4(oldId) ? oldId : newId();
      const delivered = await deliver(entity, outId);
      // Stop at the first failure in this group to preserve send order; the
      // rest stay queued for the next flush.
      if (!delivered) break;
      sent.push({ groupKey, oldId, newId: outId });
    }
    // A spent budget applies across every group, not just this one — stop here
    // so a later group doesn't get a delivery the limiter already denied.
    if (limited) break;
  }

  return { sent };
}

/**
 * Build the next pending queue after a flush: drop every delivered entity
 * (matched per group by its pre-flush id) and prune groups that emptied out.
 * Entities still queued (a group that stopped at a failure) are preserved in
 * their original order. The input is never mutated.
 */
export function applyFlushToQueue<T>(
  pending: Record<string, readonly T[]>,
  sent: readonly SentEntry[],
  getId: (entity: T) => string,
): Record<string, T[]> {
  const sentByGroup = new Map<string, Set<string>>();
  for (const { groupKey, oldId } of sent) {
    const set = sentByGroup.get(groupKey) ?? new Set<string>();
    set.add(oldId);
    sentByGroup.set(groupKey, set);
  }

  const next: Record<string, T[]> = {};
  for (const [groupKey, entities] of Object.entries(pending)) {
    const sentIds = sentByGroup.get(groupKey);
    const remaining = sentIds
      ? entities.filter((e) => !sentIds.has(getId(e)))
      : [...entities];
    if (remaining.length > 0) next[groupKey] = remaining;
  }
  return next;
}

/**
 * The subset of delivered entries whose id actually changed (a legacy id was
 * remapped to a uuid). The caller uses this to rewrite the matching cache rows
 * so a realtime echo / refetch keyed on the server id stays deduped. Entries
 * whose id was already a uuid are omitted (no rewrite needed).
 */
export function remapsOnly(sent: readonly SentEntry[]): SentEntry[] {
  return sent.filter((s) => s.oldId !== s.newId);
}
