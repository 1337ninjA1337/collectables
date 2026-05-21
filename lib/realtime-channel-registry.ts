import type { RealtimeChannel, RealtimeClient } from "@supabase/realtime-js";
import { REALTIME_SUBSCRIBE_STATES } from "@supabase/realtime-js";

/**
 * Fan-out subscriber registry on top of `getSharedRealtimeClient`.
 *
 * Without this layer, every screen that calls e.g. `subscribeToInbox(userId,
 * handler)` constructs its own channel via `client.channel(topic)` even when
 * the topic is identical — so N independent consumers of the same stream
 * cause N WebSocket subscriptions to Postgres-Changes and the same row is
 * delivered N times. The registry collapses repeat subscribers on the same
 * `(client, topic)` pair onto one channel and fans each emitted payload out
 * to every registered handler, tearing the channel down only when the last
 * subscriber unsubscribes (ref-counted).
 *
 * Pure module — no React Native imports — so it can be unit-tested directly
 * under `node --test`. Both `lib/supabase-chat.ts:subscribeToInbox` and
 * `lib/supabase-marketplace.ts:subscribeToListings` route through it; future
 * cloud-backed screens that want to listen to the same topics should reuse
 * the helper instead of calling `client.channel(...)` directly.
 */

export type ChannelConfigurator<TPayload> = (
  channel: RealtimeChannel,
  emit: (payload: TPayload) => void,
) => void;

export type SubscribeSharedHandle = {
  unsubscribe: () => void;
};

type Entry<TPayload> = {
  channel: RealtimeChannel;
  payloadHandlers: Set<(payload: TPayload) => void>;
  statusHandlers: Set<(connected: boolean) => void>;
  connected: boolean;
};

let registries: WeakMap<RealtimeClient, Map<string, Entry<unknown>>> = new WeakMap();

function getRegistryFor(client: RealtimeClient): Map<string, Entry<unknown>> {
  let map = registries.get(client);
  if (!map) {
    map = new Map();
    registries.set(client, map);
  }
  return map;
}

/**
 * Module-level aggregate status snapshot keyed by topic, plus a fan-out of
 * status events to global listeners (e.g. `RealtimeStatusProvider`). The
 * snapshot is a single Map<string, boolean> because the app uses one shared
 * RealtimeClient — see `lib/supabase-realtime.ts`. Per-client isolation still
 * holds for channel construction; the snapshot only collapses topic names.
 *
 * Listeners receive a snapshot on every change so they can recompute the
 * derived "online" / "connecting" state in one place instead of patching
 * their own Map. Per-listener try/catch isolates buggy consumers.
 */
export type RegistryStatusSnapshot = ReadonlyMap<string, boolean>;
export type RegistryStatusListener = (snapshot: RegistryStatusSnapshot) => void;

let statusSnapshot: Map<string, boolean> = new Map();
let statusListeners: Set<RegistryStatusListener> = new Set();

function emitStatusChange(): void {
  if (statusListeners.size === 0) return;
  // Pass a fresh shallow copy so a listener that stashes the reference doesn't
  // observe later mutations as silent state shifts.
  const frozen: RegistryStatusSnapshot = new Map(statusSnapshot);
  for (const listener of statusListeners) {
    try {
      listener(frozen);
    } catch {
      // Isolated per listener — one buggy consumer must not block the rest.
    }
  }
}

/**
 * Subscribe to aggregate channel status changes across every topic currently
 * tracked by the registry. The listener fires:
 *  - when a new topic is first subscribed (initial `false`)
 *  - when a topic transitions between SUBSCRIBED and not
 *  - when a topic is fully released (entry dropped from the snapshot)
 * The first invocation passes the current snapshot immediately so late
 * joiners don't have to wait for the next transition.
 */
export function subscribeRegistryStatus(
  listener: RegistryStatusListener,
): () => void {
  statusListeners.add(listener);
  try {
    listener(new Map(statusSnapshot));
  } catch {
    // Isolated per listener.
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    statusListeners.delete(listener);
  };
}

/** Current snapshot of `topic -> connected` for every tracked entry. */
export function getRegistryStatusSnapshot(): RegistryStatusSnapshot {
  return new Map(statusSnapshot);
}

/**
 * Subscribe to a shared channel by topic. The first subscriber for `topic`
 * triggers `configure(channel, emit)` to wire `.on(...)` listeners and a
 * single `.subscribe(...)` call; subsequent subscribers for the same topic
 * just add their handler to the fan-out set. The channel is removed via
 * `client.removeChannel` only when the last subscriber unsubscribes.
 *
 * `onStatusChange` is optional. New subscribers receive the current
 * connected state immediately so a late joiner doesn't have to wait for the
 * next reconnect transition to learn whether the socket is live.
 */
export function subscribeShared<TPayload>(
  client: RealtimeClient,
  topic: string,
  configure: ChannelConfigurator<TPayload>,
  onPayload: (payload: TPayload) => void,
  onStatusChange?: (connected: boolean) => void,
): SubscribeSharedHandle {
  const registry = getRegistryFor(client);
  let entry = registry.get(topic) as Entry<TPayload> | undefined;
  if (!entry) {
    const channel = client.channel(topic);
    const payloadHandlers = new Set<(payload: TPayload) => void>();
    const statusHandlers = new Set<(connected: boolean) => void>();
    const created: Entry<TPayload> = {
      channel,
      payloadHandlers,
      statusHandlers,
      connected: false,
    };
    const emit = (payload: TPayload) => {
      for (const handler of payloadHandlers) {
        try {
          handler(payload);
        } catch {
          // Isolated per handler — one buggy consumer must not block the rest.
        }
      }
    };
    configure(channel, emit);
    channel.subscribe((status: string) => {
      const connected = status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED;
      const changed = created.connected !== connected;
      created.connected = connected;
      for (const handler of statusHandlers) {
        try {
          handler(connected);
        } catch {
          // Isolated per handler.
        }
      }
      if (changed) {
        statusSnapshot.set(topic, connected);
        emitStatusChange();
      }
    });
    entry = created;
    registry.set(topic, created as Entry<unknown>);
    // New topic enters the snapshot as `false`; emit so a consumer can show
    // a "connecting" pill before SUBSCRIBED fires.
    statusSnapshot.set(topic, false);
    emitStatusChange();
  }
  const acquired = entry;
  acquired.payloadHandlers.add(onPayload);
  if (onStatusChange) {
    acquired.statusHandlers.add(onStatusChange);
    // Replay current state so a late joiner sees the live status without
    // having to wait for the next transition.
    try {
      onStatusChange(acquired.connected);
    } catch {
      // Isolated per handler.
    }
  }

  let released = false;
  return {
    unsubscribe: () => {
      if (released) return;
      released = true;
      acquired.payloadHandlers.delete(onPayload);
      if (onStatusChange) acquired.statusHandlers.delete(onStatusChange);
      if (
        acquired.payloadHandlers.size === 0 &&
        acquired.statusHandlers.size === 0
      ) {
        registry.delete(topic);
        statusSnapshot.delete(topic);
        emitStatusChange();
        try {
          const maybePromise = client.removeChannel(acquired.channel) as
            | Promise<unknown>
            | undefined;
          // removeChannel returns a Promise — swallow rejections so a flaky
          // network teardown doesn't surface as an unhandledRejection.
          if (maybePromise && typeof maybePromise.then === "function") {
            maybePromise.then(undefined, () => undefined);
          }
        } catch {
          // Best-effort cleanup — the socket may already be closed.
        }
      }
    },
  };
}

/** Test-only: drop every cached entry across all clients. */
export function __resetChannelRegistryForTests(): void {
  registries = new WeakMap();
  statusSnapshot = new Map();
  statusListeners = new Set();
}
