import { Collection, CollectableItem, UserProfile } from "@/lib/types";
import { withPageLimit } from "@/lib/supabase-pagination";

/**
 * Pure URL/body/header builders for the Supabase REST API endpoints used by
 * `lib/supabase-profiles.ts`. Kept in a separate module (no react-native or
 * auth imports) so that tests can assert URL shape and request body without
 * mocking `fetch` or the Supabase auth client.
 */

/**
 * Appends a delta-pull filter to an already-built PostgREST URL (BE-14): only
 * rows with `updated_at` strictly greater than `cursor` come back. A null/empty
 * cursor returns the URL unchanged (first sync = full pull). The `&` vs `?`
 * separator is chosen from whether the URL already has a query string, and the
 * cursor is percent-encoded so the `+00:00` offset survives transit.
 */
export function withUpdatedSince(url: string, cursor: string | null): string {
  if (!cursor) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}updated_at=gt.${encodeURIComponent(cursor)}`;
}

/**
 * BE-28c — explicit column projections replacing the unbounded `select=*`.
 *
 * Each list is exactly the set of columns its row-coercer reads
 * (`coerce*Row` in `lib/supabase-row-coerce.ts`) plus the sync-metadata columns
 * the read paths depend on: `created_at` (keyset cursor), `updated_at` (delta
 * cursor via `maxUpdatedAt`), and `deleted_at` (tombstone filter /
 * `partitionByTombstone`). A narrow projection shrinks the payload (and the
 * free-tier egress) and makes schema drift loud: if the DB ever drops a column
 * the coercer needs, the read returns a missing field instead of `*` silently
 * masking the change.
 */
export const PROFILE_COLUMNS =
  "id,email,display_name,username,public_id,bio,avatar,display_currency,is_admin";

export const COLLECTION_COLUMNS =
  "id,name,cover_photo,description,owner_name,owner_user_id,sort_order,visibility,shared_with_user_ids,currency,created_at,updated_at,deleted_at";

export const ITEM_COLUMNS =
  "id,collection_id,title,acquired_at,acquired_from,description,variants,photos,created_by,created_by_user_id,created_at,cost,cost_currency,sort_order,is_wishlist,condition,tags,archived_at,updated_at,deleted_at";

/** Columns read by `coerceReactionRow` (the `reactions` table has no shapes module). */
export const REACTION_COLUMNS = "id,user_id,target_type,target_id,emoji,created_at";

/** Delta-pull URL for a user's own (non-wishlist) collections. */
export function ownCollectionsSinceUrl(
  baseUrl: string,
  userId: string,
  cursor: string | null,
): string {
  return withUpdatedSince(collectionsByUserUrl(baseUrl, userId), cursor);
}

/** Delta-pull URL for every item a user authored, across all collections. */
export function ownItemsSinceUrl(
  baseUrl: string,
  userId: string,
  cursor: string | null,
): string {
  const url = withPageLimit(
    `${baseUrl}/rest/v1/items?created_by_user_id=eq.${encodeURIComponent(userId)}&select=${ITEM_COLUMNS}&order=created_at.desc`,
  );
  return withUpdatedSince(url, cursor);
}

// --- Profiles ---

export function profilesUrl(baseUrl: string): string {
  return `${baseUrl}/rest/v1/profiles`;
}

export function profileByIdUrl(baseUrl: string, id: string): string {
  return `${baseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=${PROFILE_COLUMNS}`;
}

/** Row-filter URL (no select) for PATCHing the signed-in user's own profile. */
export function profileUpdateUrl(baseUrl: string, id: string): string {
  return `${baseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`;
}

export function profilesPageUrl(baseUrl: string, page: number, pageSize: number): string {
  const from = (page - 1) * pageSize;
  return `${baseUrl}/rest/v1/profiles?select=${PROFILE_COLUMNS}&order=created_at.desc&offset=${from}&limit=${pageSize}`;
}

export function profilesPageRangeHeader(page: number, pageSize: number): string {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  return `${from}-${to}`;
}

/**
 * Strips every character that carries meaning inside a PostgREST `or=(...)`
 * filter or an `ilike` pattern (commas/parens break the boolean tree; `%`,
 * `*` and `\` are wildcards; quotes end a quoted literal), plus a leading `@`
 * so users can paste an `@handle` verbatim. What's left is matched as a plain
 * substring.
 */
export function sanitizeProfileSearchQuery(query: string): string {
  return query.trim().replace(/^@/, "").replace(/[%*,()\\"']/g, "").trim();
}

/**
 * Server-side profile search: username OR display name contains the query
 * (case-insensitive). Search must hit the SERVER — the people browser only
 * holds one page client-side, so filtering that page silently missed every
 * profile beyond it (the "search finds nobody" bug).
 */
export function profilesSearchUrl(
  baseUrl: string,
  query: string,
  limit: number,
): string {
  const q = encodeURIComponent(`*${sanitizeProfileSearchQuery(query)}*`);
  return (
    `${baseUrl}/rest/v1/profiles?select=${PROFILE_COLUMNS}` +
    `&or=(username.ilike.${q},display_name.ilike.${q})` +
    `&order=created_at.desc&limit=${limit}`
  );
}

export function upsertProfileBody(profile: UserProfile): Record<string, unknown> {
  // `is_admin` is intentionally omitted: the column REVOKEs UPDATE from
  // authenticated/anon (see `20260616_core_tables_rls.sql`), so it is
  // server-authoritative — the client reads it via `toUserProfile` but must
  // never write it back, or the upsert would be rejected on the column grant.
  return {
    id: profile.id,
    email: profile.email,
    display_name: profile.displayName,
    username: profile.username,
    public_id: profile.publicId,
    bio: profile.bio,
    avatar: profile.avatar,
    display_currency: profile.displayCurrency ?? null,
  };
}

/** PATCH body that syncs only the user's app-wide display currency. */
export function updateProfileDisplayCurrencyBody(
  currency: string | null,
): Record<string, unknown> {
  return { display_currency: currency };
}

// --- Collections ---

export function collectionsUrl(baseUrl: string): string {
  return `${baseUrl}/rest/v1/collections`;
}

export function collectionByIdUrl(baseUrl: string, id: string): string {
  return `${baseUrl}/rest/v1/collections?id=eq.${encodeURIComponent(id)}&select=${COLLECTION_COLUMNS}`;
}

export function collectionsByUserUrl(baseUrl: string, userId: string): string {
  return withPageLimit(
    `${baseUrl}/rest/v1/collections?owner_user_id=eq.${encodeURIComponent(userId)}&name=neq.__wishlist__&select=${COLLECTION_COLUMNS}&order=created_at.desc`,
  );
}

export function publicCollectionsByUserUrl(baseUrl: string, userId: string): string {
  return withPageLimit(
    `${baseUrl}/rest/v1/collections?owner_user_id=eq.${encodeURIComponent(userId)}&visibility=eq.public&name=neq.__wishlist__&select=${COLLECTION_COLUMNS}&order=created_at.desc`,
  );
}

export function upsertCollectionBody(collection: Collection): Record<string, unknown> {
  return {
    id: collection.id,
    name: collection.name,
    cover_photo: collection.coverPhoto,
    description: collection.description,
    owner_name: collection.ownerName,
    owner_user_id: collection.ownerUserId,
    sort_order: collection.sortOrder ?? null,
    visibility: collection.visibility ?? "private",
    shared_with_user_ids: collection.sharedWithUserIds ?? [],
    currency: collection.currency ?? null,
  };
}

// --- Items ---

export function itemByIdUrl(baseUrl: string, id: string): string {
  return `${baseUrl}/rest/v1/items?id=eq.${encodeURIComponent(id)}&select=${ITEM_COLUMNS}`;
}

export function itemsByCollectionUrl(baseUrl: string, collectionId: string): string {
  return withPageLimit(
    `${baseUrl}/rest/v1/items?collection_id=eq.${encodeURIComponent(collectionId)}&select=${ITEM_COLUMNS}&order=created_at.desc`,
  );
}

export function upsertItemBody(item: CollectableItem, collectionId: string): Record<string, unknown> {
  return {
    id: item.id,
    collection_id: collectionId,
    title: item.title || "",
    acquired_at: item.acquiredAt || "",
    acquired_from: item.acquiredFrom || "",
    description: item.description || "",
    variants: item.variants || "",
    photos: item.photos ?? [],
    created_by: item.createdBy || "",
    created_by_user_id: item.createdByUserId || "",
    created_at: item.createdAt || new Date().toISOString(),
    cost: item.cost ?? null,
    cost_currency: item.costCurrency ?? null,
    sort_order: item.sortOrder ?? null,
    is_wishlist: item.isWishlist ?? false,
    condition: item.condition ?? null,
    tags: item.tags ?? null,
    archived_at: item.archivedAt ?? null,
  };
}

// --- Friend Requests ---

export function friendRequestsInsertUrl(baseUrl: string): string {
  return `${baseUrl}/rest/v1/friend_requests`;
}

export function friendRequestsUrl(baseUrl: string, userId: string): string {
  return `${baseUrl}/rest/v1/friend_requests?or=(from_user_id.eq.${encodeURIComponent(userId)},to_user_id.eq.${encodeURIComponent(userId)})&select=from_user_id,to_user_id`;
}

export function sendFriendRequestBody(fromUserId: string, toUserId: string): Record<string, string> {
  return { from_user_id: fromUserId, to_user_id: toUserId };
}

export function removeFriendRequestUrl(baseUrl: string, userA: string, userB: string): string {
  return (
    `${baseUrl}/rest/v1/friend_requests?or=(and(from_user_id.eq.${encodeURIComponent(userA)},to_user_id.eq.${encodeURIComponent(userB)}),and(from_user_id.eq.${encodeURIComponent(userB)},to_user_id.eq.${encodeURIComponent(userA)}))`
  );
}

// BE-21 — server-authoritative friend-request acceptance via Edge Function.
export function acceptFriendRequestUrl(baseUrl: string): string {
  return `${baseUrl}/functions/v1/accept-friend-request`;
}

export type AcceptFriendRequestPayload = {
  fromUserId: string;
};

export function acceptFriendRequestPayload(fromUserId: string): AcceptFriendRequestPayload {
  return { fromUserId };
}
