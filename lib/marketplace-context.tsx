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
  cloudFetchListings,
  cloudMarkSold,
  cloudRemoveListing,
} from "@/lib/supabase-marketplace";
import { MarketplaceListing, MarketplaceMode } from "@/lib/types";

const STORAGE_KEY = "collectables-marketplace-v1";

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
  addListing: (input: DraftListingInput) => MarketplaceListing | null;
  removeListing: (id: string) => void;
  markListingSold: (id: string) => void;
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
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cloud)).catch(() => undefined);
            return;
          }
        }
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
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
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(listings)).catch(() => undefined);
  }, [ready, listings]);

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

  const markListingSold = useCallback((id: string) => {
    const soldAt = new Date().toISOString();
    setListings((prev) => {
      const target = prev.find((l) => l.id === id);
      if (!target || target.soldAt) return prev;
      return upsertListing(prev, { ...target, soldAt });
    });
    void cloudMarkSold(id, soldAt);
  }, []);

  const findByItemId = useCallback(
    (itemId: string) => findListingByItemId(listings, itemId),
    [listings],
  );

  const getListingById = useCallback(
    (id: string) => listings.find((l) => l.id === id),
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
