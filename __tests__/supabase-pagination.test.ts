import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  LIST_PAGE_SIZE,
  MAX_KEYSET_PAGES,
  collectKeysetPages,
  withKeysetBefore,
  withPageLimit,
} from "@/lib/supabase-pagination";
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

describe("withKeysetBefore", () => {
  it("returns the URL unchanged for a null/empty cursor (first page)", () => {
    const url = `${BASE}/rest/v1/items?select=*&limit=200`;
    assert.equal(withKeysetBefore(url, null), url);
    assert.equal(withKeysetBefore(url, ""), url);
  });

  it("appends a created_at lte (inclusive) keyset filter on later pages", () => {
    assert.equal(
      withKeysetBefore(`${BASE}/rest/v1/items?select=*`, "2026-06-19T00:00:00+00:00"),
      `${BASE}/rest/v1/items?select=*&created_at=lte.2026-06-19T00%3A00%3A00%2B00%3A00`,
    );
  });

  it("uses ? when the URL has no query string and honours a custom column", () => {
    assert.equal(withKeysetBefore(`${BASE}/x`, "2026", "id"), `${BASE}/x?id=lte.2026`);
  });
});

describe("collectKeysetPages — keyset pagination loop (BE-28b)", () => {
  type Row = { id: string; created_at: string };
  const opts = { getCursor: (r: Row) => r.created_at, getId: (r: Row) => r.id };

  const makeRows = (n: number, start = 0): Row[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `r${start + i}`,
      // descending timestamps so each page's last row is the oldest seen
      created_at: `2026-06-${String(100 - (start + i)).padStart(3, "0")}`,
    }));

  it("returns a single short page without asking for more", async () => {
    const calls: (string | null)[] = [];
    const out = await collectKeysetPages<Row>(
      async (cursor) => {
        calls.push(cursor);
        return makeRows(3);
      },
      { ...opts, pageSize: 200 },
    );
    assert.equal(out.length, 3);
    assert.deepEqual(calls, [null]); // only the first page was fetched
  });

  it("loops across full pages until a short page, deduping the lte boundary row", async () => {
    const pageSize = 2;
    const pages: Row[][] = [
      [{ id: "a", created_at: "t3" }, { id: "b", created_at: "t2" }],
      // lte boundary re-fetches "b"; the loop dedupes it by id
      [{ id: "b", created_at: "t2" }, { id: "c", created_at: "t1" }],
      [{ id: "c", created_at: "t1" }], // short page → stop
    ];
    let page = 0;
    const cursors: (string | null)[] = [];
    const out = await collectKeysetPages<Row>(
      async (cursor) => {
        cursors.push(cursor);
        return pages[page++];
      },
      { ...opts, pageSize },
    );
    assert.deepEqual(out.map((r) => r.id), ["a", "b", "c"]);
    assert.deepEqual(cursors, [null, "t2", "t1"]);
  });

  it("stops when the cursor can't advance (a full page of identical timestamps)", async () => {
    const pageSize = 2;
    let page = 0;
    const out = await collectKeysetPages<Row>(
      async () => {
        page++;
        // always a full page sharing one timestamp → cursor never moves
        return [
          { id: `x${page}a`, created_at: "same" },
          { id: `x${page}b`, created_at: "same" },
        ];
      },
      { ...opts, pageSize },
    );
    // first page advances off the null cursor; the second page's cursor matches
    // the first, so the loop halts there rather than spinning forever
    assert.equal(out.length, 4);
    assert.equal(page, 2);
  });

  it("never exceeds MAX_KEYSET_PAGES even with strictly advancing cursors", async () => {
    let page = 0;
    await collectKeysetPages<Row>(
      async () => {
        const rows = makeRows(2, page * 2); // always full, ever-advancing
        page++;
        return rows;
      },
      { ...opts, pageSize: 2, maxPages: 5 },
    );
    assert.equal(page, 5);
  });

  it("stops immediately on an empty first page", async () => {
    let page = 0;
    const out = await collectKeysetPages<Row>(async () => {
      page++;
      return [];
    }, opts);
    assert.equal(out.length, 0);
    assert.equal(page, 1);
  });

  it("exposes a sane MAX_KEYSET_PAGES ceiling", () => {
    assert.ok(Number.isInteger(MAX_KEYSET_PAGES));
    assert.ok(MAX_KEYSET_PAGES > 0 && MAX_KEYSET_PAGES <= 1000);
  });
});
