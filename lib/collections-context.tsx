import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

import { seedCollections, seedItems } from "@/data/seed";
import { useAuth } from "@/lib/auth-context";
import { useSocial } from "@/lib/social-context";
import {
  upsertCollection,
  updateRemoteCollection,
  deleteRemoteCollection,
  upsertItem,
  updateRemoteItem,
  deleteRemoteItem,
  fetchPublicCollectionsByUserId,
  fetchItemsByCollectionId,
  fetchCollectionById,
  fetchFollowedCollectionIds,
  followCollectionRemote,
  unfollowCollectionRemote,
  fetchCollectionsSharedWithUser,
} from "@/lib/supabase-profiles";
import { Collection, CollectableItem, ItemCondition, ItemTag } from "@/lib/types";

const ITEMS_STORAGE_KEY = "collectables-items-v1";
const COLLECTIONS_STORAGE_KEY = "collectables-collections-v1";
const FOLLOWED_COLLECTIONS_STORAGE_KEY = "collectables-followed-collections-v1";

type DraftItemInput = {
  collectionId: string;
  title: string;
  acquiredAt: string;
  acquiredFrom: string;
  description: string;
  variants: string;
  photos: string[];
  cost?: number | null;
  isWishlist?: boolean;
  condition?: ItemCondition;
  tags?: ItemTag[];
};

type DraftWishlistInput = {
  title: string;
  description: string;
  acquiredFrom: string;
  photos: string[];
  cost?: number | null;
};

type DraftCollectionInput = {
  name: string;
  description: string;
  coverPhoto: string;
  visibility?: "public" | "private";
};

type CollectionsContextValue = {
  collections: Collection[];
  items: CollectableItem[];
  ready: boolean;
  friendCollections: Collection[];
  subscribedCollections: Collection[];
  followedCollectionIds: string[];
  isCollectionFollowed: (collectionId: string) => boolean;
  followCollection: (collectionId: string) => Promise<void>;
  unfollowCollection: (collectionId: string) => Promise<void>;
  sharedWithMeCollections: Collection[];
  shareCollectionWithUser: (collectionId: string, userId: string) => void;
  unshareCollectionWithUser: (collectionId: string, userId: string) => void;
  getSharedUserIds: (collectionId: string) => string[];
  getCollectionById: (id: string) => Collection | undefined;
  getItemsForCollection: (collectionId: string) => CollectableItem[];
  getCollectionTotalCost: (collectionId: string) => number;
  getItemById: (itemId: string) => CollectableItem | undefined;
  wishlistItems: CollectableItem[];
  addWishlistItem: (input: DraftWishlistInput) => Promise<string>;
  promoteWishlistItem: (itemId: string, targetCollectionId: string) => Promise<void>;
  addItem: (input: DraftItemInput) => Promise<string>;
  addCollection: (input: DraftCollectionInput) => Promise<string>;
  updateItem: (itemId: string, updates: Partial<CollectableItem>) => Promise<void>;
  updateCollection: (collectionId: string, updates: Partial<Collection>) => Promise<void>;
  deleteItem: (itemId: string) => Promise<void>;
  deleteItems: (itemIds: string[]) => Promise<void>;
  moveItems: (itemIds: string[], targetCollectionId: string) => Promise<void>;
  deleteCollection: (collectionId: string) => Promise<void>;
  deleteUserContent: (userId: string) => Promise<void>;
  reorderOwnedCollections: (orderedIds: string[]) => void;
  reorderItemsInCollection: (collectionId: string, orderedIds: string[]) => void;
  refresh: () => Promise<void>;
};

const CollectionsContext = createContext<CollectionsContextValue | null>(null);

export function CollectionsProvider({ children }: React.PropsWithChildren) {
  const { user } = useAuth();
  const { getVisibleCollections, getVisibleItems, friends } = useSocial();
  const [localCollections, setLocalCollections] = useState<Collection[]>([]);
  const [localItems, setLocalItems] = useState<CollectableItem[]>([]);
  const [friendCollections, setFriendCollections] = useState<Collection[]>([]);
  const [friendItems, setFriendItems] = useState<CollectableItem[]>([]);
  const [followedCollectionIds, setFollowedCollectionIds] = useState<string[]>([]);
  const [subscribedCollections, setSubscribedCollections] = useState<Collection[]>([]);
  const [subscribedItems, setSubscribedItems] = useState<CollectableItem[]>([]);
  const [sharedWithMeCollections, setSharedWithMeCollections] = useState<Collection[]>([]);
  const [sharedWithMeItems, setSharedWithMeItems] = useState<CollectableItem[]>([]);
  const [ready, setReady] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!user) {
      setLocalCollections([]);
      setLocalItems([]);
      setFollowedCollectionIds([]);
      setSubscribedCollections([]);
      setReady(false);
      return;
    }

    const activeUser = user;
    let active = true;

    async function hydrate() {
      try {
        const [rawCollections, rawItems, rawFollowed, remoteFollowedIds] = await Promise.all([
          AsyncStorage.getItem(`${COLLECTIONS_STORAGE_KEY}-${activeUser.id}`),
          AsyncStorage.getItem(`${ITEMS_STORAGE_KEY}-${activeUser.id}`),
          AsyncStorage.getItem(`${FOLLOWED_COLLECTIONS_STORAGE_KEY}-${activeUser.id}`),
          fetchFollowedCollectionIds(activeUser.id),
        ]);

        if (!active) {
          return;
        }

        const parsedCollections = rawCollections ? (JSON.parse(rawCollections) as Collection[]) : seedCollections;
        const visibleCollections = parsedCollections.filter(
          (collection) =>
            collection.ownerUserId === activeUser.id || collection.sharedWithUserIds?.includes(activeUser.id),
        );
        const visibleCollectionIds = new Set(visibleCollections.map((collection) => collection.id));
        const parsedItems = rawItems ? (JSON.parse(rawItems) as CollectableItem[]) : seedItems;
        const visibleItems = parsedItems.filter((item) => visibleCollectionIds.has(item.collectionId));

        setLocalCollections(visibleCollections);
        setLocalItems(visibleItems);
        // Prefer remote followed IDs; fall back to local cache
        if (remoteFollowedIds.length > 0) {
          setFollowedCollectionIds(remoteFollowedIds);
        } else {
          setFollowedCollectionIds(rawFollowed ? (JSON.parse(rawFollowed) as string[]) : []);
        }
      } catch {
        if (active) {
          setLocalCollections(seedCollections);
          setLocalItems(seedItems);
        }
      } finally {
        if (active) {
          setReady(true);
        }
      }
    }

    void hydrate();

    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!ready || !user) {
      return;
    }

    Promise.all([
      AsyncStorage.setItem(`${COLLECTIONS_STORAGE_KEY}-${user.id}`, JSON.stringify(localCollections)),
      AsyncStorage.setItem(`${ITEMS_STORAGE_KEY}-${user.id}`, JSON.stringify(localItems)),
      AsyncStorage.setItem(`${FOLLOWED_COLLECTIONS_STORAGE_KEY}-${user.id}`, JSON.stringify(followedCollectionIds)),
    ]).catch(() => undefined);
  }, [localCollections, localItems, followedCollectionIds, ready, user]);

  // Fetch subscribed collections from Supabase
  useEffect(() => {
    if (!user || followedCollectionIds.length === 0) {
      setSubscribedCollections([]);
      return;
    }

    let active = true;

    // refreshTick triggers re-fetch
    void refreshTick;
    Promise.all(followedCollectionIds.map((id) => fetchCollectionById(id)))
      .then((results) => {
        if (active) {
          setSubscribedCollections(
            results.filter((c): c is Collection => c !== null).map((c) => ({ ...c, role: "viewer" })),
          );
        }
      })
      .catch(() => {});

    return () => { active = false; };
  }, [user, followedCollectionIds, refreshTick]);

  // Fetch items for subscribed collections
  useEffect(() => {
    if (!user || subscribedCollections.length === 0) {
      setSubscribedItems([]);
      return;
    }

    let active = true;

    Promise.all(subscribedCollections.map((c) => fetchItemsByCollectionId(c.id)))
      .then((results) => {
        if (active) {
          const allItems: CollectableItem[] = [];
          results.forEach((items) => items.forEach((item) => allItems.push(item)));
          setSubscribedItems(allItems);
        }
      })
      .catch(() => {});

    return () => { active = false; };
  }, [user, subscribedCollections]);

  // Fetch friends' collections and items from Supabase
  useEffect(() => {
    if (!user || friends.length === 0) {
      setFriendCollections([]);
      setFriendItems([]);
      return;
    }

    let active = true;

    async function loadFriendData() {
      try {
        const allCols: Collection[] = [];
        const allItems: CollectableItem[] = [];

        const colResults = await Promise.all(friends.map((id) => fetchPublicCollectionsByUserId(id)));
        colResults.forEach((cols) => {
          cols.forEach((c) => allCols.push({ ...c, role: "viewer" }));
        });

        const itemResults = await Promise.all(allCols.map((c) => fetchItemsByCollectionId(c.id)));
        itemResults.forEach((items) => {
          items.forEach((item) => allItems.push(item));
        });

        if (active) {
          setFriendCollections(allCols);
          setFriendItems(allItems);
        }
      } catch {
        // ignore
      }
    }

    void loadFriendData();

    return () => { active = false; };
  }, [user, friends, refreshTick]);

  // Fetch collections shared directly with the current user
  useEffect(() => {
    if (!user) {
      setSharedWithMeCollections([]);
      setSharedWithMeItems([]);
      return;
    }

    let active = true;

    async function loadShared() {
      try {
        const cols = await fetchCollectionsSharedWithUser(user!.id);
        if (!active) return;
        setSharedWithMeCollections(cols);

        const itemResults = await Promise.all(cols.map((c) => fetchItemsByCollectionId(c.id)));
        if (!active) return;
        const allItems: CollectableItem[] = [];
        itemResults.forEach((items) => items.forEach((item) => allItems.push(item)));
        setSharedWithMeItems(allItems);
      } catch {
        // ignore
      }
    }

    void loadShared();

    return () => { active = false; };
  }, [user, refreshTick]);

  const collections = useMemo(() => {
    const seen = new Set(localCollections.map((c) => c.id));
    const merged: Collection[] = [...localCollections];
    getVisibleCollections().forEach((c) => {
      if (!seen.has(c.id)) { merged.push(c); seen.add(c.id); }
    });
    friendCollections.forEach((c) => {
      if (!seen.has(c.id)) { merged.push(c); seen.add(c.id); }
    });
    subscribedCollections.forEach((c) => {
      if (!seen.has(c.id)) { merged.push(c); seen.add(c.id); }
    });
    sharedWithMeCollections.forEach((c) => {
      if (!seen.has(c.id)) { merged.push(c); seen.add(c.id); }
    });
    return merged;
  }, [getVisibleCollections, localCollections, friendCollections, subscribedCollections, sharedWithMeCollections]);

  const items = useMemo(() => {
    const seen = new Set(localItems.map((i) => i.id));
    const merged = [...localItems, ...getVisibleItems()];
    for (const item of friendItems) {
      if (!seen.has(item.id)) { merged.push(item); seen.add(item.id); }
    }
    for (const item of subscribedItems) {
      if (!seen.has(item.id)) { merged.push(item); seen.add(item.id); }
    }
    for (const item of sharedWithMeItems) {
      if (!seen.has(item.id)) { merged.push(item); seen.add(item.id); }
    }
    return merged;
  }, [getVisibleItems, localItems, friendItems, subscribedItems, sharedWithMeItems]);

  const value = useMemo<CollectionsContextValue>(
    () => ({
      collections,
      items,
      ready,
      friendCollections,
      subscribedCollections,
      followedCollectionIds,
      isCollectionFollowed: (collectionId) => followedCollectionIds.includes(collectionId),
      followCollection: async (collectionId) => {
        if (!user) return;
        setFollowedCollectionIds((current) =>
          current.includes(collectionId) ? current : [...current, collectionId],
        );
        followCollectionRemote(user.id, collectionId).catch(() => undefined);
      },
      unfollowCollection: async (collectionId) => {
        if (!user) return;
        setFollowedCollectionIds((current) => current.filter((id) => id !== collectionId));
        unfollowCollectionRemote(user.id, collectionId).catch(() => undefined);
      },
      sharedWithMeCollections,
      shareCollectionWithUser: (collectionId, userId) => {
        if (!user) return;
        setLocalCollections((current) =>
          current.map((col) => {
            if (col.id !== collectionId) return col;
            if (col.sharedWithUserIds.includes(userId)) return col;
            const updated = { ...col, sharedWithUserIds: [...col.sharedWithUserIds, userId] };
            updateRemoteCollection(collectionId, { sharedWithUserIds: updated.sharedWithUserIds }).catch(() => undefined);
            return updated;
          }),
        );
      },
      unshareCollectionWithUser: (collectionId, userId) => {
        if (!user) return;
        setLocalCollections((current) =>
          current.map((col) => {
            if (col.id !== collectionId) return col;
            const updated = { ...col, sharedWithUserIds: col.sharedWithUserIds.filter((id) => id !== userId) };
            updateRemoteCollection(collectionId, { sharedWithUserIds: updated.sharedWithUserIds }).catch(() => undefined);
            return updated;
          }),
        );
      },
      getSharedUserIds: (collectionId) => {
        const col = localCollections.find((c) => c.id === collectionId);
        return col?.sharedWithUserIds ?? [];
      },
      getCollectionById: (id) => collections.find((collection) => collection.id === id),
      getItemsForCollection: (collectionId) =>
        items
          .filter((item) => item.collectionId === collectionId && !item.isWishlist)
          .sort((a, b) => {
            const aHas = typeof a.sortOrder === "number";
            const bHas = typeof b.sortOrder === "number";
            if (aHas && bHas) return (a.sortOrder as number) - (b.sortOrder as number);
            if (aHas) return -1;
            if (bHas) return 1;
            return a.createdAt < b.createdAt ? 1 : -1;
          }),
      getCollectionTotalCost: (collectionId) =>
        items
          .filter((item) => item.collectionId === collectionId && !item.isWishlist)
          .reduce((sum, item) => sum + (typeof item.cost === "number" ? item.cost : 0), 0),
      getItemById: (itemId) => items.find((item) => item.id === itemId),
      wishlistItems: localItems
        .filter((item) => item.isWishlist)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
      addWishlistItem: async (input) => {
        const slug =
          input.title
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || `wish-${Date.now()}`;

        const nextItem: CollectableItem = {
          id: `wish-${slug}-${Date.now()}`,
          collectionId: "",
          title: input.title.trim(),
          acquiredAt: "",
          acquiredFrom: input.acquiredFrom.trim(),
          description: input.description.trim(),
          variants: "",
          photos: input.photos,
          createdBy: user?.email ?? "You",
          createdByUserId: user?.id ?? "unknown-user",
          createdAt: new Date().toISOString(),
          cost: input.cost ?? null,
          isWishlist: true,
        };

        setLocalItems((current) => [nextItem, ...current]);
        return nextItem.id;
      },
      promoteWishlistItem: async (itemId, targetCollectionId) => {
        const acquiredAt = new Date().toISOString().slice(0, 10);
        setLocalItems((current) =>
          current.map((item) => {
            if (item.id !== itemId) return item;
            return {
              ...item,
              collectionId: targetCollectionId,
              isWishlist: false,
              acquiredAt: item.acquiredAt || acquiredAt,
            };
          }),
        );
        upsertItem({
          id: itemId,
          collectionId: targetCollectionId,
          isWishlist: false,
          acquiredAt: acquiredAt,
        } as CollectableItem).catch(() => undefined);
      },
      addItem: async (input) => {
        const slug =
          input.title
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || `item-${Date.now()}`;

        const nextItem: CollectableItem = {
          id: `${slug}-${Date.now()}`,
          collectionId: input.collectionId,
          title: input.title.trim(),
          acquiredAt: input.acquiredAt.trim(),
          acquiredFrom: input.acquiredFrom.trim(),
          description: input.description.trim(),
          variants: input.variants.trim(),
          photos: input.photos,
          createdBy: user?.email ?? "You",
          createdByUserId: user?.id ?? "unknown-user",
          createdAt: new Date().toISOString(),
          cost: input.cost ?? null,
          isWishlist: input.isWishlist ?? false,
          condition: input.condition,
          tags: input.tags,
        };

        setLocalItems((current) => [nextItem, ...current]);
        if (!nextItem.isWishlist) {
          upsertItem(nextItem).catch(() => undefined);
        }
        return nextItem.id;
      },
      addCollection: async (input) => {
        const slug =
          input.name
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || `collection-${Date.now()}`;

        const nextCollection: Collection = {
          id: `${slug}-${Date.now()}`,
          name: input.name.trim(),
          description: input.description.trim(),
          coverPhoto: input.coverPhoto,
          ownerName: user?.email ?? "You",
          ownerUserId: user?.id ?? "unknown-user",
          sharedWith: [],
          sharedWithUserIds: [],
          role: "owner",
          visibility: input.visibility ?? "private",
        };

        setLocalCollections((current) => [nextCollection, ...current]);
        upsertCollection(nextCollection).catch(() => undefined);
        return nextCollection.id;
      },
      updateItem: async (itemId, updates) => {
        setLocalItems((current) =>
          current.map((item) => {
            if (item.id !== itemId) return item;
            return { ...item, ...updates, id: item.id };
          }),
        );
        updateRemoteItem(itemId, updates).catch(() => undefined);
      },
      updateCollection: async (collectionId, updates) => {
        setLocalCollections((current) =>
          current.map((col) => {
            if (col.id !== collectionId) return col;
            return { ...col, ...updates, id: col.id };
          }),
        );
        updateRemoteCollection(collectionId, updates).catch(() => undefined);
      },
      deleteItem: async (itemId) => {
        setLocalItems((current) => current.filter((item) => item.id !== itemId));
        deleteRemoteItem(itemId).catch(() => undefined);
      },
      deleteItems: async (itemIds) => {
        if (itemIds.length === 0) return;
        const idSet = new Set(itemIds);
        setLocalItems((current) => current.filter((item) => !idSet.has(item.id)));
        await Promise.allSettled(itemIds.map((id) => deleteRemoteItem(id)));
      },
      moveItems: async (itemIds, targetCollectionId) => {
        if (itemIds.length === 0) return;
        const idSet = new Set(itemIds);
        const moved: CollectableItem[] = [];
        setLocalItems((current) =>
          current.map((item) => {
            if (!idSet.has(item.id) || item.collectionId === targetCollectionId) return item;
            const next = { ...item, collectionId: targetCollectionId, sortOrder: undefined };
            moved.push(next);
            return next;
          }),
        );
        await Promise.allSettled(moved.map((item) => updateRemoteItem(item.id, { collectionId: item.collectionId, sortOrder: undefined })));
      },
      deleteCollection: async (collectionId) => {
        setLocalCollections((current) => current.filter((collection) => collection.id !== collectionId));
        setLocalItems((current) => current.filter((item) => item.collectionId !== collectionId));
        deleteRemoteCollection(collectionId).catch(() => undefined);
      },
      reorderOwnedCollections: (orderedIds) => {
        const updated: Collection[] = [];
        setLocalCollections((current) => {
          const byId = new Map(current.map((c) => [c.id, c]));
          const reordered: Collection[] = [];
          orderedIds.forEach((id, index) => {
            const c = byId.get(id);
            if (c) {
              const next = { ...c, sortOrder: index };
              reordered.push(next);
              updated.push(next);
              byId.delete(id);
            }
          });
          byId.forEach((c) => reordered.push(c));
          return reordered;
        });
        Promise.allSettled(updated.map((c) => updateRemoteCollection(c.id, { sortOrder: c.sortOrder }))).catch(() => undefined);
      },
      refresh: async () => {
        setRefreshTick((n) => n + 1);
      },
      reorderItemsInCollection: (collectionId, orderedIds) => {
        const indexById = new Map(orderedIds.map((id, idx) => [id, idx]));
        const reordered: { id: string; sortOrder: number }[] = [];
        setLocalItems((current) =>
          current.map((item) => {
            if (item.collectionId === collectionId && indexById.has(item.id)) {
              const order = indexById.get(item.id)!;
              reordered.push({ id: item.id, sortOrder: order });
              return { ...item, sortOrder: order };
            }
            return item;
          }),
        );
        Promise.allSettled(reordered.map((r) => updateRemoteItem(r.id, { sortOrder: r.sortOrder }))).catch(() => undefined);
      },
      deleteUserContent: async (userId) => {
        const ownedCollectionIds = new Set(
          localCollections.filter((collection) => collection.ownerUserId === userId).map((collection) => collection.id),
        );

        setLocalCollections((current) => current.filter((collection) => collection.ownerUserId !== userId));
        setLocalItems((current) =>
          current.filter((item) => item.createdByUserId !== userId && !ownedCollectionIds.has(item.collectionId)),
        );
      },
    }),
    [collections, items, localCollections, ready, user, friendCollections, subscribedCollections, followedCollectionIds, sharedWithMeCollections],
  );

  return <CollectionsContext.Provider value={value}>{children}</CollectionsContext.Provider>;
}

export function useCollections() {
  const context = useContext(CollectionsContext);
  if (!context) {
    throw new Error("useCollections must be used inside CollectionsProvider");
  }
  return context;
}
