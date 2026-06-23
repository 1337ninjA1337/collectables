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
