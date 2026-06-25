import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { fetchWithRetry } from "@/lib/fetch-retry";
import { MarketplaceListing } from "@/lib/types";
import {
  bodyOf,
  fakeTokenProvider,
  headersOf,
  loadChatWrappers,
  loadMarketplaceWrappers,
  makeRecordingFetcher,
  soleCall,
  TEST_ANON_KEY,
  TEST_SUPABASE_URL,
} from "./cloud-wrapper-harness";

/**
 * BE-35 — fake-`fetcher`/`tokenProvider` integration tests for every cloud
 * wrapper. Unlike the structural `supabase-*-wiring.test.ts` files, these load
 * the REAL wrappers (via `cloud-wrapper-harness.ts`'s native-peer stubbing) and
 * drive them with a recording fetcher + fixed token provider, asserting the
 * four contract dimensions the task calls out:
 *
 *   1. request shape    — URL, method, headers (apikey + Bearer token), body
 *   2. idempotency       — the `Prefer: resolution=…-duplicates` headers and
 *                          the client-generated `id` that make a retried flush
 *                          a server-side no-op instead of a 409
 *   3. retry             — the default `fetchWithRetry` clears a one-shot iOS
 *                          Safari `TypeError: Load failed` rejection
 *   4. error→requeue     — a non-ok response resolves to the wrapper's failure
 *                          sentinel (false/null/[]/{}) so the caller keeps the
 *                          mutation queued rather than dropping it
 */

const TOKEN = "user-access-token";
const BEARER = `Bearer ${TOKEN}`;

const market = loadMarketplaceWrappers();
const chat = loadChatWrappers();

function sampleListing(overrides: Partial<MarketplaceListing> = {}): MarketplaceListing {
  return {
    id: "listing-1",
    itemId: "item-1",
    ownerUserId: "owner-1",
    mode: "sell",
    askingPrice: 1200,
    currency: "EUR",
    notes: "mint",
    createdAt: "2026-06-25T10:00:00.000Z",
    soldAt: null,
    buyerUserId: null,
    arrivedAt: null,
    ...overrides,
  };
}

/** A row the marketplace coercer can round-trip back into a MarketplaceListing. */
function listingRow(listing: MarketplaceListing): Record<string, unknown> {
  return {
    id: listing.id,
    item_id: listing.itemId,
    owner_user_id: listing.ownerUserId,
    mode: listing.mode,
    asking_price: listing.askingPrice,
    currency: listing.currency,
    notes: listing.notes,
    created_at: listing.createdAt,
    sold_at: listing.soldAt,
    buyer_user_id: listing.buyerUserId,
    arrived_at: listing.arrivedAt,
  };
}

describe("BE-35 marketplace wrappers — request shape + idempotency headers", () => {
  it("cloudAddListing POSTs the insert payload with write headers", async () => {
    const { calls, fetcher } = makeRecordingFetcher({
      json: [listingRow(sampleListing())],
    });
    const result = await market.cloudAddListing(sampleListing(), {
      fetcher,
      tokenProvider: fakeTokenProvider(TOKEN),
    });

    const call = soleCall(calls);
    assert.equal(call.url, `${TEST_SUPABASE_URL}/rest/v1/marketplace_listings`);
    assert.equal(call.init.method, "POST");
    const headers = headersOf(call);
    assert.equal(headers.apikey, TEST_ANON_KEY);
    assert.equal(headers.Authorization, BEARER);
    // Write path requests the inserted row back so the client adopts the
    // server-authoritative shape.
    assert.match(headers.Prefer ?? "", /return=representation/);
    const body = bodyOf(call);
    assert.equal(body.id, "listing-1");
    assert.equal(body.item_id, "item-1");
    assert.equal(body.owner_user_id, "owner-1");
    // The client-supplied `id` IS the idempotency key — a retried insert of the
    // same listing is a PK conflict the server resolves, not a duplicate row.
    assert.ok(result);
    assert.equal(result?.id, "listing-1");
  });

  it("cloudMarkSold PATCHes the row by id and serialises buyer_user_id", async () => {
    const { calls, fetcher } = makeRecordingFetcher({ json: [] });
    const ok = await market.cloudMarkSold("listing-9", "2026-06-25T11:00:00.000Z", "buyer-7", {
      fetcher,
      tokenProvider: fakeTokenProvider(TOKEN),
    });

    const call = soleCall(calls);
    assert.ok(call.url.includes("/rest/v1/marketplace_listings"));
    assert.ok(call.url.includes("id=eq.listing-9"));
    assert.equal(call.init.method, "PATCH");
    assert.match(headersOf(call).Prefer ?? "", /return=representation/);
    const body = bodyOf(call);
    assert.equal(body.sold_at, "2026-06-25T11:00:00.000Z");
    assert.equal(body.buyer_user_id, "buyer-7");
    assert.equal(ok, true);
  });

  it("cloudRemoveListing DELETEs the row by id with read headers", async () => {
    const { calls, fetcher } = makeRecordingFetcher();
    const ok = await market.cloudRemoveListing("listing-3", {
      fetcher,
      tokenProvider: fakeTokenProvider(TOKEN),
    });

    const call = soleCall(calls);
    assert.ok(call.url.includes("id=eq.listing-3"));
    assert.equal(call.init.method, "DELETE");
    assert.equal(headersOf(call).Authorization, BEARER);
    assert.equal(ok, true);
  });

  it("cloudFetchListingById GETs the row by id", async () => {
    const listing = sampleListing({ id: "listing-42" });
    const { calls, fetcher } = makeRecordingFetcher({ json: [listingRow(listing)] });
    const result = await market.cloudFetchListingById("listing-42", {
      fetcher,
      tokenProvider: fakeTokenProvider(TOKEN),
    });

    const call = soleCall(calls);
    assert.ok(call.url.includes("id=eq.listing-42"));
    // GET — no method override.
    assert.ok(call.init.method === undefined || call.init.method === "GET");
    assert.equal(result?.id, "listing-42");
  });

  it("cloudFetchListings GETs the listings collection with the anon apikey", async () => {
    const { calls, fetcher } = makeRecordingFetcher({ json: [] });
    const result = await market.cloudFetchListings({
      fetcher,
      tokenProvider: fakeTokenProvider(TOKEN),
    });

    const call = soleCall(calls);
    assert.ok(call.url.includes("/rest/v1/marketplace_listings"));
    assert.equal(headersOf(call).apikey, TEST_ANON_KEY);
    assert.deepEqual(result, []);
  });

  it("cloudClaimListing POSTs {id} to the claim-listing Edge Function", async () => {
    const { calls, fetcher } = makeRecordingFetcher({ ok: true });
    const ok = await market.cloudClaimListing("listing-77", {
      fetcher,
      tokenProvider: fakeTokenProvider(TOKEN),
    });

    const call = soleCall(calls);
    assert.equal(call.url, `${TEST_SUPABASE_URL}/functions/v1/claim-listing`);
    assert.equal(call.init.method, "POST");
    assert.deepEqual(bodyOf(call), { id: "listing-77" });
    assert.equal(ok, true);
  });

  it("cloudClaimListing without a token short-circuits (no fetch fired)", async () => {
    const { calls, fetcher } = makeRecordingFetcher();
    const ok = await market.cloudClaimListing("listing-77", {
      fetcher,
      tokenProvider: fakeTokenProvider(null),
    });
    assert.equal(ok, false);
    assert.equal(calls.length, 0, "claim must not hit the network without a real user token");
  });
});

describe("BE-35 marketplace wrappers — error→requeue (non-ok response)", () => {
  it("cloudAddListing returns null so the caller re-queues", async () => {
    const { fetcher } = makeRecordingFetcher({ ok: false });
    const result = await market.cloudAddListing(sampleListing(), {
      fetcher,
      tokenProvider: fakeTokenProvider(TOKEN),
    });
    assert.equal(result, null);
  });

  it("cloudMarkSold returns false on a non-ok response", async () => {
    const { fetcher } = makeRecordingFetcher({ ok: false });
    const ok = await market.cloudMarkSold("l", "2026-06-25T00:00:00.000Z", null, {
      fetcher,
      tokenProvider: fakeTokenProvider(TOKEN),
    });
    assert.equal(ok, false);
  });

  it("cloudRemoveListing returns false on a non-ok response", async () => {
    const { fetcher } = makeRecordingFetcher({ ok: false });
    const ok = await market.cloudRemoveListing("l", {
      fetcher,
      tokenProvider: fakeTokenProvider(TOKEN),
    });
    assert.equal(ok, false);
  });

  it("cloudClaimListing swallows a fetcher throw and returns false", async () => {
    const throwingFetcher = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const ok = await market.cloudClaimListing("l", {
      fetcher: throwingFetcher,
      tokenProvider: fakeTokenProvider(TOKEN),
    });
    assert.equal(ok, false);
  });
});

describe("BE-35 chat wrappers — request shape + idempotency headers", () => {
  it("sendMessage POSTs the insert payload with the ignore-duplicates idempotency header", async () => {
    const input = {
      chatId: "chat-1",
      fromUserId: "u-a",
      toUserId: "u-b",
      text: "hi",
      id: "msg-1",
      createdAt: "2026-06-25T09:00:00.000Z",
    };
    const { calls, fetcher } = makeRecordingFetcher({
      json: [
        {
          id: "msg-1",
          chat_id: "chat-1",
          from_user_id: "u-a",
          to_user_id: "u-b",
          text: "hi",
          created_at: "2026-06-25T09:00:00.000Z",
        },
      ],
    });
    const result = await chat.sendMessage(input, {
      fetcher,
      tokenProvider: fakeTokenProvider(TOKEN),
    });

    const call = soleCall(calls);
    assert.equal(call.url, `${TEST_SUPABASE_URL}/rest/v1/chat_messages`);
    assert.equal(call.init.method, "POST");
    const headers = headersOf(call);
    assert.equal(headers.apikey, TEST_ANON_KEY);
    assert.equal(headers.Authorization, BEARER);
    // Idempotent INSERT: ON CONFLICT DO NOTHING on the PK so a retried flush of
    // an already-stored message is a no-op, never a 409 that wedges the queue.
    assert.match(headers.Prefer ?? "", /resolution=ignore-duplicates/);
    const body = bodyOf(call);
    // The client-generated `id` is the idempotency key carried in the body.
    assert.equal(body.id, "msg-1");
    assert.equal(body.chat_id, "chat-1");
    assert.equal(body.text, "hi");
    assert.equal(result?.id, "msg-1");
  });

  it("sendMessage on an empty (already-stored) body synthesizes from input — NOT a requeue", async () => {
    // resolution=ignore-duplicates returns an empty array when the row already
    // existed. The send still succeeded, so the wrapper must reconstruct the
    // message from the input (using its id) instead of returning null, which
    // would re-queue an already-delivered message forever.
    const input = {
      chatId: "chat-1",
      fromUserId: "u-a",
      toUserId: "u-b",
      text: "dup",
      id: "msg-dup",
    };
    const { fetcher } = makeRecordingFetcher({ ok: true, json: [] });
    const result = await chat.sendMessage(input, {
      fetcher,
      tokenProvider: fakeTokenProvider(TOKEN),
    });
    assert.ok(result, "an idempotent duplicate must resolve to the synthesized message");
    assert.equal(result?.id, "msg-dup");
    assert.equal(result?.text, "dup");
  });

  it("upsertChatRead POSTs with the merge-duplicates idempotency header", async () => {
    const { calls, fetcher } = makeRecordingFetcher();
    await chat.upsertChatRead("u-a", "chat-1", "2026-06-25T12:00:00.000Z", {
      fetcher,
      tokenProvider: fakeTokenProvider(TOKEN),
    });

    const call = soleCall(calls);
    assert.ok(call.url.includes("/rest/v1/chat_reads"));
    assert.equal(call.init.method, "POST");
    assert.match(headersOf(call).Prefer ?? "", /resolution=merge-duplicates/);
    const body = bodyOf(call);
    assert.deepEqual(body, {
      user_id: "u-a",
      chat_id: "chat-1",
      last_read_at: "2026-06-25T12:00:00.000Z",
    });
  });

  it("fetchMessagesForChat GETs newest-first and returns ascending messages", async () => {
    const { calls, fetcher } = makeRecordingFetcher({
      // Server returns desc (newest first); wrapper reverses to ascending.
      json: [
        { id: "m2", chat_id: "c", from_user_id: "a", to_user_id: "b", text: "second", created_at: "2026-06-25T09:02:00.000Z" },
        { id: "m1", chat_id: "c", from_user_id: "a", to_user_id: "b", text: "first", created_at: "2026-06-25T09:01:00.000Z" },
      ],
    });
    const messages = await chat.fetchMessagesForChat("chat-1", {
      fetcher,
      tokenProvider: fakeTokenProvider(TOKEN),
    });

    const call = soleCall(calls);
    assert.ok(call.url.includes("chat_id=eq.chat-1"));
    assert.ok(call.url.includes("order=created_at.desc"));
    assert.deepEqual(
      messages.map((m) => m.id),
      ["m1", "m2"],
      "messages must be returned oldest→newest regardless of the desc wire order",
    );
  });

  it("fetchChatReads GETs the user's reads and folds them into a record", async () => {
    const { calls, fetcher } = makeRecordingFetcher({
      json: [
        { chat_id: "c1", last_read_at: "2026-06-25T08:00:00.000Z" },
        { chat_id: "c2", last_read_at: "2026-06-25T08:30:00.000Z" },
      ],
    });
    const reads = await chat.fetchChatReads("u-a", {
      fetcher,
      tokenProvider: fakeTokenProvider(TOKEN),
    });

    const call = soleCall(calls);
    assert.ok(call.url.includes("user_id=eq.u-a"));
    assert.deepEqual(reads, {
      c1: "2026-06-25T08:00:00.000Z",
      c2: "2026-06-25T08:30:00.000Z",
    });
  });

  it("isMutualFriend fires both directional friend checks and ANDs them", async () => {
    const { calls, fetcher } = makeRecordingFetcher({ json: [{ id: "fr" }] });
    const mutual = await chat.isMutualFriend("u-a", "u-b", {
      fetcher,
      tokenProvider: fakeTokenProvider(TOKEN),
    });
    assert.equal(calls.length, 2, "a mutual-friend check is two directional reads");
    assert.equal(mutual, true);
  });
});

describe("BE-35 chat wrappers — error→requeue (non-ok response)", () => {
  it("sendMessage returns null on a non-ok response", async () => {
    const { fetcher } = makeRecordingFetcher({ ok: false });
    const result = await chat.sendMessage(
      { chatId: "c", fromUserId: "a", toUserId: "b", text: "x", id: "m" },
      { fetcher, tokenProvider: fakeTokenProvider(TOKEN) },
    );
    assert.equal(result, null);
  });

  it("fetchMessagesForChat returns [] on a non-ok response", async () => {
    const { fetcher } = makeRecordingFetcher({ ok: false });
    const messages = await chat.fetchMessagesForChat("c", {
      fetcher,
      tokenProvider: fakeTokenProvider(TOKEN),
    });
    assert.deepEqual(messages, []);
  });

  it("fetchChatReads returns {} on a non-ok response", async () => {
    const { fetcher } = makeRecordingFetcher({ ok: false });
    const reads = await chat.fetchChatReads("u-a", {
      fetcher,
      tokenProvider: fakeTokenProvider(TOKEN),
    });
    assert.deepEqual(reads, {});
  });

  it("isMutualFriend returns false when either directional check is non-ok", async () => {
    const { fetcher } = makeRecordingFetcher({ ok: false });
    const mutual = await chat.isMutualFriend("u-a", "u-b", {
      fetcher,
      tokenProvider: fakeTokenProvider(TOKEN),
    });
    assert.equal(mutual, false);
  });
});

describe("BE-35 cloud wrappers — retry (fetchWithRetry clears a one-shot Safari Load failed)", () => {
  // The chat wrappers default `fetcher` to `fetchWithRetry`. We can't reach the
  // default through dependency injection, so we reproduce it exactly: a fetcher
  // that runs the real `fetchWithRetry` around a flaky inner fetch that rejects
  // once with the iOS-Safari `TypeError: Load failed` then succeeds. This pins
  // the retry contract the wrappers rely on for resilience.
  function flakyRetryingFetcher(json: unknown): { inner: { calls: number }; fetcher: typeof fetch } {
    const inner = { calls: 0 };
    const innerFetch = (async () => {
      inner.calls += 1;
      if (inner.calls === 1) {
        throw new TypeError("Load failed");
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return json;
        },
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const fetcher = ((url: RequestInfo | URL, init?: RequestInit) =>
      fetchWithRetry(url, init, { fetcher: innerFetch, delayMs: 0 })) as unknown as typeof fetch;
    return { inner, fetcher };
  }

  it("fetchMessagesForChat succeeds after a one-shot Load failed rejection", async () => {
    const { inner, fetcher } = flakyRetryingFetcher([
      { id: "m1", chat_id: "c", from_user_id: "a", to_user_id: "b", text: "hi", created_at: "2026-06-25T09:00:00.000Z" },
    ]);
    const messages = await chat.fetchMessagesForChat("chat-1", {
      fetcher,
      tokenProvider: fakeTokenProvider(TOKEN),
    });
    assert.equal(inner.calls, 2, "the inner fetch should have been retried exactly once");
    assert.deepEqual(messages.map((m) => m.id), ["m1"]);
  });

  it("sendMessage succeeds after a one-shot Load failed rejection", async () => {
    const { inner, fetcher } = flakyRetryingFetcher([
      { id: "m1", chat_id: "c", from_user_id: "a", to_user_id: "b", text: "hi", created_at: "2026-06-25T09:00:00.000Z" },
    ]);
    const result = await chat.sendMessage(
      { chatId: "c", fromUserId: "a", toUserId: "b", text: "hi", id: "m1" },
      { fetcher, tokenProvider: fakeTokenProvider(TOKEN) },
    );
    assert.equal(inner.calls, 2);
    assert.equal(result?.id, "m1");
  });
});
