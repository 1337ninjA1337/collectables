import {
  PENDING_UPSERT_GROUP,
  applyDeliveredUpserts,
  countPendingUpserts,
  dequeueUpsert,
  flushPendingUpserts,
  hasPendingUpserts,
  type PendingUpsertQueue,
} from "@/lib/pending-upserts";
import type { DeliverFn, SentEntry } from "@/lib/sync-engine";
import type { UserProfile } from "@/lib/types";

/**
 * BE-13d: a pending-mutation queue for the social graph (friend requests +
 * own-profile overrides), built on the BE-13c pending-upsert wrapper and the
 * BE-13a `sync-engine` core. Every owned social write — sending/withdrawing a
 * friend request, syncing the signed-in user's profile — is attempted against
 * the cloud immediately; when that write fails (offline, Supabase unreachable,
 * transient 5xx) the mutation is parked here and persisted to AsyncStorage,
 * then re-delivered idempotently on the next reconnect.
 *
 * Unlike collections/items — where the queued entity IS the row and dedup is by
 * row id — a social mutation is an *operation*, so it carries a `kind`. Each is
 * reduced to a stable string key ({@link socialMutationKey}) that doubles as the
 * dedup key and the engine's idempotency-key seed. All three underlying cloud
 * calls are already idempotent (send = upsert on the directed pair, remove =
 * delete the pair both directions, profile = `ON CONFLICT DO UPDATE`), so a
 * retry after a lost response is a safe no-op.
 *
 * The module is pure — no React, no Supabase, no AsyncStorage — so every branch
 * is unit-testable in plain node. The context injects the cloud calls as
 * {@link makeSocialDeliver} dependencies.
 */

/** One queued social-graph write awaiting (re)delivery. */
export type SocialMutation =
  | { kind: "send-request"; fromUserId: string; toUserId: string }
  | { kind: "accept-request"; acceptorUserId: string; fromUserId: string }
  | { kind: "remove-request"; userId: string; otherUserId: string }
  | { kind: "upsert-profile"; profile: UserProfile };

/** A pending social-mutation queue (single fixed group, ordered). */
export type PendingSocialQueue = PendingUpsertQueue<SocialMutation>;

/** Unordered pair key so a friend op matches regardless of direction. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * The stable key identifying a mutation. `send-request` keeps its direction
 * (the row is directed), `remove-request` is keyed by the unordered pair (the
 * delete clears both directions), and `upsert-profile` is keyed by profile id
 * so repeated offline profile edits collapse to the latest write.
 */
export function socialMutationKey(mutation: SocialMutation): string {
  switch (mutation.kind) {
    case "send-request":
      return `send:${mutation.fromUserId}:${mutation.toUserId}`;
    case "accept-request":
      return `accept:${mutation.acceptorUserId}:${mutation.fromUserId}`;
    case "remove-request":
      return `remove:${pairKey(mutation.userId, mutation.otherUserId)}`;
    case "upsert-profile":
      return `profile:${mutation.profile.id}`;
  }
}

/** The friend pair a mutation acts on, or `null` for a profile upsert. */
function friendPairOf(mutation: SocialMutation): string | null {
  switch (mutation.kind) {
    case "send-request":
      return pairKey(mutation.fromUserId, mutation.toUserId);
    case "accept-request":
      return pairKey(mutation.acceptorUserId, mutation.fromUserId);
    case "remove-request":
      return pairKey(mutation.userId, mutation.otherUserId);
    case "upsert-profile":
      return null;
  }
}

/**
 * True when two friend mutations on the same pair cancel out: a still-pending
 * *create* of the caller's directed row (`send-request` or `accept-request`) is
 * annulled by a `remove-request` (and vice versa), so an offline add/accept
 * then-remove never hits the network. Two creates (send + accept) don't oppose,
 * two removes don't oppose, and profile upserts never oppose anything.
 */
function isOpposing(a: SocialMutation, b: SocialMutation): boolean {
  const pair = friendPairOf(a);
  if (pair === null || pair !== friendPairOf(b)) return false;
  const aRemove = a.kind === "remove-request";
  const bRemove = b.kind === "remove-request";
  // Exactly one of the two is a remove ⇒ a create vs. a remove on the same pair.
  return aRemove !== bRemove;
}

/**
 * Add `mutation` to the queue. A new mutation first annuls any still-pending
 * opposing op for the same friend pair (an offline add-then-remove never hits
 * the network), then replaces any queued copy with the same key (latest write
 * wins). The input is never mutated.
 */
export function enqueueSocialMutation(
  queue: PendingSocialQueue,
  mutation: SocialMutation,
): PendingSocialQueue {
  const group = queue[PENDING_UPSERT_GROUP] ?? [];
  const key = socialMutationKey(mutation);
  const retained = group.filter(
    (entry) => !isOpposing(entry, mutation) && socialMutationKey(entry) !== key,
  );
  return { ...queue, [PENDING_UPSERT_GROUP]: [...retained, mutation] };
}

/** Drop a delivered mutation from the queue (no-op if absent). */
export function dequeueSocialMutation(
  queue: PendingSocialQueue,
  mutation: SocialMutation,
): PendingSocialQueue {
  return dequeueUpsert(queue, socialMutationKey(mutation), socialMutationKey);
}

/** True when the queue holds at least one pending mutation. */
export function hasPendingSocial(queue: PendingSocialQueue): boolean {
  return hasPendingUpserts(queue);
}

/** Number of social mutations awaiting (re)delivery (BE-16 "syncing…" pill). */
export function countPendingSocial(queue: PendingSocialQueue): number {
  return countPendingUpserts(queue);
}

/** Drop every delivered mutation (`sent`) from the *current* queue. */
export function applyDeliveredSocial(
  queue: PendingSocialQueue,
  sent: readonly SentEntry[],
): PendingSocialQueue {
  return applyDeliveredUpserts(queue, sent, socialMutationKey);
}

/** The cloud writes a social mutation can resolve to. */
export interface SocialDeliverDeps {
  sendFriendRequest: (fromUserId: string, toUserId: string) => Promise<void>;
  acceptFriendRequest: (acceptorUserId: string, fromUserId: string) => Promise<void>;
  removeFriendRequest: (userId: string, otherUserId: string) => Promise<void>;
  upsertMyProfile: (profile: UserProfile) => Promise<void>;
}

/**
 * Build the engine `deliver` for social mutations: dispatch on `kind`, return
 * `true` when the cloud write resolves and `false` (never throwing) when it
 * rejects so the mutation stays queued for the next flush.
 */
export function makeSocialDeliver(deps: SocialDeliverDeps): DeliverFn<SocialMutation> {
  return async (mutation) => {
    try {
      switch (mutation.kind) {
        case "send-request":
          await deps.sendFriendRequest(mutation.fromUserId, mutation.toUserId);
          break;
        case "accept-request":
          await deps.acceptFriendRequest(mutation.acceptorUserId, mutation.fromUserId);
          break;
        case "remove-request":
          await deps.removeFriendRequest(mutation.userId, mutation.otherUserId);
          break;
        case "upsert-profile":
          await deps.upsertMyProfile(mutation.profile);
          break;
      }
      return true;
    } catch {
      return false;
    }
  };
}

/**
 * Flush the queue through the shared engine: re-deliver each mutation in order,
 * stopping at the first failure. Returns the `sent` entries and a `next` queue
 * with delivered mutations dropped. Concurrent callers should apply `sent` to
 * the latest queue via {@link applyDeliveredSocial} instead of using `next`.
 */
export async function flushPendingSocial(
  queue: PendingSocialQueue,
  deliver: DeliverFn<SocialMutation>,
): Promise<{ sent: SentEntry[]; next: PendingSocialQueue }> {
  return flushPendingUpserts(queue, socialMutationKey, deliver);
}
