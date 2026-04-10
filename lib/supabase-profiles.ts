import { authClient, isSupabaseConfigured } from "@/lib/supabase";
import { CollectableItem, Collection, UserProfile } from "@/lib/types";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

type DbProfile = {
  id: string;
  email: string;
  display_name: string;
  username: string;
  public_id: string;
  bio: string;
  avatar: string;
};

function toUserProfile(row: DbProfile): UserProfile {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    username: row.username,
    publicId: row.public_id,
    bio: row.bio,
    avatar: row.avatar,
  };
}

async function getAccessToken(): Promise<string | null> {
  if (!authClient) return null;
  const { data } = await authClient.getSession();
  return data.session?.access_token ?? null;
}

async function supabaseRest(
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
) {
  const token = await getAccessToken();
  const res = await fetch(`${supabaseUrl}/rest/v1${path}`, {
    method: options.method ?? "GET",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${token ?? supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: options.method === "POST" ? "resolution=merge-duplicates,return=minimal" : "",
      ...options.headers,
    },
    body: options.body,
  });
  return res;
}

/** Upsert the current user's profile into the profiles table. */
export async function upsertMyProfile(profile: UserProfile): Promise<void> {
  if (!isSupabaseConfigured) return;

  await supabaseRest("/profiles", {
    method: "POST",
    body: JSON.stringify({
      id: profile.id,
      email: profile.email,
      display_name: profile.displayName,
      username: profile.username,
      public_id: profile.publicId,
      bio: profile.bio,
      avatar: profile.avatar,
    }),
  });
}

/** Fetch a single profile by ID. */
export async function fetchProfileById(id: string): Promise<UserProfile | null> {
  if (!isSupabaseConfigured) return null;

  const res = await supabaseRest(`/profiles?id=eq.${id}&select=*`);
  const rows: DbProfile[] = await res.json();
  return rows.length > 0 ? toUserProfile(rows[0]) : null;
}

/** Fetch a page of profiles. Returns { data, totalCount }. */
export async function fetchProfiles(
  page: number,
  pageSize: number,
): Promise<{ data: UserProfile[]; totalCount: number }> {
  if (!isSupabaseConfigured) return { data: [], totalCount: 0 };

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const res = await supabaseRest(
    `/profiles?select=*&order=created_at.desc&offset=${from}&limit=${pageSize}`,
    {
      headers: {
        Range: `${from}-${to}`,
        Prefer: "count=exact",
      },
    },
  );

  const totalCount = parseInt(res.headers.get("content-range")?.split("/")?.[1] ?? "0", 10);
  const rows: DbProfile[] = await res.json();

  return { data: rows.map(toUserProfile), totalCount };
}

// --- Collections ---

type DbCollection = {
  id: string;
  name: string;
  cover_photo: string;
  description: string;
  owner_name: string;
  owner_user_id: string;
};

function toCollection(row: DbCollection): Collection {
  return {
    id: row.id,
    name: row.name,
    coverPhoto: row.cover_photo,
    description: row.description,
    ownerName: row.owner_name,
    ownerUserId: row.owner_user_id,
    sharedWith: [],
    sharedWithUserIds: [],
    role: "viewer",
  };
}

/** Upsert a collection to Supabase. */
export async function upsertCollection(collection: Collection): Promise<void> {
  if (!isSupabaseConfigured) return;

  await supabaseRest("/collections", {
    method: "POST",
    body: JSON.stringify({
      id: collection.id,
      name: collection.name,
      cover_photo: collection.coverPhoto,
      description: collection.description,
      owner_name: collection.ownerName,
      owner_user_id: collection.ownerUserId,
    }),
  });
}

/** Delete a collection from Supabase. */
export async function deleteRemoteCollection(id: string): Promise<void> {
  if (!isSupabaseConfigured) return;

  await supabaseRest(`/collections?id=eq.${id}`, { method: "DELETE" });
}

/** Fetch a single collection by ID. */
export async function fetchCollectionById(id: string): Promise<Collection | null> {
  if (!isSupabaseConfigured) return null;

  const res = await supabaseRest(`/collections?id=eq.${id}&select=*`);
  const rows: DbCollection[] = await res.json();
  return rows.length > 0 ? toCollection(rows[0]) : null;
}

/** Fetch collections for a specific user. */
export async function fetchCollectionsByUserId(userId: string): Promise<Collection[]> {
  if (!isSupabaseConfigured) return [];

  const res = await supabaseRest(`/collections?owner_user_id=eq.${userId}&select=*&order=created_at.desc`);
  const rows: DbCollection[] = await res.json();
  return rows.map(toCollection);
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
};

function toItem(row: DbItem): CollectableItem {
  return {
    id: row.id,
    collectionId: row.collection_id,
    title: row.title,
    acquiredAt: row.acquired_at,
    acquiredFrom: row.acquired_from,
    description: row.description,
    variants: row.variants,
    photos: row.photos ?? [],
    createdBy: row.created_by,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
  };
}

/** Upsert an item to Supabase. */
export async function upsertItem(item: CollectableItem): Promise<void> {
  if (!isSupabaseConfigured) return;

  await supabaseRest("/items", {
    method: "POST",
    body: JSON.stringify({
      id: item.id,
      collection_id: item.collectionId,
      title: item.title,
      acquired_at: item.acquiredAt,
      acquired_from: item.acquiredFrom,
      description: item.description,
      variants: item.variants,
      photos: item.photos,
      created_by: item.createdBy,
      created_by_user_id: item.createdByUserId,
      created_at: item.createdAt,
    }),
  });
}

/** Delete an item from Supabase. */
export async function deleteRemoteItem(id: string): Promise<void> {
  if (!isSupabaseConfigured) return;

  await supabaseRest(`/items?id=eq.${id}`, { method: "DELETE" });
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

  const res = await supabaseRest(`/items?collection_id=eq.${collectionId}&select=*&order=created_at.desc`);
  const rows: DbItem[] = await res.json();
  return rows.map(toItem);
}

// --- Friend Requests ---

export type RemoteFriendRequest = {
  from_user_id: string;
  to_user_id: string;
};

/** Fetch all friend requests involving a user (sent and received). */
export async function fetchFriendRequests(userId: string): Promise<RemoteFriendRequest[]> {
  if (!isSupabaseConfigured) return [];

  const res = await supabaseRest(
    `/friend_requests?or=(from_user_id.eq.${userId},to_user_id.eq.${userId})&select=from_user_id,to_user_id`,
  );
  return res.json();
}

/** Send a friend request. */
export async function sendFriendRequest(fromUserId: string, toUserId: string): Promise<void> {
  if (!isSupabaseConfigured) return;

  await supabaseRest("/friend_requests", {
    method: "POST",
    body: JSON.stringify({ from_user_id: fromUserId, to_user_id: toUserId }),
  });
}

/** Remove a friend request (in either direction between two users). */
export async function removeFriendRequest(userA: string, userB: string): Promise<void> {
  if (!isSupabaseConfigured) return;

  await supabaseRest(
    `/friend_requests?or=(and(from_user_id.eq.${userA},to_user_id.eq.${userB}),and(from_user_id.eq.${userB},to_user_id.eq.${userA}))`,
    { method: "DELETE" },
  );
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
