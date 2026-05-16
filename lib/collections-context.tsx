import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

import { seedCollections, seedItems } from "@/data/seed";
import { useAuth } from "@/lib/auth-context";
import {
  hasNewCloudEntries,
  mergeCollectionsFromCloud,
  mergeItemsFromCloud,
} from "@/lib/collections-cloud-merge";
import { useSocial } from "@/lib/social-context";
import {
  upsertCollection,
  updateRemoteCollection,
  deleteRemoteCollection,
  upsertItem,
  updateRemoteItem,
  deleteRemoteItem,
  fetchCollectionsByUserId,
  fetchPublicCollectionsByUserId,
  fetchItemsByCollectionId,
  fetchCollectionById,
  fetchFollowedCollectionIds,
  followCollectionRemote,
  unfollowCollectionRemote,
  fetchCollectionsSharedWithUser,
  fetchWishlistItemsByUserId,
  registerSharedCollectionViewer,
} from "@/lib/supabase-profiles";
import {
  addViewerToSharedIds,
  removeViewerFromSharedIds,
  shouldAutoSaveSharedCollection,
} from "@/lib/share-access";
import { collectionsKey, itemsKey, followedCollectionsKey } from "@/lib/storage-keys";
import { Collection, CollectableItem, ItemCondition, ItemTag } from "@/lib/types";
import { generateUuidV4 } from "@/lib/uuid";

type DraftItemInput = {
  collectionId: string;
  title: string;
  acquiredAt: string;
  acquiredFrom: string;
  description: string;
  variants: string;
  photos: string[];
  cost?: number | null;
  costCurrency?: string | null;
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

export type AcquiredItemSnapshot = {
  title: string;
  photos: string[];
  description?: string;
  variants?: string;
  cost?: number | null;
  acquiredFrom?: string;
  condition?: ItemCondition;
  tags?: ItemTag[];
};

export const ACQUIRED_COLLECTION_ID_SUFFIX = "acquired-marketplace";

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
  saveSharedCollection: (collection: Collection) => Promise<Collection | null>;
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
  transferItemToBuyer: (
    snapshot: AcquiredItemSnapshot,
    options?: { collectionName?: string; collectionDescription?: string },
  ) => Promise<{ itemId: string; collectionId: string } | null>;
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
      setLocalCollections(prev => prev.length === 0 ? prev : []);
      setLocalItems(prev => prev.length === 0 ? prev : []);
      setFollowedCollectionIds(prev => prev.length === 0 ? prev : []);
      setSubscribedCollections(prev => prev.length === 0 ? prev : []);
      setReady(false);
      return;
    }

    const activeUser = user;
    let active = true;

    async function hydrate() {
      try {
        const [rawCollections, rawItems, rawFollowed, remoteFollowedIds, remoteWishlist] = await Promise.all([
          AsyncStorage.getItem(collectionsKey(activeUser.id)),
          AsyncStorage.getItem(itemsKey(activeUser.id)),
          AsyncStorage.getItem(followedCollectionsKey(activeUser.id)),
          fetchFollowedCollectionIds(activeUser.id),
          fetchWishlistItemsByUserId(activeUser.id),
        ]);

        if (!active) {
          return;
        }

        const parsedCollections = rawCollections ? (JSON.parse(rawCollections) as Collection[]) : seedCollections;
        let visibleCollections = parsedCollections.filter(
          (collection) =>
            collection.ownerUserId === activeUser.id || collection.sharedWithUserIds?.includes(activeUser.id),
        );

        // Fresh sign-in / cleared storage / saved-empty path: when nothing in
        // AsyncStorage matches the signed-in user, pull the user's own
        // collections from Supabase so the home page's "My collections" block
        // isn't empty just because the local cache is. toCollection() in
        // supabase-profiles.ts hardcodes role: "viewer" for safety on
        // shared/public reads — promote it back to "owner" here for rows
        // where ownerUserId matches the signed-in user.
        if (visibleCollections.length === 0) {
          try {
            const remote = await fetchCollectionsByUserId(activeUser.id);
            if (active && remote.length > 0) {
              visibleCollections = remote.map((collection) =>
                collection.ownerUserId === activeUser.id
                  ? { ...collection, role: "owner" }
                  : collection,
              );
            }
          } catch {
            // Network/Supabase unavailable — fall through with the empty list
            // so the home page renders the empty-state instead of crashing.
          }
        }

        const visibleCollectionIds = new Set(visibleCollections.map((collection) => collection.id));
        const parsedItems = rawItems ? (JSON.parse(rawItems) as CollectableItem[]) : seedItems;
        const visibleItems = parsedItems.filter((item) => visibleCollectionIds.has(item.collectionId) || item.isWishlist);

        // After a remote-bootstrap, also pull each collection's items so the
        // home page's "Recent items" + per-collection counts aren't empty.
        if (visibleItems.length === 0 && visibleCollections.length > 0) {
          try {
            const itemResults = await Promise.all(
              visibleCollections.map((c) => fetchItemsByCollectionId(c.id)),
            );
            if (active) {
              const seen = new Set(visibleItems.map((i) => i.id));
              for (const items of itemResults) {
                for (const item of items) {
                  if (!seen.has(item.id)) {
                    visibleItems.push(item);
                    seen.add(item.id);
                  }
                }
              }
            }
          } catch {
            // Items can lazy-load on next refresh; first paint of collection
            // counts will show 0 until that happens.
          }
        }

        const seenIds = new Set(visibleItems.map((i) => i.id));
        for (const wi of remoteWishlist) {
          if (!seenIds.has(wi.id)) {
            visibleItems.push(wi);
            seenIds.add(wi.id);
          }
        }

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
      AsyncStorage.setItem(collectionsKey(user.id), JSON.stringify(localCollections)),
      AsyncStorage.setItem(itemsKey(user.id), JSON.stringify(localItems)),
      AsyncStorage.setItem(followedCollectionsKey(user.id), JSON.stringify(followedCollectionIds)),
    ]).catch(() => undefined);
  }, [localCollections, localItems, followedCollectionIds, ready, user]);

  // Best-effort cloud refresh: after the local-first paint completes (`ready`),
  // fetch the user's collections + items from Supabase and merge any new
  // entries into local state. Handles the "added an item on mobile, not
  // showing on PC" case — the previous gates only fetched cloud when local
  // was *completely* empty, so cross-device additions were invisible until a
  // full storage flush. Runs on user change and on `refreshTick` so the
  // existing `refresh()` exposed by context callers reaches the user's own
  // collections too (it previously only retriggered the friend / followed /
  // shared effects). Cloud rows win on ID conflict; local-only entries are
  // preserved so an offline write that hasn't synced yet doesn't disappear.
  useEffect(() => {
    if (!ready || !user) return;
    void refreshTick;

    const activeUser = user;
    let cancelled = false;

    async function syncFromCloud() {
      try {
        const remoteCollections = await fetchCollectionsByUserId(activeUser.id);
        if (cancelled) return;
        if (remoteCollections.length > 0) {
          setLocalCollections((current) => {
            const localIds = new Set(current.map((c) => c.id));
            const cloudIds = remoteCollections.map((c) => c.id);
            if (!hasNewCloudEntries(localIds, cloudIds)) return current;
            return mergeCollectionsFromCloud(current, remoteCollections, activeUser.id);
          });
        }

        // Pull items for every collection we now own/share into. Use the
        // post-merge collection set rather than the stale closure value so
        // newly-discovered cloud collections also have their items loaded.
        const collectionsToScan = remoteCollections.length > 0
          ? remoteCollections
          : [];
        if (collectionsToScan.length === 0) return;
        const itemBatches = await Promise.all(
          collectionsToScan.map((c) => fetchItemsByCollectionId(c.id)),
        );
        if (cancelled) return;
        const flattened = itemBatches.flat();
        if (flattened.length === 0) return;
        setLocalItems((current) => {
          const localIds = new Set(current.map((i) => i.id));
          const cloudIds = flattened.map((i) => i.id);
          if (!hasNewCloudEntries(localIds, cloudIds)) return current;
          return mergeItemsFromCloud(current, flattened);
        });
      } catch {
        // Network/Supabase unavailable — keep the local state intact.
      }
    }

    void syncFromCloud();

    return () => {
      cancelled = true;
    };
  }, [user, ready, refreshTick]);

  // Fetch subscribed collections from Supabase
  useEffect(() => {
    if (!user || followedCollectionIds.length === 0) {
      setSubscribedCollections(prev => prev.length === 0 ? prev : []);
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
      setSubscribedItems(prev => prev.length === 0 ? prev : []);
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
      setFriendCollections(prev => prev.length === 0 ? prev : []);
      setFriendItems(prev => prev.length === 0 ? prev : []);
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
      setSharedWithMeCollections(prev => prev.length === 0 ? prev : []);
      setSharedWithMeItems(prev => prev.length === 0 ? prev : []);
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
            const updated = { ...col, sharedWithUserIds: addViewerToSharedIds(col.sharedWithUserIds, userId) };
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
            const updated = { ...col, sharedWithUserIds: removeViewerFromSharedIds(col.sharedWithUserIds, userId) };
            updateRemoteCollection(collectionId, { sharedWithUserIds: updated.sharedWithUserIds }).catch(() => undefined);
            return updated;
          }),
        );
      },
      getSharedUserIds: (collectionId) => {
        const col = localCollections.find((c) => c.id === collectionId);
        return col?.sharedWithUserIds ?? [];
      },
      saveSharedCollection: async (collection) => {
        if (!user) return null;
        if (!shouldAutoSaveSharedCollection(collection, user.id)) return null;
        const updated = await registerSharedCollectionViewer(collection.id, user.id);
        if (!updated) return null;
        const asViewer: Collection = { ...updated, role: "viewer" };
        setSharedWithMeCollections((current) =>
          current.some((c) => c.id === asViewer.id)
            ? current.map((c) => (c.id === asViewer.id ? asViewer : c))
            : [...current, asViewer],
        );
        try {
          const items = await fetchItemsByCollectionId(asViewer.id);
          setSharedWithMeItems((current) => {
            const seen = new Set(current.map((i) => i.id));
            const merged = [...current];
            for (const item of items) {
              if (!seen.has(item.id)) {
                merged.push(item);
                seen.add(item.id);
              }
            }
            return merged;
          });
        } catch {
          // ignore: items will load on next refresh
        }
        return asViewer;
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
        upsertItem(nextItem).catch(() => undefined);
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
        updateRemoteItem(itemId, {
          collectionId: targetCollectionId,
          isWishlist: false,
          acquiredAt: acquiredAt,
        }).catch(() => undefined);
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
          costCurrency: input.costCurrency ?? null,
          isWishlist: input.isWishlist ?? false,
          condition: input.condition,
          tags: input.tags,
        };

        setLocalItems((current) => [nextItem, ...current]);
        upsertItem(nextItem).catch(() => undefined);
        return nextItem.id;
      },
      addCollection: async (input) => {
        // Use a random uuid as the primary key. Deriving the id from the
        // (mutable, non-unique) name slug meant two same-named collections —
        // e.g. two "Hot Wheels" — collided, and the dedupe-by-id cloud merge
        // (mergeCollectionsFromCloud) silently collapsed them into one,
        // losing data. A uuid also matches the cloud `collections.id` column.
        const nextCollection: Collection = {
          id: generateUuidV4(),
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
      transferItemToBuyer: async (snapshot, options) => {
        if (!user) return null;
        const ownerName = user.email ?? "You";
        const ownerUserId = user.id;
        const collectionId = `${ownerUserId}-${ACQUIRED_COLLECTION_ID_SUFFIX}`;
        const existing = localCollections.find((c) => c.id === collectionId);
        if (!existing) {
          const newCollection: Collection = {
            id: collectionId,
            name: options?.collectionName ?? "Acquired",
            description: options?.collectionDescription ?? "",
            coverPhoto: snapshot.photos[0] ?? "",
            ownerName,
            ownerUserId,
            sharedWith: [],
            sharedWithUserIds: [],
            role: "owner",
            visibility: "private",
          };
          setLocalCollections((current) => [newCollection, ...current]);
          upsertCollection(newCollection).catch(() => undefined);
        }
        const slug =
          snapshot.title
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || `acquired-${Date.now()}`;
        const acquiredAt = new Date().toISOString().slice(0, 10);
        const nextItem: CollectableItem = {
          id: `acq-${slug}-${Date.now()}`,
          collectionId,
          title: snapshot.title.trim() || "Acquired item",
          acquiredAt,
          acquiredFrom: snapshot.acquiredFrom?.trim() ?? "",
          description: snapshot.description?.trim() ?? "",
          variants: snapshot.variants?.trim() ?? "",
          photos: snapshot.photos,
          createdBy: ownerName,
          createdByUserId: ownerUserId,
          createdAt: new Date().toISOString(),
          cost: typeof snapshot.cost === "number" ? snapshot.cost : null,
          isWishlist: false,
          condition: snapshot.condition,
          tags: snapshot.tags,
        };
        setLocalItems((current) => [nextItem, ...current]);
        upsertItem(nextItem).catch(() => undefined);
        return { itemId: nextItem.id, collectionId };
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
    [collections, items, localCollections, localItems, ready, user, friendCollections, subscribedCollections, followedCollectionIds, sharedWithMeCollections],
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
