import { captureException } from "@/lib/sentry";
import { fetchWithRetry } from "@/lib/fetch-retry";
import {
  authClient,
  isSupabaseConfigured,
  supabasePublishableKey,
  supabaseUrl,
} from "@/lib/supabase";
import {
  acceptFriendRequestPayload,
  acceptFriendRequestUrl,
  collectionByIdUrl,
  collectionsUrl,
  collectionsByUserUrl,
  friendRequestsInsertUrl,
  friendRequestsUrl,
  profileByIdUrl,
  profileUpdateUrl,
  profilesPageRangeHeader,
  profilesPageUrl,
  profilesUrl,
  publicCollectionsByUserUrl,
  removeFriendRequestUrl,
  sendFriendRequestBody,
  updateProfileDisplayCurrencyBody,
  upsertCollectionBody,
  upsertProfileBody,
  ownCollectionsSinceUrl,
  ownItemsSinceUrl,
} from "@/lib/supabase-profiles-shapes";
import { collectKeysetPages, withKeysetBefore, withPageLimit } from "@/lib/supabase-pagination";
import { maxUpdatedAt } from "@/lib/sync-cursors";
import { partitionByTombstone } from "@/lib/tombstones";
import {
  coerceCollectionRow,
  coerceItemRow,
  coerceProfileRow,
  coerceReactionRow,
  coerceString,
} from "@/lib/supabase-row-coerce";
import { CollectableItem, Collection, Reaction, ReactionEmoji, ReactionTargetType, UserProfile } from "@/lib/types";

const supabaseKey = supabasePublishableKey;

const HIDDEN_USERNAMES = ["katsyarinafedorova97"];// remove later

type DbProfile = {
  id: string;
  email: string;
  display_name: string;
  username: string;
  public_id: string;
  bio: string;
  avatar: string;
  display_currency?: string | null;
  is_admin?: boolean | null;
};

function isHiddenProfile(row: DbProfile): boolean {
  return HIDDEN_USERNAMES.includes(coerceString(row.username).toLowerCase());
}

function toUserProfile(row: DbProfile): UserProfile {
  return coerceProfileRow(row);
}

async function getAccessToken(): Promise<string | null> {
  if (!authClient) return null;
  const { data } = await authClient.getSession();
  return data.session?.access_token ?? null;
}

async function supabaseRest(
  pathOrUrl: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
) {
  const url = pathOrUrl.startsWith("http")
    ? pathOrUrl
    : `${supabaseUrl}/rest/v1${pathOrUrl}`;
  const token = await getAccessToken();
  const method = options.method ?? "GET";
  // Build headers minimally. Sending `Content-Type` on a body-less GET and
  // sending an empty `Prefer: ""` both expand the CORS preflight surface; iOS
  // Safari 18 rejects the preflight more often than it should, surfacing as
  // `TypeError: Load failed` for every Supabase call on the page.
  const headers: Record<string, string> = {
    apikey: supabaseKey,
    Authorization: `Bearer ${token ?? supabaseKey}`,
    ...options.headers,
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
  }
  if (method === "POST") {
    headers["Prefer"] = headers["Prefer"] ?? "resolution=merge-duplicates,return=minimal";
  }
  return fetchWithRetry(url, { method, headers, body: options.body });
}

/** Upsert the current user's profile into the profiles table. */
export async function upsertMyProfile(profile: UserProfile): Promise<void> {
  if (!isSupabaseConfigured) return;

  await supabaseRest(profilesUrl(supabaseUrl!), {
    method: "POST",
    body: JSON.stringify(upsertProfileBody(profile)),
  });
}

/**
 * Sync the signed-in user's app-wide display currency onto their profile row
 * so the preference follows them across devices. Best-effort: a network/RLS
 * failure leaves the device-local AsyncStorage value as the fallback.
 */
export async function updateMyProfileDisplayCurrency(
  userId: string,
  currency: string | null,
): Promise<void> {
  if (!isSupabaseConfigured) return;

  await supabaseRest(profileUpdateUrl(supabaseUrl!, userId), {
    method: "PATCH",
    body: JSON.stringify(updateProfileDisplayCurrencyBody(currency)),
  });
}

/** Fetch a single profile by ID. */
export async function fetchProfileById(id: string): Promise<UserProfile | null> {
  if (!isSupabaseConfigured) return null;

  const res = await supabaseRest(profileByIdUrl(supabaseUrl!, id));
  const rows: DbProfile[] = await res.json();
  if (rows.length === 0 || isHiddenProfile(rows[0])) return null;
  return toUserProfile(rows[0]);
}

/** Fetch a page of profiles. Returns { data, totalCount }. */
export async function fetchProfiles(
  page: number,
  pageSize: number,
): Promise<{ data: UserProfile[]; totalCount: number }> {
  if (!isSupabaseConfigured) return { data: [], totalCount: 0 };

  const res = await supabaseRest(profilesPageUrl(supabaseUrl!, page, pageSize), {
    headers: {
      Range: profilesPageRangeHeader(page, pageSize),
      Prefer: "count=exact",
    },
  });

  const totalCount = parseInt(res.headers.get("content-range")?.split("/")?.[1] ?? "0", 10);
  const rows: DbProfile[] = await res.json();
  const filtered = rows.filter((r) => !isHiddenProfile(r));

  return { data: filtered.map(toUserProfile), totalCount: totalCount - (rows.length - filtered.length) };
}

// --- Collections ---

type DbCollection = {
  id: string;
  name: string;
  cover_photo: string;
  description: string;
  owner_name: string;
  owner_user_id: string;
  sort_order?: number | null;
  visibility?: string | null;
  shared_with_user_ids?: string[] | null;
  currency?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
};

function toCollection(row: DbCollection): Collection {
  return coerceCollectionRow(row);
}

/** Upsert a collection to Supabase. */
export async function upsertCollection(collection: Collection): Promise<void> {
  if (!isSupabaseConfigured) return;

  await supabaseRest(collectionsUrl(supabaseUrl!), {
    method: "POST",
    body: JSON.stringify(upsertCollectionBody(collection)),
  });
}

export async function updateRemoteCollection(id: string, updates: Partial<Collection>): Promise<void> {
  if (!isSupabaseConfigured) return;

  const body: Record<string, unknown> = {};
  if ("name" in updates) body.name = updates.name;
  if ("description" in updates) body.description = updates.description;
  if ("coverPhoto" in updates) body.cover_photo = updates.coverPhoto;
  if ("ownerName" in updates) body.owner_name = updates.ownerName;
  if ("sortOrder" in updates) body.sort_order = updates.sortOrder ?? null;
  if ("visibility" in updates) body.visibility = updates.visibility;
  if ("sharedWithUserIds" in updates) body.shared_with_user_ids = updates.sharedWithUserIds ?? [];
  if ("currency" in updates) body.currency = updates.currency ?? null;

  if (Object.keys(body).length === 0) return;

  await supabaseRest(`/collections?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

/**
 * Soft-delete a collection (BE-15b): stamp `deleted_at` instead of a hard
 * `DELETE`. A delta pull can only observe rows that still exist, so a tombstone
 * is the only delete a peer can ever sync; the BE-9 moddatetime trigger bumps
 * `updated_at` on this PATCH so the tombstone rides the normal delta pull.
 */
export async function softDeleteRemoteCollection(id: string): Promise<void> {
  if (!isSupabaseConfigured) return;

  await supabaseRest(`/collections?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ deleted_at: new Date().toISOString() }),
  });
}

/** Fetch a single collection by ID. */
export async function fetchCollectionById(id: string): Promise<Collection | null> {
  if (!isSupabaseConfigured) return null;

  const res = await supabaseRest(collectionByIdUrl(supabaseUrl!, id));
  const rows: DbCollection[] = await res.json();
  return rows.length > 0 ? toCollection(rows[0]) : null;
}

/**
 * Coerce a Supabase row's keyset cursor: the `created_at` we page on. Rows
 * always carry it (NOT NULL in the schema), but the optional type guards
 * against a malformed payload so the loop can't keyset on `undefined`.
 */
function rowCreatedAt(row: { created_at?: string | null }): string {
  return row.created_at ?? "";
}

/**
 * Fetch a page of `DbCollection` rows from a newest-first URL with the keyset
 * cursor applied. A non-OK response yields an empty page so the loop stops
 * cleanly instead of throwing mid-pagination.
 */
async function fetchCollectionsPage(url: string, cursor: string | null): Promise<DbCollection[]> {
  const res = await supabaseRest(withKeysetBefore(url, cursor));
  if (!res.ok) return [];
  return res.json();
}

/** Fetch collections for a specific user. */
export async function fetchCollectionsByUserId(userId: string): Promise<Collection[]> {
  if (!isSupabaseConfigured) return [];

  const url = collectionsByUserUrl(supabaseUrl!, userId);
  // BE-28b: keyset-loop past LIST_PAGE_SIZE so a user with hundreds of
  // collections doesn't silently lose everything past the first page.
  const rows = await collectKeysetPages<DbCollection>((cursor) => fetchCollectionsPage(url, cursor), {
    getCursor: rowCreatedAt,
    getId: (row) => row.id,
  });
  // Drop soft-deleted rows so a cache-empty bootstrap can't resurrect a
  // collection the user deleted on another device (BE-15b).
  return rows.filter((row) => !row.deleted_at).map(toCollection);
}

/**
 * Delta pull (BE-14) of a user's own collections: only rows whose `updated_at`
 * is newer than `since` come back, so a warm `refreshTick` no longer refetches
 * the whole table. Returns the rows plus the advanced cursor (the max
 * `updated_at` seen, or `since` unchanged when the delta was empty) for the
 * caller to persist. A null `since` is a first/full pull.
 */
export async function fetchOwnCollectionsSince(
  userId: string,
  since: string | null,
): Promise<{ data: Collection[]; tombstonedIds: string[]; cursor: string | null }> {
  if (!isSupabaseConfigured) return { data: [], tombstonedIds: [], cursor: since };

  const url = ownCollectionsSinceUrl(supabaseUrl!, userId, since);
  // BE-28b: a single delta can exceed LIST_PAGE_SIZE (e.g. a first/full pull on
  // a large account), so keyset-page through it rather than truncating.
  const rows = await collectKeysetPages<DbCollection>((cursor) => fetchCollectionsPage(url, cursor), {
    getCursor: rowCreatedAt,
    getId: (row) => row.id,
  });
  // BE-15b: split soft-deleted rows out of the delta so the caller can drop
  // them from the local cache instead of merging a tombstone back in as a live
  // collection. The cursor still advances over *all* rows (tombstones included)
  // so a soft delete isn't re-pulled on every refresh.
  const { alive, tombstonedIds } = partitionByTombstone(rows, {
    getId: (row) => row.id,
    getDeletedAt: (row) => row.deleted_at,
  });
  return { data: alive.map(toCollection), tombstonedIds, cursor: maxUpdatedAt(since, rows) };
}

/**
 * Delta pull (BE-14) of every item a user authored, across all their
 * collections, in a single query. Mirrors `fetchOwnCollectionsSince`.
 */
export async function fetchOwnItemsSince(
  userId: string,
  since: string | null,
): Promise<{ data: CollectableItem[]; tombstonedIds: string[]; cursor: string | null }> {
  if (!isSupabaseConfigured) return { data: [], tombstonedIds: [], cursor: since };

  const url = ownItemsSinceUrl(supabaseUrl!, userId, since);
  // BE-28b: keyset-page the delta so a large item set isn't capped at one page.
  const rows = await collectKeysetPages<DbItem>((cursor) => fetchItemsPage(url, cursor), {
    getCursor: rowCreatedAt,
    getId: (row) => row.id,
  });
  // BE-15b: see fetchOwnCollectionsSince — partition tombstones out of the delta.
  const { alive, tombstonedIds } = partitionByTombstone(rows, {
    getId: (row) => row.id,
    getDeletedAt: (row) => row.deleted_at,
  });
  return { data: alive.map(toItem), tombstonedIds, cursor: maxUpdatedAt(since, rows) };
}

/** Fetch only public collections for a user (for non-owners viewing a profile). */
export async function fetchPublicCollectionsByUserId(userId: string): Promise<Collection[]> {
  if (!isSupabaseConfigured) return [];

  const url = publicCollectionsByUserUrl(supabaseUrl!, userId);
  const rows = await collectKeysetPages<DbCollection>((cursor) => fetchCollectionsPage(url, cursor), {
    getCursor: rowCreatedAt,
    getId: (row) => row.id,
  });
  return rows.filter((row) => !row.deleted_at).map(toCollection);
}

// --- Items ---

type DbItem = {
  id: string;
  collection_id: string;
  title: string;
  acquired_at: string;
  acquired_from: string;
  description: string;
  variants: string;
  photos: string[];
  created_by: string;
  created_by_user_id: string;
  created_at: string;
  cost?: number | null;
  cost_currency?: string | null;
  sort_order?: number | null;
  is_wishlist?: boolean;
  condition?: string | null;
  tags?: { label: string; color: string }[] | null;
  archived_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
};

function toItem(row: DbItem): CollectableItem {
  return coerceItemRow(row);
}

/**
 * Fetch a page of `DbItem` rows from a newest-first URL with the keyset cursor
 * applied. Mirrors `fetchCollectionsPage`; a non-OK response ends the loop.
 */
async function fetchItemsPage(url: string, cursor: string | null): Promise<DbItem[]> {
  const res = await supabaseRest(withKeysetBefore(url, cursor));
  if (!res.ok) return [];
  return res.json();
}

const wishlistCollectionCache = new Map<string, string>();

async function ensureWishlistCollection(userId: string, ownerName: string): Promise<string> {
  const cached = wishlistCollectionCache.get(userId);
  if (cached) return cached;

  const wishlistId = `wishlist-${userId}`;

  const res = await supabaseRest(`/collections?id=eq.${encodeURIComponent(wishlistId)}&select=id`);
  const rows: { id: string }[] = await res.json();

  if (rows.length === 0) {
    await supabaseRest("/collections", {
      method: "POST",
      body: JSON.stringify({
        id: wishlistId,
        name: "__wishlist__",
        cover_photo: "",
        description: "",
        owner_name: ownerName,
        owner_user_id: userId,
        sort_order: null,
        visibility: "private",
        shared_with_user_ids: [],
      }),
    });
  }

  wishlistCollectionCache.set(userId, wishlistId);
  return wishlistId;
}

/** Upsert an item to Supabase. */
export async function upsertItem(item: CollectableItem): Promise<void> {
  if (!isSupabaseConfigured) return;

  let collectionId = item.collectionId;
  if (!collectionId && item.isWishlist && item.createdByUserId) {
    collectionId = await ensureWishlistCollection(item.createdByUserId, item.createdBy);
  }

  await supabaseRest("/items", {
    method: "POST",
    body: JSON.stringify({
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
    }),
  });
}

export async function updateRemoteItem(id: string, updates: Partial<CollectableItem>): Promise<void> {
  if (!isSupabaseConfigured) return;

  const body: Record<string, unknown> = {};
  if ("title" in updates) body.title = updates.title;
  if ("description" in updates) body.description = updates.description;
  if ("acquiredAt" in updates) body.acquired_at = updates.acquiredAt;
  if ("acquiredFrom" in updates) body.acquired_from = updates.acquiredFrom;
  if ("variants" in updates) body.variants = updates.variants;
  if ("photos" in updates) body.photos = updates.photos;
  if ("cost" in updates) body.cost = updates.cost ?? null;
  if ("costCurrency" in updates) body.cost_currency = updates.costCurrency ?? null;
  if ("collectionId" in updates && updates.collectionId) body.collection_id = updates.collectionId;
  if ("sortOrder" in updates) body.sort_order = updates.sortOrder ?? null;
  if ("isWishlist" in updates) body.is_wishlist = updates.isWishlist;
  if ("condition" in updates) body.condition = updates.condition ?? null;
  if ("tags" in updates) body.tags = updates.tags ?? null;
  if ("archivedAt" in updates) body.archived_at = updates.archivedAt ?? null;

  if (Object.keys(body).length === 0) return;

  console.log("[updateRemoteItem] id:", id, "body:", JSON.stringify(body, null, 2));

  const res = await supabaseRest(`/items?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[updateRemoteItem] FAILED", res.status, text);
  }
}

/** Soft-delete an item (BE-15b): stamp `deleted_at` so the tombstone rides the
 * delta pull. See `softDeleteRemoteCollection`. */
export async function softDeleteRemoteItem(id: string): Promise<void> {
  if (!isSupabaseConfigured) return;

  await supabaseRest(`/items?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ deleted_at: new Date().toISOString() }),
  });
}

/** Fetch a single item by ID. */
export async function fetchItemById(id: string): Promise<CollectableItem | null> {
  if (!isSupabaseConfigured) return null;

  const res = await supabaseRest(`/items?id=eq.${id}&select=*`);
  const rows: DbItem[] = await res.json();
  return rows.length > 0 ? toItem(rows[0]) : null;
}

/** Fetch items for a specific collection. */
export async function fetchItemsByCollectionId(collectionId: string): Promise<CollectableItem[]> {
  if (!isSupabaseConfigured) return [];

  const url = withPageLimit(`/items?collection_id=eq.${collectionId}&select=*&order=created_at.desc`);
  // BE-28b: keyset-loop so a collection with more than LIST_PAGE_SIZE items
  // isn't truncated to its newest page.
  const rows = await collectKeysetPages<DbItem>((cursor) => fetchItemsPage(url, cursor), {
    getCursor: rowCreatedAt,
    getId: (row) => row.id,
  });
  // Drop soft-deleted rows so a bootstrap pull can't resurrect a deleted item (BE-15b).
  return rows.filter((row) => !row.deleted_at).map(toItem);
}

/** Fetch wishlist items for a specific user. */
export async function fetchWishlistItemsByUserId(userId: string): Promise<CollectableItem[]> {
  if (!isSupabaseConfigured) return [];

  const url = withPageLimit(
    `/items?created_by_user_id=eq.${userId}&is_wishlist=eq.true&select=*&order=created_at.desc`,
  );
  const rows = await collectKeysetPages<DbItem>((cursor) => fetchItemsPage(url, cursor), {
    getCursor: rowCreatedAt,
    getId: (row) => row.id,
  });
  // Drop soft-deleted wishlist items so a deleted wish doesn't reappear (BE-15b).
  return rows.filter((row) => !row.deleted_at).map(toItem);
}

// --- Friend Requests ---

export type RemoteFriendRequest = {
  from_user_id: string;
  to_user_id: string;
};

/** Fetch all friend requests involving a user (sent and received). */
export async function fetchFriendRequests(userId: string): Promise<RemoteFriendRequest[]> {
  if (!isSupabaseConfigured) return [];

  const res = await supabaseRest(friendRequestsUrl(supabaseUrl!, userId));
  return res.json();
}

/** Send a friend request. */
export async function sendFriendRequest(fromUserId: string, toUserId: string): Promise<void> {
  if (!isSupabaseConfigured) return;

  await supabaseRest(friendRequestsInsertUrl(supabaseUrl!), {
    method: "POST",
    body: JSON.stringify(sendFriendRequestBody(fromUserId, toUserId)),
  });
}

/** Remove a friend request (in either direction between two users). */
export async function removeFriendRequest(userA: string, userB: string): Promise<void> {
  if (!isSupabaseConfigured) return;

  await supabaseRest(removeFriendRequestUrl(supabaseUrl!, userA, userB), { method: "DELETE" });
}

/**
 * BE-21 — accept an incoming friend request from `fromUserId` (the sender)
 * through the server-authoritative `accept-friend-request` Edge Function, which
 * flips both directions to "friends" transactionally. Returns `true` when the
 * accept lands (200) or is permanently resolved (409 = the inbound request was
 * withdrawn, so retrying is pointless), `false` on a transient failure so the
 * pending-social queue re-delivers it. Bails `false` when there is no user
 * token — the anon apikey can't satisfy `auth.getUser()` inside the function.
 */
export async function cloudAcceptFriendRequest(fromUserId: string): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  const token = await getAccessToken();
  if (!token) return false;

  try {
    const res = await fetchWithRetry(acceptFriendRequestUrl(supabaseUrl!), {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(acceptFriendRequestPayload(fromUserId)),
    });
    return res.ok || res.status === 409;
  } catch (err) {
    captureException(err, { context: "supabase-profiles.cloudAcceptFriendRequest" });
    return false;
  }
}

// --- Collection Follows ---

/** Fetch all collection IDs the given user follows. */
export async function fetchFollowedCollectionIds(userId: string): Promise<string[]> {
  if (!isSupabaseConfigured) return [];

  const res = await supabaseRest(
    `/collection_follows?user_id=eq.${userId}&select=collection_id`,
  );
  const rows: { collection_id: string }[] = await res.json();
  return rows.map((r) => r.collection_id);
}

/** Follow a collection. */
export async function followCollectionRemote(userId: string, collectionId: string): Promise<void> {
  if (!isSupabaseConfigured) return;

  await supabaseRest("/collection_follows", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, collection_id: collectionId }),
  });
}

/** Unfollow a collection. */
export async function unfollowCollectionRemote(userId: string, collectionId: string): Promise<void> {
  if (!isSupabaseConfigured) return;

  await supabaseRest(
    `/collection_follows?user_id=eq.${userId}&collection_id=eq.${collectionId}`,
    { method: "DELETE" },
  );
}

// --- Collections shared with a user (via shared_with_user_ids column) ---

export async function fetchCollectionsSharedWithUser(userId: string): Promise<Collection[]> {
  if (!isSupabaseConfigured) return [];

  try {
    const url = withPageLimit(
      `/collections?shared_with_user_ids=cs.{${encodeURIComponent(userId)}}&select=*&order=created_at.desc`,
    );
    const rows = await collectKeysetPages<DbCollection>((cursor) => fetchCollectionsPage(url, cursor), {
      getCursor: rowCreatedAt,
      getId: (row) => row.id,
    });
    return rows.filter((row) => !row.deleted_at).map(toCollection);
  } catch (err) {
    captureException(err, { context: "supabase-profiles.fetchCollectionsSharedWithUser" });
    return [];
  }
}

/**
 * Register a visitor as an accepted viewer on a private collection. This is
 * used when a user opens a shared deep link — the collection is then saved
 * to their "shared with me" list so they can find it again later.
 *
 * Returns the updated Collection (with the viewer appended), or null if the
 * collection could not be found / updated.
 */
export async function registerSharedCollectionViewer(
  collectionId: string,
  viewerUserId: string,
): Promise<Collection | null> {
  if (!isSupabaseConfigured) return null;

  try {
    const current = await fetchCollectionById(collectionId);
    if (!current) return null;
    if (current.ownerUserId === viewerUserId) return current;
    if (current.visibility === "public") return current;
    const existing = current.sharedWithUserIds ?? [];
    if (existing.includes(viewerUserId)) return current;

    const next = [...existing, viewerUserId];
    await updateRemoteCollection(collectionId, { sharedWithUserIds: next });
    return { ...current, sharedWithUserIds: next };
  } catch (err) {
    captureException(err, { context: "supabase-profiles.registerSharedCollectionViewer" });
    return null;
  }
}

// --- Reactions ---

type DbReaction = {
  id: string;
  user_id: string;
  target_type: string;
  target_id: string;
  emoji: string;
  created_at: string;
};

function toReaction(row: DbReaction): Reaction {
  return coerceReactionRow(row);
}

export async function fetchReactions(targetType: ReactionTargetType, targetId: string): Promise<Reaction[]> {
  if (!isSupabaseConfigured) return [];

  const res = await supabaseRest(
    `/reactions?target_type=eq.${targetType}&target_id=eq.${encodeURIComponent(targetId)}&select=*`,
  );
  const rows: DbReaction[] = await res.json();
  return rows.map(toReaction);
}

export async function addReaction(
  userId: string,
  targetType: ReactionTargetType,
  targetId: string,
  emoji: ReactionEmoji,
): Promise<void> {
  if (!isSupabaseConfigured) return;

  await supabaseRest("/reactions", {
    method: "POST",
    body: JSON.stringify({
      user_id: userId,
      target_type: targetType,
      target_id: targetId,
      emoji,
    }),
  });
}

export async function removeReaction(
  userId: string,
  targetType: ReactionTargetType,
  targetId: string,
  emoji: ReactionEmoji,
): Promise<void> {
  if (!isSupabaseConfigured) return;

  await supabaseRest(
    `/reactions?user_id=eq.${userId}&target_type=eq.${targetType}&target_id=eq.${encodeURIComponent(targetId)}&emoji=eq.${emoji}`,
    { method: "DELETE" },
  );
}

export async function fetchAllUserImageUrls(userId: string): Promise<string[]> {
  if (!isSupabaseConfigured) return [];

  const urls: string[] = [];

  const colRes = await supabaseRest(`/collections?owner_user_id=eq.${userId}&select=cover_photo`);
  const cols: { cover_photo: string }[] = await colRes.json();
  for (const c of cols) {
    if (c.cover_photo) urls.push(c.cover_photo);
  }

  const itemRes = await supabaseRest(`/items?created_by_user_id=eq.${userId}&select=photos`);
  const items: { photos: string[] }[] = await itemRes.json();
  for (const item of items) {
    if (item.photos) urls.push(...item.photos);
  }

  const profileRes = await supabaseRest(`/profiles?id=eq.${userId}&select=avatar`);
  const profiles: { avatar: string }[] = await profileRes.json();
  for (const p of profiles) {
    if (p.avatar) urls.push(p.avatar);
  }

  return urls.filter((u) => u.includes("cloudinary"));
}

export async function deleteAllUserData(userId: string): Promise<void> {
  if (!isSupabaseConfigured) return;

  await supabaseRest(`/reactions?user_id=eq.${userId}`, { method: "DELETE" });
  await supabaseRest(`/items?created_by_user_id=eq.${userId}`, { method: "DELETE" });
  await supabaseRest(`/collection_follows?user_id=eq.${userId}`, { method: "DELETE" });
  await supabaseRest(`/collections?owner_user_id=eq.${userId}`, { method: "DELETE" });
  await supabaseRest(
    `/friend_requests?or=(from_user_id.eq.${userId},to_user_id.eq.${userId})`,
    { method: "DELETE" },
  );
  await supabaseRest(`/profiles?id=eq.${userId}`, { method: "DELETE" });
}

export async function deleteAccountViaEdgeFunction(): Promise<{ error?: string }> {
  if (!isSupabaseConfigured) return { error: "Not configured" };

  const token = await getAccessToken();
  if (!token) return { error: "No session" };

  const res = await fetch(`${supabaseUrl}/functions/v1/delete-account`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: supabaseKey,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Unknown error" }));
    return { error: data.error ?? "Deletion failed" };
  }

  return {};
}

/**
 * SEC-1: deletes Cloudinary assets via the `delete-image` Edge Function so
 * the Cloudinary API secret never ships in the client bundle. Best-effort —
 * the caller treats failure as non-fatal (an orphaned asset is not a user
 * data-loss bug). Returns the number reported deleted, 0 when unconfigured
 * or no session.
 */
export async function deleteImagesViaEdgeFunction(
  publicIds: readonly string[],
): Promise<{ deleted: number; error?: string }> {
  if (!isSupabaseConfigured) return { deleted: 0, error: "Not configured" };
  if (publicIds.length === 0) return { deleted: 0 };

  const token = await getAccessToken();
  if (!token) return { deleted: 0, error: "No session" };

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/delete-image`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ publicIds }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: "Unknown error" }));
      return { deleted: 0, error: data.error ?? "Deletion failed" };
    }
    const data = (await res.json().catch(() => ({}))) as { deleted?: number };
    return { deleted: typeof data.deleted === "number" ? data.deleted : 0 };
  } catch (err) {
    return { deleted: 0, error: (err as Error).message };
  }
}
