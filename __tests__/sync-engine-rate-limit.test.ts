import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { flushPendingQueue, type FlushRateLimiter } from "@/lib/sync-engine";
import { createSlidingWindowLimiter } from "@/lib/sliding-window-limiter";

interface Row {
  id: string;
}

const getId = (r: Row) => r.id;
const U = (n: number) =>
  `${String(n).padStart(8, "0")}-2222-4333-8444-555555555555`;

/** A limiter that allows the first `budget` calls then denies — clock-free. */
function countingLimiter(budget: number): FlushRateLimiter {
  let used = 0;
  return {
    allow() {
      if (used >= budget) return false;
      used += 1;
      return true;
    },
  };
}

describe("BE-29 flushPendingQueue write rate limiting", () => {
  it("delivers only up to the limiter's budget, leaving the rest queued", async () => {
    const delivered: string[] = [];
    const pending = {
      "": [{ id: U(1) }, { id: U(2) }, { id: U(3) }, { id: U(4) }],
    };

    const { sent } = await flushPendingQueue<Row>(pending, {
      getId,
      deliver: async (row) => {
        delivered.push(row.id);
        return true;
      },
      limiter: countingLimiter(2),
    });

    assert.equal(sent.length, 2);
    assert.deepEqual(delivered, [U(1), U(2)]);
  });

  it("checks the limiter before delivering, so a denied entity is untouched", async () => {
    let deliverCalls = 0;
    const { sent } = await flushPendingQueue<Row>(
      { "": [{ id: U(1) }] },
      {
        getId,
        deliver: async () => {
          deliverCalls += 1;
          return true;
        },
        limiter: countingLimiter(0),
      },
    );
    assert.equal(deliverCalls, 0);
    assert.equal(sent.length, 0);
  });

  it("a spent budget stops every group, not just the current one", async () => {
    const delivered: string[] = [];
    const pending = {
      a: [{ id: U(1) }],
      b: [{ id: U(2) }],
    };
    const { sent } = await flushPendingQueue<Row>(pending, {
      getId,
      deliver: async (row) => {
        delivered.push(row.id);
        return true;
      },
      limiter: countingLimiter(1),
    });
    assert.equal(sent.length, 1);
    // Group "b" must not receive a delivery the limiter already denied.
    assert.deepEqual(delivered, [U(1)]);
  });

  it("without a limiter, flushing is unbounded (back-compat)", async () => {
    const pending = { "": [{ id: U(1) }, { id: U(2) }, { id: U(3) }] };
    const { sent } = await flushPendingQueue<Row>(pending, {
      getId,
      deliver: async () => true,
    });
    assert.equal(sent.length, 3);
  });

  it("interoperates with a real sliding-window limiter", async () => {
    const limiter = createSlidingWindowLimiter({ windowMs: 60_000, max: 2 });
    const pending = { "": [{ id: U(1) }, { id: U(2) }, { id: U(3) }] };
    const first = await flushPendingQueue<Row>(pending, {
      getId,
      deliver: async () => true,
      limiter,
    });
    assert.equal(first.sent.length, 2);
    // Window is now full — a second flush of the remainder delivers nothing.
    const second = await flushPendingQueue<Row>(
      { "": [{ id: U(3) }] },
      { getId, deliver: async () => true, limiter },
    );
    assert.equal(second.sent.length, 0);
  });
});
