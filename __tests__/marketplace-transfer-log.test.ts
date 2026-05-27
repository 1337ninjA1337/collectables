import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  isTransferLogEntry,
  mergeTransferLogEntry,
  transferLogEntryId,
  type MarketplaceTransferLogEntry,
} from "@/lib/marketplace-transfer-log";
import { marketplaceTransferLogKey } from "@/lib/storage-keys";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

function entry(overrides: Partial<MarketplaceTransferLogEntry> = {}): MarketplaceTransferLogEntry {
  const listingId = overrides.listingId ?? "l-1";
  const listingCreatedAt = overrides.listingCreatedAt ?? "2026-05-27T10:00:00.000Z";
  return {
    id: overrides.id ?? transferLogEntryId(listingId, listingCreatedAt),
    listingId,
    listingCreatedAt,
    sellerUserId: "seller",
    itemId: "item-1",
    collectionId: "buyer-acquired-marketplace",
    title: "Vintage card",
    photo: "https://img/1.jpg",
    mode: "sell",
    price: 50,
    currency: "USD",
    acquiredFrom: "Marketplace",
    acquiredAt: "2026-05-27T10:05:00.000Z",
    ...overrides,
  };
}

describe("transferLogEntryId", () => {
  it("composes the dedup id as `${listingId}-${createdAt}`", () => {
    assert.equal(
      transferLogEntryId("l-1", "2026-05-27T10:00:00.000Z"),
      "l-1-2026-05-27T10:00:00.000Z",
    );
  });

  it("passes through inputs verbatim (no sanitisation)", () => {
    assert.equal(transferLogEntryId("", ""), "-");
  });
});

describe("mergeTransferLogEntry", () => {
  it("prepends a brand-new entry to the front of the log", () => {
    const older = entry({ id: "x-1" });
    const next = mergeTransferLogEntry([older], entry({ id: "x-2" }));
    assert.equal(next.length, 2);
    assert.equal(next[0].id, "x-2");
    assert.equal(next[1].id, "x-1");
  });

  it("dedupes on id — a retry of the same listing replaces the prior entry", () => {
    const first = entry({ id: "x-1", title: "Old title" });
    const second = entry({ id: "x-1", title: "New title" });
    const merged = mergeTransferLogEntry([first], second);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].title, "New title");
  });

  it("does not mutate the input array", () => {
    const input = [entry({ id: "x-1" })];
    const before = input.slice();
    mergeTransferLogEntry(input, entry({ id: "x-2" }));
    assert.deepEqual(input, before);
  });

  it("preserves the relative order of older entries when deduping in the middle", () => {
    const a = entry({ id: "a" });
    const b = entry({ id: "b" });
    const c = entry({ id: "c" });
    const merged = mergeTransferLogEntry([a, b, c], entry({ id: "b", title: "B'" }));
    assert.deepEqual(
      merged.map((e) => e.id),
      ["b", "a", "c"],
    );
    assert.equal(merged[0].title, "B'");
  });
});

describe("isTransferLogEntry", () => {
  it("accepts a fully shaped entry", () => {
    assert.equal(isTransferLogEntry(entry()), true);
  });

  it("rejects non-objects", () => {
    assert.equal(isTransferLogEntry(null), false);
    assert.equal(isTransferLogEntry(undefined), false);
    assert.equal(isTransferLogEntry("nope"), false);
    assert.equal(isTransferLogEntry(42), false);
  });

  it("rejects entries with a missing string field", () => {
    const partial = { ...entry(), title: undefined } as unknown;
    assert.equal(isTransferLogEntry(partial), false);
  });

  it("rejects entries with an invalid mode", () => {
    const partial = { ...entry(), mode: "barter" } as unknown;
    assert.equal(isTransferLogEntry(partial), false);
  });

  it("accepts entries with null photo or null price", () => {
    assert.equal(isTransferLogEntry(entry({ photo: null })), true);
    assert.equal(isTransferLogEntry(entry({ price: null })), true);
  });

  it("rejects entries whose price is a string instead of number-or-null", () => {
    const bad = { ...entry(), price: "50" } as unknown;
    assert.equal(isTransferLogEntry(bad), false);
  });
});

describe("marketplaceTransferLogKey", () => {
  it("is scoped per user with the canonical prefix", () => {
    assert.equal(
      marketplaceTransferLogKey("u-7"),
      "collectables-marketplace-transfer-log-v1-u-7",
    );
  });
});

describe("transferItemToBuyer source plumbing (structural)", () => {
  // Pin the call-site so a future refactor can't silently strip the source
  // metadata, which would leave the buyer-side log empty for new claims.
  const ctxSrc = read("lib/collections-context.tsx");
  const listingSrc = read("app/listing/[id].tsx");

  it("collections-context.tsx imports the transfer-log helper", () => {
    assert.match(
      ctxSrc,
      /import\s+\{[\s\S]*?appendTransferLogEntry[\s\S]*?\}\s+from\s+"@\/lib\/marketplace-transfer-log"/,
    );
    assert.match(
      ctxSrc,
      /import\s+\{[\s\S]*?transferLogEntryId[\s\S]*?\}\s+from\s+"@\/lib\/marketplace-transfer-log"/,
    );
  });

  it("transferItemToBuyer writes a log entry when options.source is provided", () => {
    assert.match(
      ctxSrc,
      /if\s*\(\s*options\?\.source\s*\)/,
      "must gate the log write on the optional source field",
    );
    assert.match(
      ctxSrc,
      /appendTransferLogEntry\(\s*ownerUserId\s*,/,
      "must persist the entry under the buyer's userId",
    );
  });

  it("listing detail screen threads source.listingId/createdAt through transferItemToBuyer", () => {
    assert.match(
      listingSrc,
      /source:\s*\{[\s\S]*?listingId:\s*listing\.id[\s\S]*?listingCreatedAt:\s*listing\.createdAt/,
    );
    assert.match(
      listingSrc,
      /sellerUserId:\s*listing\.ownerUserId/,
    );
  });
});
