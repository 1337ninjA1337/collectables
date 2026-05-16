import { Collection, CollectableItem, UserProfile } from "@/lib/types";

/**
 * Pure URL/body/header builders for the Supabase REST API endpoints used by
 * `lib/supabase-profiles.ts`. Kept in a separate module (no react-native or
 * auth imports) so that tests can assert URL shape and request body without
 * mocking `fetch` or the Supabase auth client.
 */

// --- Profiles ---

export function profilesUrl(baseUrl: string): string {
  return `${baseUrl}/rest/v1/profiles`;
}

export function profileByIdUrl(baseUrl: string, id: string): string {
  return `${baseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=*`;
}

export function profilesPageUrl(baseUrl: string, page: number, pageSize: number): string {
  const from = (page - 1) * pageSize;
  return `${baseUrl}/rest/v1/profiles?select=*&order=created_at.desc&offset=${from}&limit=${pageSize}`;
}

export function profilesPageRangeHeader(page: number, pageSize: number): string {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  return `${from}-${to}`;
}

export function upsertProfileBody(profile: UserProfile): Record<string, unknown> {
  return {
    id: profile.id,
    email: profile.email,
    display_name: profile.displayName,
    username: profile.username,
    public_id: profile.publicId,
    bio: profile.bio,
    avatar: profile.avatar,
  };
}

// --- Collections ---

export function collectionsUrl(baseUrl: string): string {
  return `${baseUrl}/rest/v1/collections`;
}

export function collectionByIdUrl(baseUrl: string, id: string): string {
  return `${baseUrl}/rest/v1/collections?id=eq.${encodeURIComponent(id)}&select=*`;
}

export function collectionsByUserUrl(baseUrl: string, userId: string): string {
  return `${baseUrl}/rest/v1/collections?owner_user_id=eq.${encodeURIComponent(userId)}&name=neq.__wishlist__&select=*&order=created_at.desc`;
}

export function publicCollectionsByUserUrl(baseUrl: string, userId: string): string {
  return `${baseUrl}/rest/v1/collections?owner_user_id=eq.${encodeURIComponent(userId)}&visibility=eq.public&name=neq.__wishlist__&select=*&order=created_at.desc`;
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
  };
}

// --- Items ---

export function itemByIdUrl(baseUrl: string, id: string): string {
  return `${baseUrl}/rest/v1/items?id=eq.${encodeURIComponent(id)}&select=*`;
}

export function itemsByCollectionUrl(baseUrl: string, collectionId: string): string {
  return `${baseUrl}/rest/v1/items?collection_id=eq.${encodeURIComponent(collectionId)}&select=*&order=created_at.desc`;
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
