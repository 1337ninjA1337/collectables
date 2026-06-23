import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { LIST_PAGE_SIZE, withPageLimit } from "@/lib/supabase-pagination";
import {
  collectionsByUserUrl,
  publicCollectionsByUserUrl,
  itemsByCollectionUrl,
  ownItemsSinceUrl,
  ownCollectionsSinceUrl,
} from "@/lib/supabase-profiles-shapes";
import { fetchListingsUrl } from "@/lib/supabase-marketplace-shapes";

const BASE = "https://demo.supabase.co";

describe("withPageLimit", () => {
  it("appends limit with & when the URL already has a query string", () => {
    assert.equal(
      withPageLimit(`${BASE}/rest/v1/items?select=*`),
      `${BASE}/rest/v1/items?select=*&limit=${LIST_PAGE_SIZE}`,
    );
  });

  it("appends limit with ? when the URL has no query string", () => {
    assert.equal(
      withPageLimit(`${BASE}/rest/v1/items`),
      `${BASE}/rest/v1/items?limit=${LIST_PAGE_SIZE}`,
    );
  });

  it("honours an explicit page size", () => {
    assert.equal(withPageLimit(`${BASE}/rest/v1/items?select=*`, 25), `${BASE}/rest/v1/items?select=*&limit=25`);
  });

  it("floors a fractional limit", () => {
    assert.equal(withPageLimit(`${BASE}/x?a=1`, 10.9), `${BASE}/x?a=1&limit=10`);
  });

  it("falls back to LIST_PAGE_SIZE for a non-positive / non-finite limit", () => {
    assert.equal(withPageLimit(`${BASE}/x?a=1`, 0), `${BASE}/x?a=1&limit=${LIST_PAGE_SIZE}`);
    assert.equal(withPageLimit(`${BASE}/x?a=1`, -5), `${BASE}/x?a=1&limit=${LIST_PAGE_SIZE}`);
    assert.equal(withPageLimit(`${BASE}/x?a=1`, Number.NaN), `${BASE}/x?a=1&limit=${LIST_PAGE_SIZE}`);
  });

  it("is idempotent — never double-appends a limit clause", () => {
    const once = withPageLimit(`${BASE}/rest/v1/items?select=*`);
    assert.equal(withPageLimit(once), once);
    // also leaves a caller-supplied limit untouched
    assert.equal(withPageLimit(`${BASE}/x?limit=50`), `${BASE}/x?limit=50`);
    assert.equal(withPageLimit(`${BASE}/x?limit=50`, 200), `${BASE}/x?limit=50`);
  });

  it("uses a safe, bounded default page size", () => {
    assert.ok(Number.isInteger(LIST_PAGE_SIZE));
    assert.ok(LIST_PAGE_SIZE > 0 && LIST_PAGE_SIZE <= 1000);
  });
});

describe("BE-28a — every newest-first list endpoint is bounded", () => {
  const cap = `limit=${LIST_PAGE_SIZE}`;

  it("collectionsByUserUrl carries a limit", () => {
    assert.match(collectionsByUserUrl(BASE, "u1"), new RegExp(cap));
  });

  it("publicCollectionsByUserUrl carries a limit", () => {
    assert.match(publicCollectionsByUserUrl(BASE, "u1"), new RegExp(cap));
  });

  it("itemsByCollectionUrl carries a limit", () => {
    assert.match(itemsByCollectionUrl(BASE, "c1"), new RegExp(cap));
  });

  it("fetchListingsUrl (marketplace) carries a limit", () => {
    assert.match(fetchListingsUrl(BASE), new RegExp(cap));
  });

  it("ownItemsSinceUrl is bounded for both a full and a delta pull", () => {
    assert.match(ownItemsSinceUrl(BASE, "u1", null), new RegExp(cap));
    const delta = ownItemsSinceUrl(BASE, "u1", "2026-06-19T00:00:00Z");
    assert.match(delta, new RegExp(cap));
    assert.match(delta, /updated_at=gt\./);
  });

  it("ownCollectionsSinceUrl inherits the collections-list limit", () => {
    assert.match(ownCollectionsSinceUrl(BASE, "u1", null), new RegExp(cap));
    assert.match(ownCollectionsSinceUrl(BASE, "u1", "2026-06-19T00:00:00Z"), new RegExp(cap));
  });
});
