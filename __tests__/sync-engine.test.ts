import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  applyFlushToQueue,
  flushPendingQueue,
  remapsOnly,
  type SentEntry,
} from "@/lib/sync-engine";
import { isUuidV4 } from "@/lib/uuid";

interface Row {
  id: string;
  text: string;
}

const getId = (r: Row) => r.id;

const VALID_UUID = "11111111-2222-4333-8444-555555555555";
const VALID_UUID_2 = "99999999-8888-4777-8666-555555555555";

/** A deterministic generator so remapped ids are assertable. */
function seqIds(prefix = "gen"): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

describe("flushPendingQueue (BE-13a)", () => {
  it("delivers every entity in order and reports them as sent", async () => {
    const calls: { id: string; outId: string }[] = [];
    const { sent } = await flushPendingQueue<Row>(
      {
        chatA: [
          { id: VALID_UUID, text: "a" },
          { id: VALID_UUID_2, text: "b" },
        ],
      },
      {
        getId,
        deliver: async (entity, outId) => {
          calls.push({ id: entity.id, outId });
          return true;
        },
      },
    );

    assert.deepEqual(
      calls.map((c) => c.id),
      [VALID_UUID, VALID_UUID_2],
    );
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[0], {
      groupKey: "chatA",
      oldId: VALID_UUID,
      newId: VALID_UUID,
    });
  });

  it("mints a uuid idempotency key for a legacy non-uuid id", async () => {
    const seen: string[] = [];
    const { sent } = await flushPendingQueue<Row>(
      { g: [{ id: "msg-1718-abc", text: "legacy" }] },
      {
        getId,
        newId: seqIds("uuid"),
        deliver: async (_entity, outId) => {
          seen.push(outId);
          return true;
        },
      },
    );

    assert.equal(seen[0], "uuid-1");
    assert.equal(sent[0].oldId, "msg-1718-abc");
    assert.equal(sent[0].newId, "uuid-1");
    assert.notEqual(sent[0].oldId, sent[0].newId);
  });

  it("reuses an already-uuid id unchanged (oldId === newId)", async () => {
    const { sent } = await flushPendingQueue<Row>(
      { g: [{ id: VALID_UUID, text: "x" }] },
      { getId, deliver: async () => true },
    );
    assert.equal(sent[0].oldId, sent[0].newId);
    assert.equal(sent[0].newId, VALID_UUID);
  });

  it("uses the real uuid generator by default", async () => {
    const { sent } = await flushPendingQueue<Row>(
      { g: [{ id: "legacy", text: "x" }] },
      { getId, deliver: async () => true },
    );
    assert.ok(isUuidV4(sent[0].newId));
  });

  it("stops at the first failure in a group, preserving order", async () => {
    const delivered: string[] = [];
    const { sent } = await flushPendingQueue<Row>(
      {
        g: [
          { id: VALID_UUID, text: "1" },
          { id: VALID_UUID_2, text: "2-fails" },
          { id: "33333333-2222-4333-8444-555555555555", text: "3" },
        ],
      },
      {
        getId,
        deliver: async (entity) => {
          if (entity.text === "2-fails") return false;
          delivered.push(entity.id);
          return true;
        },
      },
    );

    // Only the first delivered; the failure halts the group before #3.
    assert.deepEqual(delivered, [VALID_UUID]);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].oldId, VALID_UUID);
  });

  it("flushes other groups independently of one that failed", async () => {
    const { sent } = await flushPendingQueue<Row>(
      {
        bad: [{ id: VALID_UUID, text: "x" }],
        good: [{ id: VALID_UUID_2, text: "y" }],
      },
      {
        getId,
        deliver: async (entity) => entity.text !== "x",
      },
    );
    const groups = sent.map((s) => s.groupKey);
    assert.deepEqual(groups, ["good"]);
  });

  it("skips empty and missing groups", async () => {
    let calls = 0;
    const { sent } = await flushPendingQueue<Row>(
      { empty: [], also: [] },
      {
        getId,
        deliver: async () => {
          calls++;
          return true;
        },
      },
    );
    assert.equal(calls, 0);
    assert.equal(sent.length, 0);
  });
});

describe("applyFlushToQueue (BE-13a)", () => {
  const pending: Record<string, Row[]> = {
    g: [
      { id: "a", text: "1" },
      { id: "b", text: "2" },
      { id: "c", text: "3" },
    ],
    h: [{ id: "d", text: "4" }],
  };

  it("drops delivered entities and keeps the rest in order", () => {
    const sent: SentEntry[] = [
      { groupKey: "g", oldId: "a", newId: "a" },
      { groupKey: "g", oldId: "c", newId: "c" },
    ];
    const next = applyFlushToQueue(pending, sent, getId);
    assert.deepEqual(next.g.map((r) => r.id), ["b"]);
    assert.deepEqual(next.h.map((r) => r.id), ["d"]);
  });

  it("prunes a group that fully emptied", () => {
    const sent: SentEntry[] = [{ groupKey: "h", oldId: "d", newId: "d" }];
    const next = applyFlushToQueue(pending, sent, getId);
    assert.ok(!("h" in next));
    assert.ok("g" in next);
  });

  it("does not mutate the input queue", () => {
    const sent: SentEntry[] = [{ groupKey: "g", oldId: "a", newId: "a" }];
    applyFlushToQueue(pending, sent, getId);
    assert.equal(pending.g.length, 3);
  });

  it("returns groups unchanged when nothing was sent for them", () => {
    const next = applyFlushToQueue(pending, [], getId);
    assert.deepEqual(next.g.map((r) => r.id), ["a", "b", "c"]);
    assert.deepEqual(next.h.map((r) => r.id), ["d"]);
  });
});

describe("remapsOnly (BE-13a)", () => {
  it("returns only entries whose id changed", () => {
    const sent: SentEntry[] = [
      { groupKey: "g", oldId: VALID_UUID, newId: VALID_UUID },
      { groupKey: "g", oldId: "legacy", newId: VALID_UUID_2 },
    ];
    const remaps = remapsOnly(sent);
    assert.equal(remaps.length, 1);
    assert.equal(remaps[0].oldId, "legacy");
    assert.equal(remaps[0].newId, VALID_UUID_2);
  });

  it("returns empty when no ids changed", () => {
    const sent: SentEntry[] = [
      { groupKey: "g", oldId: VALID_UUID, newId: VALID_UUID },
    ];
    assert.deepEqual(remapsOnly(sent), []);
  });
});
