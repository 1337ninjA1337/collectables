import {
  REALTIME_LISTEN_TYPES,
  REALTIME_POSTGRES_CHANGES_LISTEN_EVENT,
} from "@supabase/realtime-js";
import type { RealtimeChannel } from "@supabase/realtime-js";

import { captureException } from "@/lib/sentry";
import { subscribeShared } from "@/lib/realtime-channel-registry";
import { getSharedRealtimeClient } from "@/lib/supabase-realtime";
import { coerceCollectionRow, coerceItemRow } from "@/lib/supabase-row-coerce";
import { Collection, CollectableItem } from "@/lib/types";

/**
 * BE-18: realtime sync for the user's *own* collections, items and
 * friend-requests, routed through the single shared `RealtimeClient`
 * (`getSharedRealtimeClient`) and the fan-out registry (`subscribeShared`) so
 * every consumer of the same topic collapses onto one WebSocket subscription —
 * exactly like `subscribeToInbox`/`subscribeToListings` already do for chat and
 * marketplace.
 *
 * Before this module, cross-device additions to a user's own collections/items
 * (e.g. "added an item on mobile, not showing on PC") only surfaced on the next
 * polled delta pull. These subscriptions let a write on device A reach device B
 * promptly. The shared socket is released on sign-out by
 * `closeSharedRealtimeClient()` (wired in `auth-context`), so a logged-out
 * client never keeps these authenticated channels open.
 *
 * Scope (BE-18 + BE-19): INSERT, UPDATE and DELETE for collections/items.
 * UPDATE carries cross-device edits and soft-deletes (the BE-9 moddatetime
 * trigger surfaces a `deleted_at` write as an UPDATE); DELETE carries hard
 * removals (e.g. an `ON DELETE CASCADE`). The consumer treats every event as a
 * poke that re-runs the delta pull, so the row content is only used to skip
 * empty frames. Friend-requests stay INSERT-only — acceptance/rejection already
 * round-trips through the social-context refetch. Each helper is a no-op
 * (returns a stub) when Supabase is unconfigured, realtime is disabled by the
 * kill-switch, or `userId` is empty, so callers can wire them unconditionally
 * inside an effect.
 */

export type RealtimeSyncSubscription = { unsubscribe: () => void };

const NOOP: RealtimeSyncSubscription = { unsubscribe: () => undefined };

/** Row payloads arrive as loose records; the pure coercers narrow them. */
type DbRow = Record<string, unknown>;

/**
 * Postgres-changes events that should re-trigger a delta pull. INSERT brings in
 * new rows, UPDATE brings edits + soft-deletes, DELETE brings hard removals.
 */
const SYNCED_ROW_EVENTS = [
  REALTIME_POSTGRES_CHANGES_LISTEN_EVENT.INSERT,
  REALTIME_POSTGRES_CHANGES_LISTEN_EVENT.UPDATE,
  REALTIME_POSTGRES_CHANGES_LISTEN_EVENT.DELETE,
] as const;

/**
 * Register INSERT/UPDATE/DELETE postgres-changes listeners for one
 * `table`+`filter` on a shared channel, funnelling every event through the same
 * `emit` fan-out. DELETE delivers the removed row under `old` (the rest under
 * `new`), so we read whichever is present and guard against empty frames.
 */
function onRowChanges(
  channel: RealtimeChannel,
  emit: (row: DbRow) => void,
  table: string,
  filter: string,
): void {
  for (const event of SYNCED_ROW_EVENTS) {
    channel.on(
      REALTIME_LISTEN_TYPES.POSTGRES_CHANGES,
      { event, schema: "public", table, filter },
      (payload) => {
        const row = (payload.new ?? payload.old) as DbRow | undefined;
        if (!row || !row.id) return;
        emit(row);
      },
    );
  }
}

/**
 * Subscribe to INSERT/UPDATE/DELETE of the signed-in user's own collections
 * (`owner_user_id = userId`). Each row is coerced via the same pure
 * `coerceCollectionRow` the REST path uses, so realtime and polled rows share
 * one shape.
 */
export function subscribeToOwnCollections(
  userId: string,
  onCollection: (collection: Collection) => void,
): RealtimeSyncSubscription {
  const client = getSharedRealtimeClient();
  if (!client || !userId) return NOOP;

  return subscribeShared<DbRow>(
    client,
    `collections-changes-${userId}`,
    (channel, emit) => {
      onRowChanges(channel, emit, "collections", `owner_user_id=eq.${userId}`);
    },
    (row) => {
      try {
        onCollection(coerceCollectionRow(row));
      } catch (err) {
        // Ignore handler errors so a buggy listener can't kill the socket.
        captureException(err, {
          context: "supabase-realtime-sync.subscribeToOwnCollections.handler",
        });
      }
    },
  );
}

/**
 * Subscribe to INSERT/UPDATE/DELETE of every item the signed-in user authored
 * (`created_by_user_id = userId`), across all their collections, mirroring the
 * single-query delta pull `fetchOwnItemsSince`.
 */
export function subscribeToOwnItems(
  userId: string,
  onItem: (item: CollectableItem) => void,
): RealtimeSyncSubscription {
  const client = getSharedRealtimeClient();
  if (!client || !userId) return NOOP;

  return subscribeShared<DbRow>(
    client,
    `items-changes-${userId}`,
    (channel, emit) => {
      onRowChanges(channel, emit, "items", `created_by_user_id=eq.${userId}`);
    },
    (row) => {
      try {
        onItem(coerceItemRow(row));
      } catch (err) {
        captureException(err, {
          context: "supabase-realtime-sync.subscribeToOwnItems.handler",
        });
      }
    },
  );
}

/** A friend-request row, in either direction, as it lands on the wire. */
export type FriendRequestRow = { from_user_id: string; to_user_id: string };

/**
 * Subscribe to INSERTs of friend-requests that involve the signed-in user, in
 * EITHER direction. Postgres-changes filters only support a single equality, so
 * we register two `.on(...)` listeners on one shared channel — one filtered to
 * `to_user_id=eq.userId` (incoming) and one to `from_user_id=eq.userId`
 * (outgoing acceptance echoes) — both funnelling through the same `emit`
 * fan-out so the consumer sees one logical stream.
 */
export function subscribeToFriendRequests(
  userId: string,
  onFriendRequest: (request: FriendRequestRow) => void,
): RealtimeSyncSubscription {
  const client = getSharedRealtimeClient();
  if (!client || !userId) return NOOP;

  return subscribeShared<DbRow>(
    client,
    `friend-requests-changes-${userId}`,
    (channel, emit) => {
      const handle = (payload: { new?: unknown }) => {
        const row = payload.new as DbRow | undefined;
        if (!row || !row.from_user_id || !row.to_user_id) return;
        emit(row);
      };
      channel.on(
        REALTIME_LISTEN_TYPES.POSTGRES_CHANGES,
        {
          event: REALTIME_POSTGRES_CHANGES_LISTEN_EVENT.INSERT,
          schema: "public",
          table: "friend_requests",
          filter: `to_user_id=eq.${userId}`,
        },
        handle,
      );
      channel.on(
        REALTIME_LISTEN_TYPES.POSTGRES_CHANGES,
        {
          event: REALTIME_POSTGRES_CHANGES_LISTEN_EVENT.INSERT,
          schema: "public",
          table: "friend_requests",
          filter: `from_user_id=eq.${userId}`,
        },
        handle,
      );
    },
    (row) => {
      try {
        onFriendRequest({
          from_user_id: String(row.from_user_id ?? ""),
          to_user_id: String(row.to_user_id ?? ""),
        });
      } catch (err) {
        captureException(err, {
          context: "supabase-realtime-sync.subscribeToFriendRequests.handler",
        });
      }
    },
  );
}
