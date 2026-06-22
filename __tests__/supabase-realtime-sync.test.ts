import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { RealtimeChannel, RealtimeClient } from "@supabase/realtime-js";

import { coerceCollectionRow, coerceItemRow } from "@/lib/supabase-row-coerce";
import {
  subscribeShared,
  __resetChannelRegistryForTests,
} from "@/lib/realtime-channel-registry";

/**
 * BE-18: collections/items/friend_requests realtime routed through the shared
 * RealtimeClient + fan-out registry.
 *
 * `lib/supabase-realtime-sync.ts` transitively imports React Native peers via
 * `@/lib/supabase`, so the wrapper itself is verified structurally (source
 * grep), mirroring `marketplace-realtime-updates.test.ts`. The pieces it
 * composes — the pure row coercers and the fan-out registry — are exercised at
 * runtime.
 */

const SYNC_PATH = path.join(process.cwd(), "lib", "supabase-realtime-sync.ts");
const COLLECTIONS_CTX_PATH = path.join(process.cwd(), "lib", "collections-context.tsx");
const SOCIAL_CTX_PATH = path.join(process.cwd(), "lib", "social-context.tsx");
const AUTH_CTX_PATH = path.join(process.cwd(), "lib", "auth-context.tsx");

function read(p: string): string {
  return readFileSync(p, "utf8");
}

describe("supabase-realtime-sync — wrapper structure", () => {
  const src = read(SYNC_PATH);

  it("routes every subscription through getSharedRealtimeClient", () => {
    assert.match(src, /from\s+"@\/lib\/supabase-realtime"/);
    const calls = src.match(/getSharedRealtimeClient\(\)/g) ?? [];
    assert.ok(
      calls.length >= 3,
      `expected getSharedRealtimeClient in all three helpers, found ${calls.length}`,
    );
  });

  it("uses the fan-out registry (subscribeShared) rather than client.channel directly", () => {
    assert.match(src, /from\s+"@\/lib\/realtime-channel-registry"/);
    const shared = src.match(/subscribeShared</g) ?? [];
    assert.ok(shared.length >= 3, `expected 3 subscribeShared calls, found ${shared.length}`);
    // No bespoke channel construction — that would bypass ref-counting.
    assert.doesNotMatch(src, /client\.channel\(/);
  });

  it("exports the three subscription helpers", () => {
    assert.match(src, /export\s+function\s+subscribeToOwnCollections/);
    assert.match(src, /export\s+function\s+subscribeToOwnItems/);
    assert.match(src, /export\s+function\s+subscribeToFriendRequests/);
  });

  it("each helper returns a stub when the client is null or userId is empty", () => {
    const guards = src.match(/if\s*\(!client\s*\|\|\s*!userId\)\s*return\s+NOOP/g) ?? [];
    assert.ok(
      guards.length >= 3,
      `expected an unconfigured/empty-user guard in each helper, found ${guards.length}`,
    );
  });

  it("collections + items subscribe to their own rows via the shared row-events helper", () => {
    // Both own-data helpers route through onRowChanges(channel, emit, table, filter).
    assert.match(
      src,
      /onRowChanges\(channel,\s*emit,\s*"collections",\s*`owner_user_id=eq\.\$\{userId\}`\)/,
    );
    assert.match(
      src,
      /onRowChanges\(channel,\s*emit,\s*"items",\s*`created_by_user_id=eq\.\$\{userId\}`\)/,
    );
    const inserts = src.match(/REALTIME_POSTGRES_CHANGES_LISTEN_EVENT\.INSERT/g) ?? [];
    // SYNCED_ROW_EVENTS (1, shared by collections+items) + friend_requests (2) = 3
    assert.ok(inserts.length >= 3, `expected >=3 INSERT references, found ${inserts.length}`);
  });

  it("friend_requests registers BOTH directions on one shared channel", () => {
    assert.match(src, /table:\s*"friend_requests"/);
    assert.match(src, /filter:\s*`to_user_id=eq\.\$\{userId\}`/);
    assert.match(src, /filter:\s*`from_user_id=eq\.\$\{userId\}`/);
    // Both directions funnel through the same emit fan-out (one logical stream).
    const topics = src.match(/`friend-requests-changes-\$\{userId\}`/g) ?? [];
    assert.equal(topics.length, 1, "friend-requests must use a single channel topic");
  });

  it("each topic is per-user so two accounts on one device don't collide", () => {
    assert.match(src, /`collections-changes-\$\{userId\}`/);
    assert.match(src, /`items-changes-\$\{userId\}`/);
    assert.match(src, /`friend-requests-changes-\$\{userId\}`/);
  });

  it("BE-19: collections/items also propagate UPDATE and DELETE", () => {
    // The shared SYNCED_ROW_EVENTS array covers all three postgres-changes types.
    assert.match(src, /REALTIME_POSTGRES_CHANGES_LISTEN_EVENT\.UPDATE/);
    assert.match(src, /REALTIME_POSTGRES_CHANGES_LISTEN_EVENT\.DELETE/);
    // A DELETE delivers the removed row under `old`, so the helper reads new ?? old.
    assert.match(src, /payload\.new\s*\?\?\s*payload\.old/);
  });

  it("coerces collection/item rows through the shared pure coercers", () => {
    assert.match(src, /coerceCollectionRow\(/);
    assert.match(src, /coerceItemRow\(/);
  });

  it("isolates handler errors via captureException so a bad listener can't kill the socket", () => {
    const captures = src.match(/captureException\(/g) ?? [];
    assert.ok(captures.length >= 3, `expected per-handler captureException, found ${captures.length}`);
  });
});

describe("collections-context — realtime wiring", () => {
  const src = read(COLLECTIONS_CTX_PATH);

  it("imports the own-collections + own-items subscriptions", () => {
    assert.match(src, /subscribeToOwnCollections/);
    assert.match(src, /subscribeToOwnItems/);
  });

  it("a realtime event pokes refreshTick (reusing the delta-pull merge)", () => {
    // The realtime callback must trigger the existing syncFromCloud path rather
    // than merging inline, so realtime and polled rows converge on one merge.
    assert.match(src, /setRefreshTick\(\(t\)\s*=>\s*t\s*\+\s*1\)/);
  });

  it("unsubscribes both channels on cleanup", () => {
    assert.match(src, /collectionsSub\.unsubscribe\(\)/);
    assert.match(src, /itemsSub\.unsubscribe\(\)/);
  });
});

describe("social-context — friend-request realtime wiring", () => {
  const src = read(SOCIAL_CTX_PATH);

  it("imports and uses subscribeToFriendRequests", () => {
    assert.match(src, /subscribeToFriendRequests/);
  });

  it("re-pulls the canonical friend-request list on a realtime event", () => {
    // Realtime is a poke: we refetch (not trust the wire row) to stay
    // consistent with the hydrate path's mapping.
    assert.match(src, /fetchFriendRequests\(activeUser\.id\)/);
    assert.match(src, /setFriendRequests\(/);
  });

  it("unsubscribes on cleanup", () => {
    assert.match(src, /sub\.unsubscribe\(\)/);
  });
});

describe("auth-context — shared socket released on sign-out", () => {
  it("calls closeSharedRealtimeClient when signing out", () => {
    const src = read(AUTH_CTX_PATH);
    assert.match(src, /closeSharedRealtimeClient\(\)/);
  });
});

// ---------------------------------------------------------------------------
// Runtime checks of the pieces the wrapper composes.
// ---------------------------------------------------------------------------

type FakeChannel = RealtimeChannel & {
  fire: (event: unknown) => void;
  handlers: ((event: unknown) => void)[];
};

function makeFakeClient(): {
  client: RealtimeClient;
  channels: Map<string, FakeChannel>;
  removed: string[];
} {
  const channels = new Map<string, FakeChannel>();
  const removed: string[] = [];
  const client = {
    channel(topic: string): RealtimeChannel {
      const handlers: ((event: unknown) => void)[] = [];
      const ch = {
        handlers,
        on(_type: unknown, _cfg: unknown, cb: (event: unknown) => void) {
          handlers.push(cb);
          return ch;
        },
        subscribe(cb?: (status: string) => void) {
          cb?.("SUBSCRIBED");
          return ch;
        },
        fire(event: unknown) {
          for (const h of handlers) h(event);
        },
      } as unknown as FakeChannel;
      channels.set(topic, ch);
      return ch as unknown as RealtimeChannel;
    },
    removeChannel(ch: RealtimeChannel) {
      for (const [topic, c] of channels) {
        if (c === (ch as unknown as FakeChannel)) removed.push(topic);
      }
      return Promise.resolve("ok");
    },
  } as unknown as RealtimeClient;
  return { client, channels, removed };
}

describe("registry fan-out — what the wrapper relies on", () => {
  it("collapses repeat subscribers on a per-user topic onto one channel", () => {
    __resetChannelRegistryForTests();
    const { client, channels } = makeFakeClient();
    const seenA: unknown[] = [];
    const seenB: unknown[] = [];
    const topic = "collections-changes-u1";
    const configure = (channel: RealtimeChannel, emit: (p: unknown) => void) => {
      (channel as unknown as { on: (...a: unknown[]) => unknown }).on(
        "postgres_changes",
        {},
        (payload: { new?: unknown }) => emit(payload.new),
      );
    };
    const a = subscribeShared(client, topic, configure, (p) => seenA.push(p));
    const b = subscribeShared(client, topic, configure, (p) => seenB.push(p));
    assert.equal(channels.size, 1, "two subscribers must share one channel");

    channels.get(topic)!.fire({ new: { id: "c1" } });
    assert.deepEqual(seenA, [{ id: "c1" }]);
    assert.deepEqual(seenB, [{ id: "c1" }]);

    a.unsubscribe();
    b.unsubscribe();
  });
});

describe("row coercion — what the handlers emit", () => {
  it("coerceCollectionRow narrows a realtime collection row", () => {
    const c = coerceCollectionRow({
      id: "c1",
      name: "Coins",
      owner_user_id: "u1",
      visibility: "public",
    });
    assert.equal(c.id, "c1");
    assert.equal(c.name, "Coins");
    assert.equal(c.ownerUserId, "u1");
    assert.equal(c.visibility, "public");
  });

  it("coerceItemRow narrows a realtime item row", () => {
    const i = coerceItemRow({
      id: "i1",
      collection_id: "c1",
      title: "1909 Penny",
      created_by_user_id: "u1",
    });
    assert.equal(i.id, "i1");
    assert.equal(i.collectionId, "c1");
    assert.equal(i.title, "1909 Penny");
    assert.equal(i.createdByUserId, "u1");
  });
});
