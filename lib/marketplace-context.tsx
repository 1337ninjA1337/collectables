import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import {
  activeListings,
  canCreateAnotherListing,
  countActiveListingsForUser,
  findListingByItemId,
  listingsForUser,
  removeListingById,
  upsertListing,
} from "@/lib/marketplace-helpers";
import {
  cloudAddListing,
  cloudFetchListingById,
  cloudFetchListings,
  cloudMarkSold,
  cloudRemoveListing,
  subscribeToListings,
} from "@/lib/supabase-marketplace";
import { MARKETPLACE_KEY } from "@/lib/storage-keys";
import { MarketplaceListing, MarketplaceMode } from "@/lib/types";

type DraftListingInput = {
  itemId: string;
  mode: MarketplaceMode;
  askingPrice: number | null;
  currency?: string;
  notes?: string;
  isPremium?: boolean;
};

type MarketplaceContextValue = {
  ready: boolean;
  listings: MarketplaceListing[];
  activeListings: MarketplaceListing[];
  myListings: MarketplaceListing[];
  myActiveListingCount: number;
  canCreateListing: (isPremium?: boolean) => boolean;
  findListingByItemId: (itemId: string) => MarketplaceListing | undefined;
  getListingById: (id: string) => MarketplaceListing | undefined;
  fetchListingById: (id: string) => Promise<MarketplaceListing | null>;
  addListing: (input: DraftListingInput) => MarketplaceListing | null;
  removeListing: (id: string) => void;
  markListingSold: (id: string, buyerUserId?: string | null) => void;
};

const MarketplaceContext = createContext<MarketplaceContextValue | null>(null);

function generateListingId(): string {
  return `listing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function MarketplaceProvider({ children }: React.PropsWithChildren) {
  const { user } = useAuth();
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Try cloud first; fall back to local cache.
        const cloud = await cloudFetchListings();
        if (!cancelled) {
          if (cloud.length > 0) {
            setListings(cloud);
            await AsyncStorage.setItem(MARKETPLACE_KEY, JSON.stringify(cloud)).catch(() => undefined);
            return;
          }
        }
        const raw = await AsyncStorage.getItem(MARKETPLACE_KEY);
        if (cancelled) return;
        if (raw) {
          const parsed = JSON.parse(raw) as MarketplaceListing[];
          if (Array.isArray(parsed)) setListings(parsed);
        }
      } catch {
        // Corrupt cache: start fresh rather than crashing the provider.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(MARKETPLACE_KEY, JSON.stringify(listings)).catch(() => undefined);
  }, [ready, listings]);

  useEffect(() => {
    const sub = subscribeToListings((newListing) => {
      setListings((prev) => {
        if (prev.some((l) => l.id === newListing.id)) return prev;
        return [newListing, ...prev];
      });
    });
    return () => sub.unsubscribe();
  }, []);

  const myListings = useMemo(
    () => (user ? listingsForUser(listings, user.id) : []),
    [listings, user],
  );

  const myActiveListingCount = useMemo(
    () => (user ? countActiveListingsForUser(listings, user.id) : 0),
    [listings, user],
  );

  const sortedActive = useMemo(() => activeListings(listings), [listings]);

  const canCreateListing = useCallback(
    (isPremium = false) => {
      if (!user) return false;
      return canCreateAnotherListing(listings, user.id, isPremium);
    },
    [listings, user],
  );

  const addListing = useCallback(
    (input: DraftListingInput): MarketplaceListing | null => {
      if (!user) return null;
      const isPremium = input.isPremium === true;
      if (!canCreateAnotherListing(listings, user.id, isPremium)) return null;
      const next: MarketplaceListing = {
        id: generateListingId(),
        itemId: input.itemId,
        ownerUserId: user.id,
        mode: input.mode,
        askingPrice:
          input.mode === "sell" && typeof input.askingPrice === "number"
            ? input.askingPrice
            : null,
        currency: input.currency ?? "USD",
        notes: (input.notes ?? "").trim(),
        createdAt: new Date().toISOString(),
        soldAt: null,
        buyerUserId: null,
      };
      setListings((prev) => upsertListing(prev, next));
      // Best-effort cloud sync (fire-and-forget).
      void cloudAddListing(next);
      return next;
    },
    [listings, user],
  );

  const removeListing = useCallback((id: string) => {
    setListings((prev) => removeListingById(prev, id));
    void cloudRemoveListing(id);
  }, []);

  const markListingSold = useCallback(
    (id: string, buyerUserId: string | null = null) => {
      const soldAt = new Date().toISOString();
      setListings((prev) => {
        const target = prev.find((l) => l.id === id);
        if (!target || target.soldAt) return prev;
        return upsertListing(prev, { ...target, soldAt, buyerUserId });
      });
      void cloudMarkSold(id, soldAt, buyerUserId);
    },
    [],
  );

  const findByItemId = useCallback(
    (itemId: string) => findListingByItemId(listings, itemId),
    [listings],
  );

  const getListingById = useCallback(
    (id: string) => listings.find((l) => l.id === id),
    [listings],
  );

  const fetchListingById = useCallback(
    async (id: string): Promise<MarketplaceListing | null> => {
      const local = listings.find((l) => l.id === id);
      if (local) return local;
      const remote = await cloudFetchListingById(id);
      if (remote) setListings((prev) => upsertListing(prev, remote));
      return remote;
    },
    [listings],
  );

  const value = useMemo<MarketplaceContextValue>(
    () => ({
      ready,
      listings,
      activeListings: sortedActive,
      myListings,
      myActiveListingCount,
      canCreateListing,
      findListingByItemId: findByItemId,
      getListingById,
      fetchListingById,
      addListing,
      removeListing,
      markListingSold,
    }),
    [
      ready,
      listings,
      sortedActive,
      myListings,
      myActiveListingCount,
      canCreateListing,
      findByItemId,
      getListingById,
      fetchListingById,
      addListing,
      removeListing,
      markListingSold,
    ],
  );

  return <MarketplaceContext.Provider value={value}>{children}</MarketplaceContext.Provider>;
}

export function useMarketplace() {
  const ctx = useContext(MarketplaceContext);
  if (!ctx) throw new Error("useMarketplace must be used inside MarketplaceProvider");
  return ctx;
}
