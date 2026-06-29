import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildMarketplaceReadHeaders,
  buildMarketplaceWriteHeaders,
  buildMarkSoldPayload,
  claimListingPayload,
  claimListingUrl,
  deleteListingUrl,
  fetchListingsUrl,
  fetchListingByIdUrl,
  insertListingUrl,
  listingToInsertPayload,
  markReceivedPayload,
  markReceivedUrl,
  markSoldPayload,
  markSoldUrl,
  rowToListing,
  MARKETPLACE_COLUMNS,
} from "@/lib/supabase-marketplace-shapes";
import { MarketplaceListing } from "@/lib/types";

const BASE = "https://xyz.supabase.co";

const row = {
  id: "l-abc",
  item_id: "item-1",
  owner_user_id: "user-1",
  mode: "sell" as const,
  asking_price: 99.99,
  currency: "USD",
  notes: "mint condition",
  created_at: "2026-05-01T10:00:00.000Z",
  sold_at: null,
  buyer_user_id: null,
};

const listing: MarketplaceListing = {
  id: "l-abc",
  itemId: "item-1",
  ownerUserId: "user-1",
  mode: "sell",
  askingPrice: 99.99,
  currency: "USD",
  notes: "mint condition",
  createdAt: "2026-05-01T10:00:00.000Z",
  soldAt: null,
  buyerUserId: null,
  arrivedAt: null,
};

describe("supabase-marketplace-shapes", () => {
  it("rowToListing converts snake_case to camelCase", () => {
    const result = rowToListing(row);
    assert.equal(result.id, "l-abc");
    assert.equal(result.itemId, "item-1");
    assert.equal(result.ownerUserId, "user-1");
    assert.equal(result.mode, "sell");
    assert.equal(result.askingPrice, 99.99);
    assert.equal(result.currency, "USD");
    assert.equal(result.notes, "mint condition");
    assert.equal(result.soldAt, null);
    assert.equal(result.buyerUserId, null);
  });

  it("rowToListing maps buyer_user_id to buyerUserId", () => {
    const result = rowToListing({ ...row, buyer_user_id: "buyer-9" });
    assert.equal(result.buyerUserId, "buyer-9");
  });

  it("rowToListing defaults buyerUserId to null when row omits buyer_user_id", () => {
    const result = rowToListing({ ...row });
    assert.equal(result.buyerUserId, null);
  });

  it("rowToListing maps arrived_at to arrivedAt and defaults to null when omitted", () => {
    assert.equal(rowToListing({ ...row }).arrivedAt, null);
    assert.equal(
      rowToListing({ ...row, arrived_at: "2026-05-09T10:00:00.000Z" }).arrivedAt,
      "2026-05-09T10:00:00.000Z",
    );
  });

  it("markSoldPayload bundles sold_at and buyer_user_id", () => {
    const payload = markSoldPayload("2026-05-07T10:00:00.000Z", "buyer-7");
    assert.equal(payload.sold_at, "2026-05-07T10:00:00.000Z");
    assert.equal(payload.buyer_user_id, "buyer-7");
  });

  it("markSoldPayload accepts null buyer for legacy 'mark sold without buyer' path", () => {
    const payload = markSoldPayload("2026-05-07T10:00:00.000Z", null);
    assert.equal(payload.buyer_user_id, null);
  });

  it("listingToInsertPayload converts camelCase to snake_case", () => {
    const payload = listingToInsertPayload(listing);
    assert.equal(payload.id, "l-abc");
    assert.equal(payload.item_id, "item-1");
    assert.equal(payload.owner_user_id, "user-1");
    assert.equal(payload.mode, "sell");
    assert.equal(payload.asking_price, 99.99);
    assert.equal(payload.currency, "USD");
    assert.equal(payload.notes, "mint condition");
  });

  it("fetchListingsUrl builds correct URL", () => {
    const url = fetchListingsUrl(BASE);
    assert.ok(url.startsWith(`${BASE}/rest/v1/marketplace_listings`));
    assert.ok(url.includes(`select=${MARKETPLACE_COLUMNS}`));
    assert.ok(url.includes("order=created_at.desc"));
  });

  it("fetchListingByIdUrl includes id filter", () => {
    const url = fetchListingByIdUrl(BASE, "l-abc");
    assert.ok(url.includes("id=eq.l-abc"));
    assert.ok(url.includes(`select=${MARKETPLACE_COLUMNS}`));
  });

  it("MARKETPLACE_COLUMNS covers exactly the fields rowToListing reads", () => {
    const row = {
      id: "l1",
      item_id: "i1",
      owner_user_id: "u1",
      mode: "sell" as const,
      asking_price: 5,
      currency: "USD",
      notes: "n",
      created_at: "2026-01-01T00:00:00Z",
      sold_at: null,
      buyer_user_id: null,
      arrived_at: null,
    };
    const cols = MARKETPLACE_COLUMNS.split(",");
    for (const key of Object.keys(row)) {
      assert.ok(cols.includes(key), `missing column ${key}`);
    }
    assert.ok(!MARKETPLACE_COLUMNS.includes("*"));
  });

  it("insertListingUrl points to table root", () => {
    assert.equal(insertListingUrl(BASE), `${BASE}/rest/v1/marketplace_listings`);
  });

  it("deleteListingUrl includes id filter", () => {
    const url = deleteListingUrl(BASE, "l-abc");
    assert.ok(url.includes("id=eq.l-abc"));
  });

  it("markSoldUrl includes id filter", () => {
    const url = markSoldUrl(BASE, "l-abc");
    assert.ok(url.includes("id=eq.l-abc"));
  });

  it("markReceivedPayload carries only the arrived_at timestamp", () => {
    const payload = markReceivedPayload("2026-05-09T10:00:00.000Z");
    assert.deepEqual(payload, { arrived_at: "2026-05-09T10:00:00.000Z" });
  });

  it("markReceivedUrl targets the listing row by id", () => {
    const url = markReceivedUrl(BASE, "l-abc");
    assert.ok(url.startsWith(`${BASE}/rest/v1/marketplace_listings`));
    assert.ok(url.includes("id=eq.l-abc"));
  });

  it("markReceivedUrl percent-encodes the id", () => {
    const url = markReceivedUrl(BASE, "a/b c");
    assert.ok(url.includes("id=eq.a%2Fb%20c"));
  });

  it("buildMarketplaceReadHeaders includes apikey and Authorization", () => {
    const h = buildMarketplaceReadHeaders("key123", "tok456");
    assert.equal(h.apikey, "key123");
    assert.ok(h.Authorization.includes("tok456"));
  });

  it("buildMarketplaceWriteHeaders adds Prefer header", () => {
    const h = buildMarketplaceWriteHeaders("key123", null);
    assert.ok("Prefer" in h);
    assert.ok(h.Prefer.includes("return=representation"));
  });

  it("buildMarketplaceReadHeaders falls back to apikey when token is null", () => {
    const h = buildMarketplaceReadHeaders("key123", null);
    assert.ok(h.Authorization.includes("key123"));
  });

  it("rowToListing maps buyer_user_id to buyerUserId", () => {
    const result = rowToListing({ ...row, buyer_user_id: "buyer-42" });
    assert.equal(result.buyerUserId, "buyer-42");
  });

  it("rowToListing defaults buyerUserId to null when buyer_user_id is missing", () => {
    const result = rowToListing(row);
    assert.equal(result.buyerUserId, null);
  });

  it("buildMarkSoldPayload includes both sold_at and buyer_user_id", () => {
    const payload = buildMarkSoldPayload("2026-05-07T00:00:00.000Z", "buyer-42");
    assert.equal(payload.sold_at, "2026-05-07T00:00:00.000Z");
    assert.equal(payload.buyer_user_id, "buyer-42");
  });

  it("buildMarkSoldPayload allows null buyer for legacy 'just mark sold'", () => {
    const payload = buildMarkSoldPayload("2026-05-07T00:00:00.000Z", null);
    assert.equal(payload.buyer_user_id, null);
  });

  it("claimListingUrl points to the claim-listing Edge Function (BE-20)", () => {
    assert.equal(claimListingUrl(BASE), `${BASE}/functions/v1/claim-listing`);
  });

  it("claimListingPayload bundles only the listing id", () => {
    const payload = claimListingPayload("l-abc");
    assert.deepEqual(payload, { id: "l-abc" });
  });
});
