/**
 * Shared, framework-free pagination helpers for the Supabase REST (PostgREST)
 * list endpoints (BE-28). No react-native / auth imports so the `*-shapes`
 * modules can pull them in and tests can assert URL shape without mocking
 * `fetch`. Keeps the "no unbounded list endpoint" invariant in one place
 * instead of sprinkling `&limit=` literals across every URL builder.
 */

/**
 * Default page size applied to newest-first (`order=created_at.desc`) list
 * endpoints. Chosen well above any realistic per-user/per-collection row count
 * so the cap is a safety bound (no unbounded scan / payload) rather than a
 * functional limit. Actual multi-page keyset looping for collections that
 * legitimately exceed this is BE-28b.
 */
export const LIST_PAGE_SIZE = 200;

/**
 * Appends a PostgREST `limit=<n>` clause to an already-built list URL, bounding
 * the result set. Idempotent: a URL that already carries a `limit=` is returned
 * unchanged so callers (or a future keyset pager) can set their own page size
 * without it being double-appended. The `&` vs `?` separator is chosen from
 * whether the URL already has a query string.
 */
export function withPageLimit(url: string, limit: number = LIST_PAGE_SIZE): string {
  if (/[?&]limit=/.test(url)) return url;
  const safe = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : LIST_PAGE_SIZE;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}limit=${safe}`;
}

/**
 * Safety bound on how many keyset pages `collectKeysetPages` will fetch before
 * giving up, so a runaway loop (e.g. a server that ignores the cursor filter)
 * can never spin forever. `MAX_KEYSET_PAGES * LIST_PAGE_SIZE` is the effective
 * ceiling on rows a single keyset-paged read can return.
 */
export const MAX_KEYSET_PAGES = 50;

/**
 * Appends a keyset (cursor) filter for a newest-first (`order=<column>.desc`)
 * list endpoint: only rows whose `column` is `<=` the cursor come back, so the
 * next page resumes just below the previous page's last row. `lte` (not `lt`)
 * keeps rows that share the boundary timestamp — `collectKeysetPages` dedupes
 * the re-fetched boundary row by id — so a cluster of identical `created_at`
 * values can't drop rows across the page boundary. A null/empty cursor returns
 * the URL unchanged (first page). The cursor is percent-encoded so the
 * `+00:00` offset survives transit, mirroring `withUpdatedSince`.
 */
export function withKeysetBefore(
  url: string,
  cursor: string | null,
  column: string = "created_at",
): string {
  if (!cursor) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${column}=lte.${encodeURIComponent(cursor)}`;
}

/**
 * Drives a keyset-pagination loop over a newest-first list endpoint so a
 * collection / item set / marketplace larger than `LIST_PAGE_SIZE` is fully
 * fetched instead of silently truncated at the first page (BE-28b). `fetchPage`
 * receives the current cursor (null on the first page) and returns that page's
 * raw rows; the loop reads the next cursor off the last row via `getCursor`,
 * dedupes by `getId` (the `lte` boundary row reappears on the next page), and
 * stops when a page comes back short, when the cursor can't advance (an entire
 * page sharing one timestamp — bounded loss, never an infinite loop), or when
 * `MAX_KEYSET_PAGES` is hit. Order is preserved across pages.
 */
export async function collectKeysetPages<Row>(
  fetchPage: (cursor: string | null) => Promise<Row[]>,
  options: {
    getCursor: (row: Row) => string;
    getId: (row: Row) => string;
    pageSize?: number;
    maxPages?: number;
  },
): Promise<Row[]> {
  const pageSize = options.pageSize ?? LIST_PAGE_SIZE;
  const maxPages = options.maxPages ?? MAX_KEYSET_PAGES;
  const seen = new Set<string>();
  const out: Row[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const rows = await fetchPage(cursor);
    if (rows.length === 0) break;

    let nextCursor: string | null = null;
    for (const row of rows) {
      const id = options.getId(row);
      if (!seen.has(id)) {
        seen.add(id);
        out.push(row);
      }
      nextCursor = options.getCursor(row);
    }

    // A short page is the last page.
    if (rows.length < pageSize) break;
    // The cursor failed to advance (every row shared the boundary timestamp):
    // stop rather than re-issue the identical query forever.
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }

  return out;
}
