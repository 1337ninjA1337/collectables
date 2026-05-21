import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  subscribeShared,
  __resetChannelRegistryForTests,
} from "@/lib/realtime-channel-registry";

/**
 * Tests for the fan-out subscriber registry that sits on top of
 * `getSharedRealtimeClient`. Uses fake `RealtimeClient` / `RealtimeChannel`
 * stubs so the registry's ref-counting + fan-out semantics can be exercised
 * without a live WebSocket.
 *
 * The registry's contract: N consumers calling `subscribeShared(client,
 * topic, configure, onPayload)` with the same `(client, topic)` MUST share
 * one channel; `configure` runs exactly once; every emit fans out to every
 * registered handler; the channel is removed only when the last subscriber
 * unsubscribes.
 */

type FakeChannel = {
  topic: string;
  on: (event: string, filter: unknown, handler: (payload: unknown) => void) => FakeChannel;
  subscribe: (cb: (status: string) => void) => FakeChannel;
  __statusCb: ((status: string) => void) | null;
  __postgresHandler: ((payload: unknown) => void) | null;
  __removed: boolean;
};

type FakeClient = {
  channel: (topic: string) => FakeChannel;
  removeChannel: (channel: FakeChannel) => Promise<void>;
  __channels: FakeChannel[];
  __removeCallCount: number;
};

function createFakeClient(): FakeClient {
  const channels: FakeChannel[] = [];
  const client: FakeClient = {
    channel(topic: string) {
      const ch: FakeChannel = {
        topic,
        __statusCb: null,
        __postgresHandler: null,
        __removed: false,
        on(_event, _filter, handler) {
          ch.__postgresHandler = handler as (payload: unknown) => void;
          return ch;
        },
        subscribe(cb) {
          ch.__statusCb = cb;
          return ch;
        },
      };
      channels.push(ch);
      return ch;
    },
    async removeChannel(ch) {
      ch.__removed = true;
      client.__removeCallCount += 1;
    },
    __channels: channels,
    __removeCallCount: 0,
  };
  return client;
}

describe("subscribeShared — fan-out subscriber registry", () => {
  beforeEach(() => {
    __resetChannelRegistryForTests();
  });

  it("first subscriber for a topic creates exactly one channel and runs configure once", () => {
    const client = createFakeClient();
    let configureCalls = 0;
    const handle = subscribeShared<{ id: string }>(
      client as never,
      "topic-a",
      (channel, _emit) => {
        configureCalls += 1;
        channel.on("postgres_changes", {}, () => undefined);
      },
      () => undefined,
    );
    assert.equal(client.__channels.length, 1);
    assert.equal(configureCalls, 1);
    handle.unsubscribe();
  });

  it("repeat subscribers for the same topic share one channel (configure runs once)", () => {
    const client = createFakeClient();
    let configureCalls = 0;
    const make = () =>
      subscribeShared<{ id: string }>(
        client as never,
        "topic-shared",
        (channel, _emit) => {
          configureCalls += 1;
          channel.on("postgres_changes", {}, () => undefined);
        },
        () => undefined,
      );
    const a = make();
    const b = make();
    const c = make();
    assert.equal(client.__channels.length, 1, "only one channel should be created");
    assert.equal(configureCalls, 1, "configure must run once per topic");
    a.unsubscribe();
    b.unsubscribe();
    c.unsubscribe();
  });

  it("emit fans out to every registered payload handler", () => {
    const client = createFakeClient();
    const received: Array<{ owner: string; payload: { id: string } }> = [];
    let capturedEmit: ((p: { id: string }) => void) | null = null;
    subscribeShared<{ id: string }>(
      client as never,
      "topic-fan",
      (channel, emit) => {
        capturedEmit = emit;
        channel.on("postgres_changes", {}, () => undefined);
      },
      (p) => received.push({ owner: "alice", payload: p }),
    );
    subscribeShared<{ id: string }>(
      client as never,
      "topic-fan",
      () => {
        throw new Error("configure should not run again for repeat subscribers");
      },
      (p) => received.push({ owner: "bob", payload: p }),
    );
    subscribeShared<{ id: string }>(
      client as never,
      "topic-fan",
      () => undefined,
      (p) => received.push({ owner: "carol", payload: p }),
    );
    assert.ok(capturedEmit, "emit must be captured during configure");
    capturedEmit!({ id: "row-1" });
    assert.deepEqual(received, [
      { owner: "alice", payload: { id: "row-1" } },
      { owner: "bob", payload: { id: "row-1" } },
      { owner: "carol", payload: { id: "row-1" } },
    ]);
  });

  it("a buggy handler does not block the rest of the fan-out", () => {
    const client = createFakeClient();
    let capturedEmit: ((p: { id: string }) => void) | null = null;
    const seen: string[] = [];
    subscribeShared<{ id: string }>(
      client as never,
      "topic-isolated",
      (_ch, emit) => {
        capturedEmit = emit;
      },
      () => {
        throw new Error("boom");
      },
    );
    subscribeShared<{ id: string }>(
      client as never,
      "topic-isolated",
      () => undefined,
      (p) => seen.push(p.id),
    );
    capturedEmit!({ id: "row-99" });
    assert.deepEqual(seen, ["row-99"]);
  });

  it("only removes the channel when the last subscriber unsubscribes", () => {
    const client = createFakeClient();
    const a = subscribeShared(
      client as never,
      "topic-rc",
      () => undefined,
      () => undefined,
    );
    const b = subscribeShared(
      client as never,
      "topic-rc",
      () => undefined,
      () => undefined,
    );
    a.unsubscribe();
    assert.equal(client.__removeCallCount, 0, "still has one live subscriber");
    b.unsubscribe();
    assert.equal(client.__removeCallCount, 1, "last unsubscribe should remove the channel");
  });

  it("unsubscribe is idempotent — calling twice does not double-remove", () => {
    const client = createFakeClient();
    const handle = subscribeShared(
      client as never,
      "topic-idem",
      () => undefined,
      () => undefined,
    );
    handle.unsubscribe();
    handle.unsubscribe();
    assert.equal(client.__removeCallCount, 1);
  });

  it("fans out subscribe status changes to every registered status handler", () => {
    const client = createFakeClient();
    const statusA: boolean[] = [];
    const statusB: boolean[] = [];
    subscribeShared(
      client as never,
      "topic-status",
      () => undefined,
      () => undefined,
      (c) => statusA.push(c),
    );
    subscribeShared(
      client as never,
      "topic-status",
      () => undefined,
      () => undefined,
      (c) => statusB.push(c),
    );
    // First subscriber's onStatusChange should have been replayed with the
    // current (false) state; second subscriber likewise sees the current state
    // immediately (still false because SUBSCRIBED has not fired yet).
    assert.deepEqual(statusA, [false]);
    assert.deepEqual(statusB, [false]);
    // Now drive the underlying channel.subscribe callback to SUBSCRIBED.
    const channel = client.__channels[0];
    channel.__statusCb?.("SUBSCRIBED");
    assert.deepEqual(statusA, [false, true]);
    assert.deepEqual(statusB, [false, true]);
  });

  it("late joiners receive the current connected status immediately", () => {
    const client = createFakeClient();
    subscribeShared(
      client as never,
      "topic-late",
      () => undefined,
      () => undefined,
      () => undefined,
    );
    const channel = client.__channels[0];
    channel.__statusCb?.("SUBSCRIBED");
    // A late subscriber should see `true` replayed without waiting for the
    // next reconnect transition.
    const lateStatus: boolean[] = [];
    subscribeShared(
      client as never,
      "topic-late",
      () => {
        throw new Error("late subscriber must not trigger configure");
      },
      () => undefined,
      (c) => lateStatus.push(c),
    );
    assert.deepEqual(lateStatus, [true]);
  });

  it("a new channel is created if every subscriber leaves before a new one arrives", () => {
    const client = createFakeClient();
    const a = subscribeShared(
      client as never,
      "topic-recreate",
      () => undefined,
      () => undefined,
    );
    a.unsubscribe();
    assert.equal(client.__channels.length, 1);
    assert.equal(client.__removeCallCount, 1);
    const b = subscribeShared(
      client as never,
      "topic-recreate",
      () => undefined,
      () => undefined,
    );
    assert.equal(client.__channels.length, 2, "second cycle should construct a fresh channel");
    b.unsubscribe();
  });

  it("different topics are isolated and each get their own channel", () => {
    const client = createFakeClient();
    subscribeShared(client as never, "topic-x", () => undefined, () => undefined);
    subscribeShared(client as never, "topic-y", () => undefined, () => undefined);
    subscribeShared(client as never, "topic-z", () => undefined, () => undefined);
    assert.equal(client.__channels.length, 3);
    const topics = client.__channels.map((c) => c.topic).sort();
    assert.deepEqual(topics, ["topic-x", "topic-y", "topic-z"]);
  });

  it("different clients with the same topic do not collide (per-client registry)", () => {
    const clientA = createFakeClient();
    const clientB = createFakeClient();
    subscribeShared(clientA as never, "shared-topic", () => undefined, () => undefined);
    subscribeShared(clientB as never, "shared-topic", () => undefined, () => undefined);
    assert.equal(clientA.__channels.length, 1);
    assert.equal(clientB.__channels.length, 1);
  });

  it("a removeChannel failure does not throw out of unsubscribe", () => {
    const client = createFakeClient();
    client.removeChannel = async () => {
      throw new Error("network down");
    };
    const handle = subscribeShared(
      client as never,
      "topic-fail",
      () => undefined,
      () => undefined,
    );
    assert.doesNotThrow(() => handle.unsubscribe());
  });
});

describe("realtime-channel-registry wiring", () => {
  const root = process.cwd();
  const chatSource = readFileSync(path.join(root, "lib", "supabase-chat.ts"), "utf8");
  const marketplaceSource = readFileSync(
    path.join(root, "lib", "supabase-marketplace.ts"),
    "utf8",
  );
  const registrySource = readFileSync(
    path.join(root, "lib", "realtime-channel-registry.ts"),
    "utf8",
  );

  it("supabase-chat.ts routes subscribeToInbox through subscribeShared", () => {
    assert.match(chatSource, /from\s+"@\/lib\/realtime-channel-registry"/);
    assert.match(chatSource, /subscribeShared</);
    // The bespoke `client.channel(inboxChannelTopic(...))` + `.subscribe((status) =>`
    // block should be gone — those responsibilities moved into subscribeShared.
    assert.doesNotMatch(
      chatSource,
      /client\.channel\(inboxChannelTopic\(/,
      "subscribeToInbox should no longer call client.channel directly",
    );
  });

  it("supabase-marketplace.ts routes subscribeToListings through subscribeShared", () => {
    assert.match(marketplaceSource, /from\s+"@\/lib\/realtime-channel-registry"/);
    assert.match(marketplaceSource, /subscribeShared</);
    assert.doesNotMatch(
      marketplaceSource,
      /client\.channel\("marketplace-listings-inserts"\)/,
      "subscribeToListings should no longer call client.channel directly",
    );
  });

  it("registry exposes subscribeShared + __resetChannelRegistryForTests", () => {
    assert.match(registrySource, /export\s+function\s+subscribeShared/);
    assert.match(registrySource, /export\s+function\s+__resetChannelRegistryForTests/);
  });

  it("registry uses a WeakMap keyed by client so a stale client gets a fresh entry map", () => {
    // WeakMap prevents the registry from keeping a closed client alive after
    // closeSharedRealtimeClient drops its module-scope cache reference.
    assert.match(registrySource, /WeakMap<RealtimeClient/);
    assert.match(registrySource, /new\s+WeakMap\(/);
  });

  it("registry isolates handler exceptions so one buggy consumer cannot kill the fan-out", () => {
    // The pure fan-out test above proves the runtime behaviour; pin the
    // structural try/catch so a future refactor that removes the guard fails
    // loudly here too.
    const tryCount = (registrySource.match(/try\s*\{/g) ?? []).length;
    assert.ok(tryCount >= 3, "expected at least 3 try/catch blocks (payload, status, removeChannel)");
  });
});
