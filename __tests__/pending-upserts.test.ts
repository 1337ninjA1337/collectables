import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PENDING_UPSERT_GROUP,
  applyDeliveredUpserts,
  dequeueUpsert,
  enqueueUpsert,
  flushPendingUpserts,
  hasPendingUpserts,
  type PendingUpsertQueue,
} from "@/lib/pending-upserts";

interface Row {
  id: string;
  text: string;
}

const getId = (r: Row) => r.id;

const A = "aaaaaaaa-1111-4111-8111-111111111111";
const B = "bbbbbbbb-2222-4222-8222-222222222222";
const C = "cccccccc-3333-4333-8333-333333333333";

describe("enqueueUpsert (BE-13c)", () => {
  it("adds an entity under the single fixed group", () => {
    const q = enqueueUpsert<Row>({}, { id: A, text: "a" }, getId);
    assert.deepEqual(q, { [PENDING_UPSERT_GROUP]: [{ id: A, text: "a" }] });
  });

  it("appends a second distinct entity in order", () => {
    let q: PendingUpsertQueue<Row> = {};
    q = enqueueUpsert(q, { id: A, text: "a" }, getId);
    q = enqueueUpsert(q, { id: B, text: "b" }, getId);
    assert.deepEqual(q[PENDING_UPSERT_GROUP].map((r) => r.id), [A, B]);
  });

  it("replaces an already-queued copy with the same id (latest wins)", () => {
    let q: PendingUpsertQueue<Row> = {};
    q = enqueueUpsert(q, { id: A, text: "v1" }, getId);
    q = enqueueUpsert(q, { id: B, text: "b" }, getId);
    q = enqueueUpsert(q, { id: A, text: "v2" }, getId);
    // A is de-duped to a single, latest entry — and moves to the tail.
    assert.deepEqual(q[PENDING_UPSERT_GROUP], [
      { id: B, text: "b" },
      { id: A, text: "v2" },
    ]);
  });

  it("never mutates the input queue", () => {
    const original: PendingUpsertQueue<Row> = {};
    const next = enqueueUpsert(original, { id: A, text: "a" }, getId);
    assert.deepEqual(original, {});
    assert.notEqual(next, original);
  });
});

describe("dequeueUpsert (BE-13c)", () => {
  it("removes the entity with the given id", () => {
    let q: PendingUpsertQueue<Row> = {};
    q = enqueueUpsert(q, { id: A, text: "a" }, getId);
    q = enqueueUpsert(q, { id: B, text: "b" }, getId);
    const next = dequeueUpsert(q, A, getId);
    assert.deepEqual(next[PENDING_UPSERT_GROUP].map((r) => r.id), [B]);
  });

  it("prunes the group when the last entity leaves", () => {
    const q = enqueueUpsert<Row>({}, { id: A, text: "a" }, getId);
    const next = dequeueUpsert(q, A, getId);
    assert.deepEqual(next, {});
    assert.equal(hasPendingUpserts(next), false);
  });

  it("returns the same reference when the id isn't queued (no-op)", () => {
    const q = enqueueUpsert<Row>({}, { id: A, text: "a" }, getId);
    const next = dequeueUpsert(q, C, getId);
    assert.equal(next, q);
  });

  it("returns the same reference for an empty queue", () => {
    const q: PendingUpsertQueue<Row> = {};
    assert.equal(dequeueUpsert(q, A, getId), q);
  });
});

describe("hasPendingUpserts (BE-13c)", () => {
  it("is false for an empty queue", () => {
    assert.equal(hasPendingUpserts({}), false);
  });
  it("is true once an entity is queued", () => {
    const q = enqueueUpsert<Row>({}, { id: A, text: "a" }, getId);
    assert.equal(hasPendingUpserts(q), true);
  });
});

describe("flushPendingUpserts (BE-13c)", () => {
  it("delivers every queued entity (uuid id == idempotency key) and empties the queue", async () => {
    let q: PendingUpsertQueue<Row> = {};
    q = enqueueUpsert(q, { id: A, text: "a" }, getId);
    q = enqueueUpsert(q, { id: B, text: "b" }, getId);

    const delivered: { row: Row; outId: string }[] = [];
    const { sent, next } = await flushPendingUpserts(q, getId, async (row, outId) => {
      delivered.push({ row, outId });
      return true;
    });

    assert.deepEqual(delivered.map((d) => d.row.id), [A, B]);
    // Already-uuid ids flow through unchanged as the idempotency key.
    assert.deepEqual(delivered.map((d) => d.outId), [A, B]);
    assert.equal(sent.length, 2);
    assert.deepEqual(next, {});
  });

  it("keeps an entity queued when its delivery fails (offline)", async () => {
    let q: PendingUpsertQueue<Row> = {};
    q = enqueueUpsert(q, { id: A, text: "a" }, getId);
    q = enqueueUpsert(q, { id: B, text: "b" }, getId);

    // Stop-on-first-failure: A fails, so B is never attempted and both stay.
    const { sent, next } = await flushPendingUpserts(q, getId, async () => false);

    assert.equal(sent.length, 0);
    assert.deepEqual(next[PENDING_UPSERT_GROUP].map((r) => r.id), [A, B]);
  });

  it("drops only the delivered prefix when a later delivery fails", async () => {
    let q: PendingUpsertQueue<Row> = {};
    q = enqueueUpsert(q, { id: A, text: "a" }, getId);
    q = enqueueUpsert(q, { id: B, text: "b" }, getId);
    q = enqueueUpsert(q, { id: C, text: "c" }, getId);

    const { next } = await flushPendingUpserts(q, getId, async (row) => row.id !== B);

    // A delivered, B failed (stops the group), C never attempted.
    assert.deepEqual(next[PENDING_UPSERT_GROUP].map((r) => r.id), [B, C]);
  });
});

describe("applyDeliveredUpserts (BE-13c)", () => {
  it("drops delivered entities from the current queue (not a stale snapshot)", async () => {
    // Snapshot the flush against [A], then a concurrent write enqueues C.
    let snapshot: PendingUpsertQueue<Row> = enqueueUpsert({}, { id: A, text: "a" }, getId);
    const { sent } = await flushPendingUpserts(snapshot, getId, async () => true);

    let current: PendingUpsertQueue<Row> = enqueueUpsert(snapshot, { id: C, text: "c" }, getId);
    current = applyDeliveredUpserts(current, sent, getId);

    // A (delivered) is gone; C (parked mid-flush) survives.
    assert.deepEqual(current[PENDING_UPSERT_GROUP].map((r) => r.id), [C]);
  });
});
