import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import {
  activeListings,
  canCreateAnotherListing,
  coerceListings,
  countActiveListingsForUser,
  findListingByItemId,
  isListingClaimedFromOwner,
  listingsForUser,
  markListingArrived,
  normalizeListing,
  purchasesForUser,
  removeListingById,
  salesForUser,
  upsertListing,
} from "@/lib/marketplace-helpers";
import {
  cloudAddListing,
  cloudClaimListing,
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
  myPurchases: MarketplaceListing[];
  mySales: MarketplaceListing[];
  myActiveListingCount: number;
  canCreateListing: (isPremium?: boolean) => boolean;
  findListingByItemId: (itemId: string) => MarketplaceListing | undefined;
  getListingById: (id: string) => MarketplaceListing | undefined;
  fetchListingById: (id: string) => Promise<MarketplaceListing | null>;
  addListing: (input: DraftListingInput) => MarketplaceListing | null;
  removeListing: (id: string) => void;
  markListingSold: (id: string, buyerUserId?: string | null) => void;
  markListingReceived: (id: string) => void;
  claimingListingId: string | null;
  setClaimingListingId: (id: string | null) => void;
  /**
   * Queue of listing ids that just transitioned to sold via realtime UPDATE
   * and are owned by the current user. The shell renders a prompt for the
   * head of the queue offering Archive / Delete / Keep for the underlying
   * item; the consumer calls `dismissSellerNotification` after the user
   * resolves the prompt.
   */
  sellerNotifications: string[];
  dismissSellerNotification: (listingId: string) => void;
};

const MarketplaceContext = createContext<MarketplaceContextValue | null>(null);

function generateListingId(): string {
  return `listing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function MarketplaceProvider({ children }: React.PropsWithChildren) {
  const { user } = useAuth();
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [ready, setReady] = useState(false);
  const [claimingListingId, setClaimingListingId] = useState<string | null>(null);
  const [sellerNotifications, setSellerNotifications] = useState<string[]>([]);
  // Keep `user.id` accessible inside the realtime callback without
  // re-subscribing on every sign-in/sign-out — the subscription itself is
  // process-wide (subscribeShared ref-counts the channel) so swapping the
  // user means swapping which sales become "mine".
  const userIdRef = useRef<string | null>(null);
  useEffect(() => {
    userIdRef.current = user?.id ?? null;
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Try cloud first; fall back to local cache.
        const cloud = await cloudFetchListings();
        if (!cancelled) {
          if (cloud.length > 0) {
            setListings(cloud.map(normalizeListing));
            await AsyncStorage.setItem(MARKETPLACE_KEY, JSON.stringify(cloud)).catch(() => undefined);
            return;
          }
        }
        const raw = await AsyncStorage.getItem(MARKETPLACE_KEY);
        if (cancelled) return;
        if (raw) {
          // Drop malformed entries (missing `id` / `mode` / etc.) so a
          // corrupt cache can't crash downstream rendering on first paint.
          setListings(coerceListings(JSON.parse(raw)));
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
    const sub = subscribeToListings((incoming) => {
      // Upsert so realtime UPDATE events (buyer claim → sold_at/buyer_user_id)
      // propagate to other devices and the listing leaves `activeListings`
      // without waiting for a manual refresh. INSERTs hit the same path.
      setListings((prev) => {
        const normalized = normalizeListing(incoming);
        const existing = prev.find((l) => l.id === normalized.id);
        const me = userIdRef.current;
        // If this is my listing transitioning from active → sold (someone
        // else just claimed it), queue a Archive/Delete/Keep prompt so the
        // seller can decide what to do with the original item in their
        // collection. The buyer's own claim won't trigger this branch on
        // their device because `markListingSold` already set `soldAt` in
        // the local `prev` before the realtime echo arrives.
        if (me && isListingClaimedFromOwner(existing, normalized, me)) {
          setSellerNotifications((q) =>
            q.includes(normalized.id) ? q : [...q, normalized.id],
          );
        }
        return upsertListing(prev, normalized);
      });
    });
    return () => sub.unsubscribe();
  }, []);

  const dismissSellerNotification = useCallback((listingId: string) => {
    setSellerNotifications((q) => q.filter((id) => id !== listingId));
  }, []);

  const myListings = useMemo(
    () => (user ? listingsForUser(listings, user.id) : []),
    [listings, user],
  );

  const myPurchases = useMemo(
    () => (user ? purchasesForUser(listings, user.id) : []),
    [listings, user],
  );

  const mySales = useMemo(
    () => (user ? salesForUser(listings, user.id) : []),
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
        arrivedAt: null,
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
      // A buyer claim (buyerUserId present) goes through the atomic
      // `claim-listing` Edge Function (BE-20) so concurrent claims can't both
      // win and a seller can't claim their own listing. A seller-driven
      // "mark sold" (buyerUserId null) keeps the direct RLS-gated PATCH.
      if (buyerUserId) {
        void cloudClaimListing(id);
      } else {
        void cloudMarkSold(id, soldAt, null);
      }
    },
    [],
  );

  const markListingReceived = useCallback(
    (id: string) => {
      const me = user?.id;
      if (!me) return;
      const when = new Date().toISOString();
      setListings((prev) => {
        const target = prev.find((l) => l.id === id);
        // Only the buyer of a sold listing may confirm receipt; idempotent —
        // an already-arrived listing is left untouched (keeps the first stamp).
        if (!target || target.buyerUserId !== me || !target.soldAt || target.arrivedAt) {
          return prev;
        }
        return upsertListing(prev, markListingArrived(target, when));
      });
    },
    [user],
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
      myPurchases,
      mySales,
      myActiveListingCount,
      canCreateListing,
      findListingByItemId: findByItemId,
      getListingById,
      fetchListingById,
      addListing,
      removeListing,
      markListingSold,
      markListingReceived,
      claimingListingId,
      setClaimingListingId,
      sellerNotifications,
      dismissSellerNotification,
    }),
    [
      ready,
      listings,
      sortedActive,
      myListings,
      myPurchases,
      mySales,
      myActiveListingCount,
      canCreateListing,
      findByItemId,
      getListingById,
      fetchListingById,
      addListing,
      removeListing,
      markListingSold,
      markListingReceived,
      claimingListingId,
      sellerNotifications,
      dismissSellerNotification,
    ],
  );

  return <MarketplaceContext.Provider value={value}>{children}</MarketplaceContext.Provider>;
}

export function useMarketplace() {
  const ctx = useContext(MarketplaceContext);
  if (!ctx) throw new Error("useMarketplace must be used inside MarketplaceProvider");
  return ctx;
}
