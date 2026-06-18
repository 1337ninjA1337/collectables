import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { seedCollections, seedItems } from "@/data/seed";
import { useAuth } from "@/lib/auth-context";
import {
  loadCurrencyRates,
  sumConverted,
  type UsdRates,
} from "@/lib/currency-rates";
import { convertItemCost, type ConvertedItemCost } from "@/lib/item-cost";
import { useI18n } from "@/lib/i18n-context";
import {
  getDefaultCurrencyForLanguage,
  getUserPreferredCurrency,
  parseStoredCurrency,
  setUserPreferredCurrency,
} from "@/lib/locale-helpers";
import {
  hasNewCloudEntries,
  mergeCollectionsFromCloud,
  mergeItemsFromCloud,
} from "@/lib/collections-cloud-merge";
import { userScopedCollectionId } from "@/lib/collections-helpers";
import {
  appendTransferLogEntry,
} from "@/lib/marketplace-transfer-log";
import {
  ACQUIRED_COLLECTION_ID_SUFFIX,
  planTransferItem,
} from "@/lib/transfer-item-helpers";
import type { AcquiredItemSnapshot } from "@/lib/transfer-item-types";
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
  fetchProfileById,
  updateMyProfileDisplayCurrency,
} from "@/lib/supabase-profiles";
import {
  addViewerToSharedIds,
  removeViewerFromSharedIds,
  shouldAutoSaveSharedCollection,
} from "@/lib/share-access";
import {
  collectionsKey,
  itemsKey,
  followedCollectionsKey,
  pendingCollectionsKey,
  pendingItemsKey,
} from "@/lib/storage-keys";
import { Collection, CollectableItem, ItemCondition, ItemTag, MarketplaceMode } from "@/lib/types";
import { generateUuidV4 } from "@/lib/uuid";
import { normalizeOwnItemIds } from "@/lib/item-id";
import {
  applyDeliveredUpserts,
  dequeueUpsert,
  enqueueUpsert,
  flushPendingUpserts,
  hasPendingUpserts,
  type PendingUpsertQueue,
} from "@/lib/pending-upserts";

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

export type { AcquiredItemSnapshot };
export type { ConvertedItemCost };

export { ACQUIRED_COLLECTION_ID_SUFFIX };

export type CollectionTotalCost = {
  /** Sum of all item costs, converted to `currency`. */
  amount: number;
  /** Currency the amount is expressed in (the user's preferred display currency). */
  currency: string;
  /** Number of items whose cost was successfully converted. */
  converted: number;
  /** Number of items whose cost couldn't be converted (missing rate). */
  skipped: number;
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
  saveSharedCollection: (collection: Collection) => Promise<Collection | null>;
  getCollectionById: (id: string) => Collection | undefined;
  getItemsForCollection: (collectionId: string) => CollectableItem[];
  getCollectionTotalCost: (collectionId: string) => CollectionTotalCost;
  /**
   * Convert a single item's cost into `targetCurrency` (defaults to the
   * viewer's `displayCurrency`). Pass a collection's `currency` override as
   * `targetCurrency` to keep in-collection values consistent with
   * `getCollectionTotalCost`. See `convertItemCost` in `lib/item-cost.ts`.
   */
  convertItemCost: (item: CollectableItem, targetCurrency?: string) => ConvertedItemCost;
  displayCurrency: string;
  /**
   * Unix ms when the currency rate table was last fetched (cache or network),
   * or `null` when no rates are available yet — the settings screen surfaces
   * "rates updated {when}" vs a "conversion unavailable" hint off this.
   */
  currencyRatesUpdatedAt: number | null;
  /**
   * Set the user's app-wide display currency. Updates state, persists to the
   * device-local AsyncStorage fallback, and (when signed in) syncs to the
   * profile row so the choice follows the account across devices (bug-2c).
   * No-ops on input that fails ISO 4217 validation.
   */
  setDisplayCurrency: (currency: string) => void;
  refreshCurrencyRates: () => Promise<void>;
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
  /**
   * Soft-archive an item: stamps `archivedAt` instead of removing it, so
   * the item stops appearing in collection lists, totals, recent items and
   * search but stays in storage for stats and audit history. Used by the
   * seller-side prompt after a marketplace sale.
   */
  archiveItem: (itemId: string) => Promise<void>;
  moveItems: (itemIds: string[], targetCollectionId: string) => Promise<void>;
  deleteCollection: (collectionId: string) => Promise<void>;
  deleteUserContent: (userId: string) => Promise<void>;
  reorderOwnedCollections: (orderedIds: string[]) => void;
  reorderItemsInCollection: (collectionId: string, orderedIds: string[]) => void;
  transferItemToBuyer: (
    snapshot: AcquiredItemSnapshot,
    options?: {
      collectionName?: string;
      collectionDescription?: string;
      /**
       * Optional source-listing metadata. When provided, the transfer is
       * persisted to a buyer-local audit log keyed by `${listingId}-${createdAt}`
       * so provenance survives an upstream listing deletion.
       */
      source?: {
        listingId: string;
        listingCreatedAt: string;
        sellerUserId: string;
        mode: MarketplaceMode;
        price: number | null;
        currency: string;
      };
    },
  ) => Promise<{ itemId: string; collectionId: string } | null>;
  refresh: () => Promise<void>;
};

const CollectionsContext = createContext<CollectionsContextValue | null>(null);

// Stable id accessors for the BE-13c pending-upsert queues.
const collectionUpsertId = (collection: Collection): string => collection.id;
const itemUpsertId = (item: CollectableItem): string => item.id;

export function CollectionsProvider({ children }: React.PropsWithChildren) {
  const { user } = useAuth();
  const { language } = useI18n();
  const { getVisibleCollections, getVisibleItems, friends } = useSocial();
  const [currencyRates, setCurrencyRates] = useState<UsdRates | null>(null);
  const [ratesUpdatedAt, setRatesUpdatedAt] = useState<number | null>(null);
  const [displayCurrency, setDisplayCurrencyState] = useState<string>(() =>
    getDefaultCurrencyForLanguage(language),
  );
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
  // BE-13c: uuid-keyed pending-upsert queues. A failed cloud write (offline /
  // Supabase unreachable) parks the full entity here; the flush effect below
  // re-delivers it idempotently on the next reconnect/refresh.
  const [pendingCollections, setPendingCollections] = useState<PendingUpsertQueue<Collection>>({});
  const [pendingItems, setPendingItems] = useState<PendingUpsertQueue<CollectableItem>>({});

  // Run the cloud write for `collection`; drop any queued copy on success, park
  // the full entity for an idempotent retry on failure. `write` is the actual
  // remote call (a full upsert for creates, a PATCH for updates) — either way a
  // failure re-sends the whole row via `upsertCollection` on the next flush.
  const syncCollection = useCallback(
    (collection: Collection, write: () => Promise<void>) => {
      write()
        .then(() =>
          setPendingCollections((q) => dequeueUpsert(q, collection.id, collectionUpsertId)),
        )
        .catch(() =>
          setPendingCollections((q) => enqueueUpsert(q, collection, collectionUpsertId)),
        );
    },
    [],
  );

  const syncItem = useCallback(
    (item: CollectableItem, write: () => Promise<void>) => {
      write()
        .then(() => setPendingItems((q) => dequeueUpsert(q, item.id, itemUpsertId)))
        .catch(() => setPendingItems((q) => enqueueUpsert(q, item, itemUpsertId)));
    },
    [],
  );

  // Mirror chat's `pendingRef`: keep the latest queues in refs so the flush
  // effect can read them without re-subscribing on every queue change (which
  // would loop the moment the flush mutates the queue).
  const pendingCollectionsRef = useRef(pendingCollections);
  const pendingItemsRef = useRef(pendingItems);
  useEffect(() => {
    pendingCollectionsRef.current = pendingCollections;
  }, [pendingCollections]);
  useEffect(() => {
    pendingItemsRef.current = pendingItems;
  }, [pendingItems]);

  // Flush parked offline writes on reconnect/refresh. Collections go first so a
  // queued item never hits its collection's FK before the parent row exists.
  // Results are applied to the *current* queue (not the in-flight snapshot) so
  // an offline write parked mid-flush isn't dropped.
  useEffect(() => {
    if (!ready || !user) return;
    void refreshTick;
    let cancelled = false;

    void (async () => {
      const collectionsQueue = pendingCollectionsRef.current;
      if (hasPendingUpserts(collectionsQueue)) {
        const { sent } = await flushPendingUpserts(
          collectionsQueue,
          collectionUpsertId,
          async (collection) => {
            try {
              await upsertCollection(collection);
              return true;
            } catch {
              return false;
            }
          },
        );
        if (cancelled) return;
        if (sent.length > 0) {
          setPendingCollections((q) => applyDeliveredUpserts(q, sent, collectionUpsertId));
        }
      }

      const itemsQueue = pendingItemsRef.current;
      if (hasPendingUpserts(itemsQueue)) {
        const { sent } = await flushPendingUpserts(
          itemsQueue,
          itemUpsertId,
          async (item) => {
            try {
              await upsertItem(item);
              return true;
            } catch {
              return false;
            }
          },
        );
        if (cancelled) return;
        if (sent.length > 0) {
          setPendingItems((q) => applyDeliveredUpserts(q, sent, itemUpsertId));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, user, refreshTick]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await getUserPreferredCurrency();
      if (cancelled) return;
      if (stored) {
        setDisplayCurrencyState(stored);
      } else {
        setDisplayCurrencyState(getDefaultCurrencyForLanguage(language));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [language]);

  // Cross-device sync: the profile's display_currency wins over the
  // device-local AsyncStorage preference. Runs on sign-in; if the profile
  // carries a value we adopt it and mirror it back to device-local so the
  // next cold start (offline) still shows the right currency. A fetch
  // failure leaves the device-local/language value already applied above.
  useEffect(() => {
    if (!user) return;
    const activeUser = user;
    let cancelled = false;
    void (async () => {
      try {
        const profile = await fetchProfileById(activeUser.id);
        if (cancelled) return;
        const profileCurrency = parseStoredCurrency(profile?.displayCurrency ?? null);
        if (profileCurrency) {
          setDisplayCurrencyState(profileCurrency);
          void setUserPreferredCurrency(profileCurrency);
        }
      } catch {
        // offline / Supabase unavailable — keep the device-local preference
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const payload = await loadCurrencyRates();
      if (cancelled || !payload) return;
      setCurrencyRates(payload.rates);
      setRatesUpdatedAt(payload.fetchedAt);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshCurrencyRates(): Promise<void> {
    const payload = await loadCurrencyRates({ forceRefresh: true });
    if (payload) {
      setCurrencyRates(payload.rates);
      setRatesUpdatedAt(payload.fetchedAt);
    }
  }

  useEffect(() => {
    if (!user) {
      setLocalCollections(prev => prev.length === 0 ? prev : []);
      setLocalItems(prev => prev.length === 0 ? prev : []);
      setFollowedCollectionIds(prev => prev.length === 0 ? prev : []);
      setSubscribedCollections(prev => prev.length === 0 ? prev : []);
      setPendingCollections((prev) => (hasPendingUpserts(prev) ? {} : prev));
      setPendingItems((prev) => (hasPendingUpserts(prev) ? {} : prev));
      setReady(false);
      return;
    }

    const activeUser = user;
    let active = true;

    async function hydrate() {
      try {
        const [rawCollections, rawItems, rawFollowed, rawPendingCollections, rawPendingItems, remoteFollowedIds, remoteWishlist] = await Promise.all([
          AsyncStorage.getItem(collectionsKey(activeUser.id)),
          AsyncStorage.getItem(itemsKey(activeUser.id)),
          AsyncStorage.getItem(followedCollectionsKey(activeUser.id)),
          AsyncStorage.getItem(pendingCollectionsKey(activeUser.id)),
          AsyncStorage.getItem(pendingItemsKey(activeUser.id)),
          fetchFollowedCollectionIds(activeUser.id),
          fetchWishlistItemsByUserId(activeUser.id),
        ]);

        if (!active) {
          return;
        }

        // Rehydrate any offline writes parked before the last reload so the
        // flush effect can re-deliver them once the network is back (BE-13c).
        setPendingCollections(
          rawPendingCollections
            ? (JSON.parse(rawPendingCollections) as PendingUpsertQueue<Collection>)
            : {},
        );
        setPendingItems(
          rawPendingItems
            ? (JSON.parse(rawPendingItems) as PendingUpsertQueue<CollectableItem>)
            : {},
        );

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

        // BE-5: rewrite any legacy non-uuid ids on the user's own cached items
        // to real uuids so they reconcile to the uuid `items.id` column, then
        // re-upsert the rewritten rows (the cloud rejected their old id).
        const { items: normalizedItems, rewritten } = normalizeOwnItemIds(
          visibleItems,
          activeUser.id,
        );

        setLocalCollections(visibleCollections);
        setLocalItems(normalizedItems);
        for (const item of rewritten) {
          upsertItem(item).catch(() => undefined);
        }
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
      AsyncStorage.setItem(pendingCollectionsKey(user.id), JSON.stringify(pendingCollections)),
      AsyncStorage.setItem(pendingItemsKey(user.id), JSON.stringify(pendingItems)),
    ]).catch(() => undefined);
  }, [localCollections, localItems, followedCollectionIds, pendingCollections, pendingItems, ready, user]);

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
            syncCollection(updated, () =>
              updateRemoteCollection(collectionId, { sharedWithUserIds: updated.sharedWithUserIds }),
            );
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
            syncCollection(updated, () =>
              updateRemoteCollection(collectionId, { sharedWithUserIds: updated.sharedWithUserIds }),
            );
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
          .filter(
            (item) =>
              item.collectionId === collectionId &&
              !item.isWishlist &&
              !item.archivedAt,
          )
          .sort((a, b) => {
            const aHas = typeof a.sortOrder === "number";
            const bHas = typeof b.sortOrder === "number";
            if (aHas && bHas) return (a.sortOrder as number) - (b.sortOrder as number);
            if (aHas) return -1;
            if (bHas) return 1;
            return a.createdAt < b.createdAt ? 1 : -1;
          }),
      getCollectionTotalCost: (collectionId) => {
        // A per-collection `currency` override (set via the edit modal or the
        // tap-to-swap chip on the summary card) wins over the user's app-wide
        // `displayCurrency`. Falls back when null/undefined so legacy
        // collections without the column keep working unchanged.
        const collection = collections.find((c) => c.id === collectionId);
        const target = collection?.currency ?? displayCurrency;
        const entries = items
          .filter(
            (item) =>
              item.collectionId === collectionId &&
              !item.isWishlist &&
              !item.archivedAt,
          )
          .filter((item): item is typeof item & { cost: number } => typeof item.cost === "number")
          .map((item) => ({
            amount: item.cost,
            currency: item.costCurrency ?? target,
          }));
        if (currencyRates) {
          const { total, converted, skipped } = sumConverted(entries, target, currencyRates);
          return { amount: total, currency: target, converted, skipped };
        }
        // No rates yet: sum raw amounts (assume each item is already in the
        // target currency). Better than crashing the UI; once rates load the
        // totals re-render with real conversion.
        const amount = entries.reduce((sum, e) => sum + e.amount, 0);
        return { amount, currency: target, converted: entries.length, skipped: 0 };
      },
      convertItemCost: (item, targetCurrency) =>
        convertItemCost(item, targetCurrency ?? displayCurrency, currencyRates),
      displayCurrency,
      currencyRatesUpdatedAt: ratesUpdatedAt,
      setDisplayCurrency: (currency) => {
        const normalized = parseStoredCurrency(currency);
        if (!normalized) return;
        setDisplayCurrencyState(normalized);
        void setUserPreferredCurrency(normalized);
        if (user) {
          updateMyProfileDisplayCurrency(user.id, normalized).catch(() => undefined);
        }
      },
      refreshCurrencyRates,
      getItemById: (itemId) => items.find((item) => item.id === itemId),
      wishlistItems: localItems
        .filter((item) => item.isWishlist)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
      addWishlistItem: async (input) => {
        const nextItem: CollectableItem = {
          // Server-keyed uuid (BE-5) so the row matches `items.id uuid` and
          // reconciles to the cloud — the old `wish-<slug>-<ts>` id was rejected.
          id: generateUuidV4(),
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
        syncItem(nextItem, () => upsertItem(nextItem));
        return nextItem.id;
      },
      promoteWishlistItem: async (itemId, targetCollectionId) => {
        const acquiredAt = new Date().toISOString().slice(0, 10);
        let promoted: CollectableItem | null = null;
        setLocalItems((current) =>
          current.map((item) => {
            if (item.id !== itemId) return item;
            const next = {
              ...item,
              collectionId: targetCollectionId,
              isWishlist: false,
              acquiredAt: item.acquiredAt || acquiredAt,
            };
            promoted = next;
            return next;
          }),
        );
        if (promoted) {
          const updated = promoted;
          syncItem(updated, () =>
            updateRemoteItem(itemId, {
              collectionId: targetCollectionId,
              isWishlist: false,
              acquiredAt: acquiredAt,
            }),
          );
        }
      },
      addItem: async (input) => {
        const nextItem: CollectableItem = {
          // Server-keyed uuid (BE-5) so the row matches `items.id uuid` and
          // reconciles to the cloud — the old `<slug>-<ts>` id was rejected.
          id: generateUuidV4(),
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
        syncItem(nextItem, () => upsertItem(nextItem));
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
        syncCollection(nextCollection, () => upsertCollection(nextCollection));
        return nextCollection.id;
      },
      updateItem: async (itemId, updates) => {
        let updated: CollectableItem | null = null;
        setLocalItems((current) =>
          current.map((item) => {
            if (item.id !== itemId) return item;
            const next = { ...item, ...updates, id: item.id };
            updated = next;
            return next;
          }),
        );
        if (updated) {
          const entity = updated;
          syncItem(entity, () => updateRemoteItem(itemId, updates));
        }
      },
      updateCollection: async (collectionId, updates) => {
        let updated: Collection | null = null;
        setLocalCollections((current) =>
          current.map((col) => {
            if (col.id !== collectionId) return col;
            const next = { ...col, ...updates, id: col.id };
            updated = next;
            return next;
          }),
        );
        if (updated) {
          const entity = updated;
          syncCollection(entity, () => updateRemoteCollection(collectionId, updates));
        }
      },
      deleteItem: async (itemId) => {
        setLocalItems((current) => current.filter((item) => item.id !== itemId));
        // Drop any parked upsert so a queued copy can't resurrect the row.
        setPendingItems((q) => dequeueUpsert(q, itemId, itemUpsertId));
        deleteRemoteItem(itemId).catch(() => undefined);
      },
      archiveItem: async (itemId) => {
        const archivedAt = new Date().toISOString();
        let archived: CollectableItem | null = null;
        setLocalItems((current) =>
          current.map((item) => {
            if (item.id !== itemId) return item;
            const next = { ...item, archivedAt };
            archived = next;
            return next;
          }),
        );
        if (archived) {
          const entity = archived;
          syncItem(entity, () => updateRemoteItem(itemId, { archivedAt }));
        }
      },
      deleteItems: async (itemIds) => {
        if (itemIds.length === 0) return;
        const idSet = new Set(itemIds);
        setLocalItems((current) => current.filter((item) => !idSet.has(item.id)));
        setPendingItems((q) => itemIds.reduce((acc, id) => dequeueUpsert(acc, id, itemUpsertId), q));
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
        moved.forEach((item) =>
          syncItem(item, () => updateRemoteItem(item.id, { collectionId: item.collectionId, sortOrder: undefined })),
        );
      },
      deleteCollection: async (collectionId) => {
        const removedItemIds = localItems
          .filter((item) => item.collectionId === collectionId)
          .map((item) => item.id);
        setLocalCollections((current) => current.filter((collection) => collection.id !== collectionId));
        setLocalItems((current) => current.filter((item) => item.collectionId !== collectionId));
        // Drop the collection and its items from the pending queues so a parked
        // upsert can't resurrect any of them after the delete.
        setPendingCollections((q) => dequeueUpsert(q, collectionId, collectionUpsertId));
        setPendingItems((q) => removedItemIds.reduce((acc, id) => dequeueUpsert(acc, id, itemUpsertId), q));
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
        updated.forEach((c) => syncCollection(c, () => updateRemoteCollection(c.id, { sortOrder: c.sortOrder })));
      },
      transferItemToBuyer: async (snapshot, options) => {
        if (!user) return null;
        const ownerName = user.email ?? "You";
        const ownerUserId = user.id;
        const plan = planTransferItem({
          snapshot,
          options,
          ownerUserId,
          ownerName,
          existingCollection: localCollections.find(
            (c) => c.id === userScopedCollectionId(ownerUserId, ACQUIRED_COLLECTION_ID_SUFFIX),
          ),
          existingItems: localItems,
          now: new Date(),
        });
        if (plan.newCollection) {
          const { newCollection } = plan;
          setLocalCollections((current) => [newCollection, ...current]);
          syncCollection(newCollection, () => upsertCollection(newCollection));
        }
        if (!plan.isDuplicate) {
          const { item } = plan;
          setLocalItems((current) => [item, ...current]);
          syncItem(item, () => upsertItem(item));
        }
        if (plan.logEntry) {
          appendTransferLogEntry(ownerUserId, plan.logEntry).catch(() => undefined);
        }
        return { itemId: plan.item.id, collectionId: plan.collectionId };
      },
      refresh: async () => {
        setRefreshTick((n) => n + 1);
      },
      reorderItemsInCollection: (collectionId, orderedIds) => {
        const indexById = new Map(orderedIds.map((id, idx) => [id, idx]));
        const reordered: CollectableItem[] = [];
        setLocalItems((current) =>
          current.map((item) => {
            if (item.collectionId === collectionId && indexById.has(item.id)) {
              const order = indexById.get(item.id)!;
              const next = { ...item, sortOrder: order };
              reordered.push(next);
              return next;
            }
            return item;
          }),
        );
        reordered.forEach((item) => syncItem(item, () => updateRemoteItem(item.id, { sortOrder: item.sortOrder })));
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
    [collections, items, localCollections, localItems, ready, user, friendCollections, subscribedCollections, followedCollectionIds, sharedWithMeCollections, currencyRates, displayCurrency, ratesUpdatedAt, syncCollection, syncItem],
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
