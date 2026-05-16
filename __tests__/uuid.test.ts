import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { generateUuidV4, isUuidV4 } from "@/lib/uuid";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("generateUuidV4", () => {
  it("produces a syntactically valid RFC 4122 v4 uuid", () => {
    for (let i = 0; i < 50; i++) {
      assert.match(generateUuidV4(), V4);
    }
  });

  it("produces unique values across many calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(generateUuidV4());
    assert.equal(seen.size, 2000);
  });

  it("falls back to a valid v4 uuid when no platform crypto is present", () => {
    const original = (globalThis as { crypto?: unknown }).crypto;
    try {
      // Simulate a runtime with no Web Crypto (older RN/Hermes).
      Object.defineProperty(globalThis, "crypto", {
        value: undefined,
        configurable: true,
      });
      const id = generateUuidV4();
      assert.match(id, V4);
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        value: original,
        configurable: true,
      });
    }
  });

  it("uses getRandomValues when randomUUID is unavailable", () => {
    const original = (globalThis as { crypto?: unknown }).crypto;
    try {
      Object.defineProperty(globalThis, "crypto", {
        value: {
          getRandomValues: (arr: Uint8Array) => {
            for (let i = 0; i < arr.length; i++) arr[i] = (i * 37 + 7) & 0xff;
            return arr;
          },
        },
        configurable: true,
      });
      const id = generateUuidV4();
      assert.match(id, V4);
      // version nibble pinned to 4, variant nibble pinned to 8..b
      assert.equal(id[14], "4");
      assert.ok(["8", "9", "a", "b"].includes(id[19]));
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        value: original,
        configurable: true,
      });
    }
  });
});

describe("isUuidV4", () => {
  it("accepts freshly generated ids", () => {
    assert.equal(isUuidV4(generateUuidV4()), true);
  });

  it("accepts a canonical lowercase v4 uuid", () => {
    assert.equal(isUuidV4("11111111-1111-4111-8111-111111111111"), true);
  });

  it("rejects the legacy msg- id scheme that the uuid column refused", () => {
    assert.equal(isUuidV4("msg-1700000000000-ab12cd"), false);
  });

  it("rejects empty, non-v4, and malformed strings", () => {
    assert.equal(isUuidV4(""), false);
    assert.equal(isUuidV4("not-a-uuid"), false);
    // v1 (version nibble 1) must be rejected — we require v4.
    assert.equal(isUuidV4("11111111-1111-1111-8111-111111111111"), false);
    // bad variant nibble (c) must be rejected.
    assert.equal(isUuidV4("11111111-1111-4111-c111-111111111111"), false);
  });
});
