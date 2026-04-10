import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

import { seedCollections, seedItems } from "@/data/seed";
import { useAuth } from "@/lib/auth-context";
import { useSocial } from "@/lib/social-context";
import {
  upsertCollection,
  deleteRemoteCollection,
  upsertItem,
  deleteRemoteItem,
  fetchCollectionsByUserId,
  fetchItemsByCollectionId,
  fetchCollectionById,
  fetchFollowedCollectionIds,
  followCollectionRemote,
  unfollowCollectionRemote,
} from "@/lib/supabase-profiles";
import { Collection, CollectableItem } from "@/lib/types";

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
};

type DraftCollectionInput = {
  name: string;
  description: string;
  coverPhoto: string;
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
  getCollectionById: (id: string) => Collection | undefined;
  getItemsForCollection: (collectionId: string) => CollectableItem[];
  getItemById: (itemId: string) => CollectableItem | undefined;
  addItem: (input: DraftItemInput) => Promise<string>;
  addCollection: (input: DraftCollectionInput) => Promise<string>;
  deleteItem: (itemId: string) => Promise<void>;
  deleteCollection: (collectionId: string) => Promise<void>;
  deleteUserContent: (userId: string) => Promise<void>;
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
  const [ready, setReady] = useState(false);

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
  }, [user, followedCollectionIds]);

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

        const colResults = await Promise.all(friends.map((id) => fetchCollectionsByUserId(id)));
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
  }, [user, friends]);

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
    return merged;
  }, [getVisibleCollections, localCollections, friendCollections, subscribedCollections]);

  const items = useMemo(() => {
    const localIds = new Set(localItems.map((i) => i.id));
    const deduped = friendItems.filter((i) => !localIds.has(i.id));
    return [...localItems, ...getVisibleItems(), ...deduped];
  }, [getVisibleItems, localItems, friendItems]);

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
      getCollectionById: (id) => collections.find((collection) => collection.id === id),
      getItemsForCollection: (collectionId) =>
        items
          .filter((item) => item.collectionId === collectionId)
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
      getItemById: (itemId) => items.find((item) => item.id === itemId),
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
        };

        setLocalItems((current) => [nextItem, ...current]);
        upsertItem(nextItem).catch(() => undefined);
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
        };

        setLocalCollections((current) => [nextCollection, ...current]);
        upsertCollection(nextCollection).catch(() => undefined);
        return nextCollection.id;
      },
      deleteItem: async (itemId) => {
        setLocalItems((current) => current.filter((item) => item.id !== itemId));
        deleteRemoteItem(itemId).catch(() => undefined);
      },
      deleteCollection: async (collectionId) => {
        setLocalCollections((current) => current.filter((collection) => collection.id !== collectionId));
        setLocalItems((current) => current.filter((item) => item.collectionId !== collectionId));
        deleteRemoteCollection(collectionId).catch(() => undefined);
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
    [collections, items, localCollections, ready, user, friendCollections, subscribedCollections, followedCollectionIds],
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
