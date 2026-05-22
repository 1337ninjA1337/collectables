import { createContext, useContext, useEffect, useMemo, useState } from "react";

import {
  RegistryStatusSnapshot,
  getRegistryStatusSnapshot,
  subscribeRegistryStatus,
} from "@/lib/realtime-channel-registry";

/**
 * Shared connection-state surface for the app's realtime sockets. Mirrors what
 * `lib/chat-context.tsx` already does for the inbox channel (`realtimeOnline`),
 * but in a single context that every screen can read — so the marketplace,
 * future presence-tracked profile screens, etc. don't each wire up their own
 * status listener.
 *
 * Connection state is derived from the registry's per-topic snapshot:
 *   - `idle`        — no topics tracked (no subscription has been opened yet).
 *   - `connecting`  — at least one topic exists but none has reached SUBSCRIBED.
 *   - `online`      — at least one topic is currently SUBSCRIBED.
 *
 * "Reconnecting" is a UI flavour of `connecting` — once a topic is live then
 * drops back to `false` the snapshot goes from online → connecting, which is
 * the same shape a screen can render as a pill.
 */

export type RealtimeConnectionState = "idle" | "connecting" | "online";

type RealtimeStatusContextValue = {
  connectionState: RealtimeConnectionState;
  online: boolean;
  topics: ReadonlyMap<string, boolean>;
  isTopicOnline: (topic: string) => boolean;
};

const RealtimeStatusContext = createContext<RealtimeStatusContextValue | null>(null);

function deriveConnectionState(topics: ReadonlyMap<string, boolean>): RealtimeConnectionState {
  if (topics.size === 0) return "idle";
  for (const connected of topics.values()) {
    if (connected) return "online";
  }
  return "connecting";
}

export function RealtimeStatusProvider({ children }: React.PropsWithChildren) {
  const [topics, setTopics] = useState<ReadonlyMap<string, boolean>>(() =>
    getRegistryStatusSnapshot(),
  );

  useEffect(() => {
    // subscribeRegistryStatus invokes the listener once with the current
    // snapshot — covers the late-mount case where channels already exist.
    const unsubscribe = subscribeRegistryStatus((snapshot: RegistryStatusSnapshot) => {
      setTopics(snapshot);
    });
    return unsubscribe;
  }, []);

  const value = useMemo<RealtimeStatusContextValue>(() => {
    const connectionState = deriveConnectionState(topics);
    return {
      connectionState,
      online: connectionState === "online",
      topics,
      isTopicOnline: (topic: string) => topics.get(topic) === true,
    };
  }, [topics]);

  return (
    <RealtimeStatusContext.Provider value={value}>{children}</RealtimeStatusContext.Provider>
  );
}

export function useRealtimeStatus(): RealtimeStatusContextValue {
  const ctx = useContext(RealtimeStatusContext);
  if (!ctx) {
    throw new Error("useRealtimeStatus must be used inside RealtimeStatusProvider");
  }
  return ctx;
}

/** Optional variant for screens that may render outside the provider tree
 * (e.g. error fallbacks). Returns `null` instead of throwing. */
export function useOptionalRealtimeStatus(): RealtimeStatusContextValue | null {
  return useContext(RealtimeStatusContext);
}

// Re-exported pure helper so tests can pin the derivation logic without
// spinning up React's hook machinery.
export { deriveConnectionState };
