import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  byCreatedAtAscThenId,
  byCreatedAtDescThenId,
  tieBreakById,
  compareIsoDesc,
} from "@/lib/sort-helpers";
import { buildChatPreviews } from "@/lib/chat-helpers";
import { selectRecentItems } from "@/lib/home-helpers";
import { priceHistoryForTitle, recentlySoldListings } from "@/lib/marketplace-helpers";
import type { ChatMessage, CollectableItem, Collection, MarketplaceListing } from "@/lib/types";
import { readRepoFile } from "./helpers/repo-file";

/**
 * `sort-helpers.test.ts` pins comparator *consistency* — ties return 0, so
 * `Array.prototype.sort`'s stability guarantee applies. That fixed half the
 * bug: stability preserves the INPUT order, and every list here is rebuilt
 * from a source whose order is incidental (`Object.entries` rehydration, an
 * id-keyed cloud merge). This suite pins the other half — the orders are
 * TOTAL, so the same rows produce the same output no matter how they arrived.
 *
 * The distinction is only cosmetic until a caller cuts a top-N. Three do
 * (`selectRecentItems`, `recentlySoldListings`, `priceHistoryForTitle`), and
 * there a tie at the boundary decides which row a user sees at all — which is
 * why those three get a shuffle test rather than a spot check.
 */
const AT = (n: number) => new Date(1767225600000 + n).toISOString();

/**
 * Deterministic Fisher-Yates so a failure reproduces. A random shuffle here
 * would make "the order depends on input order" an intermittent failure, which
 * is the exact bug being fixed.
 */
function permutations<T>(rows: readonly T[], count = 12): T[][] {
  const out: T[][] = [];
  let seed = 42;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let n = 0; n < count; n += 1) {
    const copy = rows.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    out.push(copy);
  }
  return out;
}

describe("tieBreakById", () => {
  const primary = (a: { at: string }, b: { at: string }) => compareIsoDesc(a.at, b.at);

  it("defers to the primary comparator when it is decisive", () => {
    const cmp = tieBreakById(primary, (v: { at: string; id: string }) => v.id);
    // `id` would order these the other way — the primary must win.
    assert.ok(cmp({ at: AT(1000), id: "z" }, { at: AT(0), id: "a" }) < 0);
  });

  it("breaks a primary tie on the id, in both directions", () => {
    const cmp = tieBreakById(primary, (v: { at: string; id: string }) => v.id);
    assert.ok(cmp({ at: AT(0), id: "a" }, { at: AT(0), id: "b" }) < 0);
    assert.ok(cmp({ at: AT(0), id: "b" }, { at: AT(0), id: "a" }) > 0);
  });

  it("still returns exactly 0 when the ids also match", () => {
    // Comparator consistency has to survive the wrapping: an element compared
    // against itself must be 0 or the sort is implementation-defined again.
    const cmp = tieBreakById(primary, (v: { at: string; id: string }) => v.id);
    assert.equal(cmp({ at: AT(0), id: "a" }, { at: AT(0), id: "a" }), 0);
  });
});

describe("byCreatedAtAscThenId / byCreatedAtDescThenId", () => {
  it("orders by createdAt first and by id only on a tie", () => {
    const older = { id: "z", createdAt: AT(0) };
    const newer = { id: "a", createdAt: AT(1000) };
    assert.ok(byCreatedAtAscThenId(older, newer) < 0);
    assert.ok(byCreatedAtDescThenId(older, newer) > 0);
    assert.ok(byCreatedAtAscThenId({ id: "a", createdAt: AT(0) }, older) < 0);
  });

  it("breaks ties ASCENDING by id under both directions", () => {
    // Deliberate: the tiebreak is a stable machine ordering, not a secondary
    // presentation axis, so flipping the primary direction must not flip it.
    const a = { id: "a", createdAt: AT(0) };
    const b = { id: "b", createdAt: AT(0) };
    assert.ok(byCreatedAtAscThenId(a, b) < 0);
    assert.ok(byCreatedAtDescThenId(a, b) < 0);
  });

  it("produces one identical order from every input permutation", () => {
    const rows = [
      { id: "d", createdAt: AT(0) },
      { id: "b", createdAt: AT(0) },
      { id: "c", createdAt: AT(1000) },
      { id: "a", createdAt: AT(0) },
      { id: "e", createdAt: AT(1000) },
    ];
    const expectedDesc = ["c", "e", "a", "b", "d"];
    for (const shuffled of permutations(rows)) {
      assert.deepEqual(
        [...shuffled].sort(byCreatedAtDescThenId).map((r) => r.id),
        expectedDesc,
      );
      assert.deepEqual(
        [...shuffled].sort(byCreatedAtAscThenId).map((r) => r.id),
        ["a", "b", "d", "c", "e"],
      );
    }
  });
});

const message = (
  id: string,
  chatId: string,
  from: string,
  at: string,
  text: string,
): ChatMessage => ({ id, chatId, fromUserId: from, toUserId: "me", text, createdAt: at });

describe("buildChatPreviews is insensitive to the map's key order", () => {
  // The regression: `Object.entries(messagesByChat)` yields AsyncStorage
  // rehydration order on a cold start and append order on a warm one, so the
  // chat list reordered itself across a reload with no data change.
  const chatA = "chat-me-alice";
  const chatB = "chat-bob-me";
  const byChat: Record<string, ChatMessage[]> = {
    [chatA]: [message("m1", chatA, "alice", AT(0), "from alice")],
    [chatB]: [message("m2", chatB, "bob", AT(0), "from bob")],
  };

  it("orders two chats whose last message shares a millisecond the same way either way round", () => {
    const forward = buildChatPreviews(byChat, "me").map((p) => p.chatId);
    const reversed = buildChatPreviews(
      { [chatB]: byChat[chatB], [chatA]: byChat[chatA] },
      "me",
    ).map((p) => p.chatId);
    assert.deepEqual(forward, reversed);
    // Byte order, not insertion order: "chat-bob-me" < "chat-me-alice".
    assert.deepEqual(forward, [chatB, chatA], "ties should fall back to the chat id, ascending");
  });

  it("still puts a genuinely newer chat first", () => {
    const previews = buildChatPreviews(
      {
        [chatA]: [message("m1", chatA, "alice", AT(0), "older")],
        [chatB]: [message("m2", chatB, "bob", AT(5000), "newer")],
      },
      "me",
    );
    assert.deepEqual(
      previews.map((p) => p.chatId),
      [chatB, chatA],
    );
  });

  it("picks the same lastMessage text when two messages share a millisecond", () => {
    // `lastMessage` is read off the end of the per-chat sort, so an unpinned
    // tie showed a different preview line on each device.
    const burst = [
      message("m-b", chatA, "alice", AT(1000), "second"),
      message("m-a", chatA, "alice", AT(1000), "first"),
    ];
    const forward = buildChatPreviews({ [chatA]: burst }, "me")[0];
    const reversed = buildChatPreviews({ [chatA]: [...burst].reverse() }, "me")[0];
    assert.equal(forward.lastMessage, reversed.lastMessage);
    assert.equal(forward.lastMessage, "second", "the higher id wins a same-ms tie");
  });
});

const item = (id: string, collectionId: string, createdAt: string): CollectableItem => ({
  id,
  collectionId,
  title: `Item ${id}`,
  acquiredAt: createdAt,
  acquiredFrom: "",
  description: "",
  variants: "",
  photos: [],
  createdBy: "Anton",
  createdByUserId: "user-1",
  createdAt,
});

const collection = (id: string): Collection => ({
  id,
  name: `Collection ${id}`,
  coverPhoto: "",
  description: "",
  ownerName: "Anton",
  ownerUserId: "user-1",
  sharedWith: [],
  sharedWithUserIds: [],
  role: "owner",
  visibility: "public",
});

describe("selectRecentItems cuts the same top-N from any input order", () => {
  it("keeps the boundary row stable when the whole batch shares a timestamp", () => {
    // A bulk import mints every row in one millisecond; the home screen shows
    // six. Which six must not depend on the merge order they arrived in.
    const owned = collection("c1");
    const rows = ["f", "b", "d", "a", "e", "c", "g", "h"].map((id) => item(id, "c1", AT(0)));
    const expected = selectRecentItems(rows, [owned], 4).map((i) => i.id);
    assert.deepEqual(expected, ["a", "b", "c", "d"]);
    for (const shuffled of permutations(rows)) {
      assert.deepEqual(selectRecentItems(shuffled, [owned], 4).map((i) => i.id), expected);
    }
  });
});

const listing = (id: string, over: Partial<MarketplaceListing> = {}): MarketplaceListing => ({
  id,
  itemId: `item-${id}`,
  ownerUserId: "seller",
  mode: "sell",
  askingPrice: 10,
  currency: "USD",
  notes: "",
  createdAt: AT(0),
  soldAt: AT(0),
  buyerUserId: "buyer",
  arrivedAt: null,
  ...over,
});

describe("recentlySoldListings cuts the same top-N from any input order", () => {
  it("decides the boundary slot by id rather than by cloud-delta order", () => {
    const rows = ["e", "c", "a", "d", "b"].map((id) => listing(id));
    const expected = recentlySoldListings(rows, 3).map((l) => l.id);
    assert.deepEqual(expected, ["a", "b", "c"]);
    for (const shuffled of permutations(rows)) {
      assert.deepEqual(recentlySoldListings(shuffled, 3).map((l) => l.id), expected);
    }
  });

  it("does not let the tiebreak outrank a genuinely more recent sale", () => {
    const rows = [listing("a", { soldAt: AT(0) }), listing("z", { soldAt: AT(9000) })];
    assert.deepEqual(recentlySoldListings(rows, 2).map((l) => l.id), ["z", "a"]);
  });
});

describe("priceHistoryForTitle cuts the same top-N from any input order", () => {
  const titles: Record<string, string> = {};
  const rows = ["d", "b", "e", "a", "c"].map((id) => {
    titles[`item-${id}`] = "Charizard Holo";
    return listing(id, { askingPrice: 100 });
  });
  const lookup = (itemId: string) => titles[itemId] ?? null;

  it("keeps the same price points when every listing shares a recordedAt", () => {
    const expected = priceHistoryForTitle("Charizard Holo", rows, lookup, { limit: 3 }).map(
      (e) => e.listingId,
    );
    assert.deepEqual(expected, ["a", "b", "c"]);
    for (const shuffled of permutations(rows)) {
      assert.deepEqual(
        priceHistoryForTitle("Charizard Holo", shuffled, lookup, { limit: 3 }).map(
          (e) => e.listingId,
        ),
        expected,
      );
    }
  });

  it("still orders a genuinely newer sale first", () => {
    const mixed = [listing("a", { soldAt: AT(0) }), listing("z", { soldAt: AT(9000) })];
    titles["item-z"] = "Charizard Holo";
    assert.deepEqual(
      priceHistoryForTitle("Charizard Holo", mixed, lookup).map((e) => e.listingId),
      ["z", "a"],
    );
  });
});

describe("no top-N surface sorts on a timestamp alone", () => {
  it("routes every `.slice(0, limit)` sort through a total order", () => {
    // The three limited surfaces are the ones where an unpinned tie is
    // user-visible rather than cosmetic. A fourth added later should join them.
    const cases: [string, RegExp][] = [
      ["lib/home-helpers.ts", /\.sort\(byCreatedAtDescThenId\)\s*\n\s*\.slice\(0, Math\.max\(0, limit\)\)/],
      ["lib/marketplace-helpers.ts", /\.sort\(bySoldAtDesc\)\s*\n\s*\.slice\(0, limit\)/],
    ];
    for (const [file, pattern] of cases) {
      assert.match(readRepoFile(file), pattern, `${file} lost its total-order top-N sort`);
    }
    // The price-history builder sorts and slices in two statements rather than
    // a chain, so it is matched on the tiebreak wrapper instead.
    assert.match(
      readRepoFile("lib/marketplace-helpers.ts"),
      /out\.sort\(\s*tieBreakById\(/,
      "priceHistoryForTitle should sort through tieBreakById",
    );
  });
});
