import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import {
  DEFAULT_PREMIUM_STATE,
  PremiumState,
  activatePremiumState,
  cancelPremiumState,
  isPremiumActive,
  isPremiumExpired,
  mergePremiumState,
  parsePremiumState,
  premiumExpiresAt,
  premiumStorageKey,
} from "@/lib/premium-helpers";
import { reportStorageFailure } from "@/lib/report-storage-failure";
import { validationToPremiumState } from "@/lib/subscriptions";
import { cloudValidatePremium } from "@/lib/supabase-subscriptions";

/**
 * Which surface triggered a premium activation. Local call sites tag
 * themselves via `activatePremium(source)`; `"server_sync"` is the resting
 * value, so a false→true flip with no local intent (the cloud validation
 * merge restoring an entitlement) reports honestly instead of inheriting a
 * stale screen. `"unknown"` marks an untagged caller — seeing it on a
 * dashboard means a new call site forgot its source.
 */
export type PremiumIntentSource =
  | "settings"
  | "create_collection"
  | "upsell_sheet"
  | "server_sync"
  | "unknown";

type PremiumContextValue = {
  ready: boolean;
  isPremium: boolean;
  activatedAt: string | null;
  premiumActivatedAt: string | null;
  expiresAt: string | null;
  activatePremium: (source?: PremiumIntentSource) => void;
  cancelPremium: () => void;
  /**
   * One-shot read of the surface behind the most recent activation, for the
   * `premium_activated` transition hook. Consuming resets the intent to
   * `"server_sync"` so a later server-driven flip can't reuse it.
   */
  consumeLastPremiumIntent: () => PremiumIntentSource;
};

const PremiumContext = createContext<PremiumContextValue | null>(null);

export function PremiumProvider({ children }: React.PropsWithChildren) {
  const { user } = useAuth();
  const [state, setState] = useState<PremiumState>(DEFAULT_PREMIUM_STATE);
  const [ready, setReady] = useState(false);
  /** Whether the last hydrate read the cache. See `lib/stored-blob.ts`. */
  const [hydrationSafeToPersist, setHydrationSafeToPersist] = useState(false);

  const storageKey = useMemo(() => premiumStorageKey(user?.id ?? null), [user]);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    if (!storageKey) {
      setState(DEFAULT_PREMIUM_STATE);
      setHydrationSafeToPersist(false);
      setReady(true);
      return;
    }
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(storageKey);
        if (cancelled) return;
        // The read SUCCEEDED, so the cache may be rewritten — including when
        // its content is unparseable, which `parsePremiumState` answers with
        // the default and the cloud validation below repairs. This is the
        // WEAKER of the two gates on purpose; `lib/stored-blob.ts` says why a
        // cloud-owned cache takes it and the local-first blobs do not.
        setHydrationSafeToPersist(true);
        const parsed = parsePremiumState(stored);
        setState(isPremiumExpired(parsed) ? cancelPremiumState(parsed) : parsed);
      } catch (error: unknown) {
        // WITHOUT `setState(DEFAULT_PREMIUM_STATE)`. That is what this arm used
        // to do, and the persist effect below then wrote "free" over a PAYING
        // user's stored entitlement — a downgrade caused by a storage read, the
        // one thing the cloud-validation comment two lines down is careful to
        // avoid on the network side. The state stays at its default in memory
        // and nothing is written until a launch reads the store.
        if (!cancelled) {
          setHydrationSafeToPersist(false);
          reportStorageFailure("premium-context.getItem", storageKey, error);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
      // BE-22c: pull server-authoritative truth and LWW-merge it over the
      // AsyncStorage cache (server wins). A transient failure returns null, so
      // the cached entitlement is preserved rather than downgrading a payer.
      const validation = await cloudValidatePremium("validate");
      if (cancelled || !validation) return;
      setState((prev) => mergePremiumState(prev, validationToPremiumState(validation)));
    })();
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  useEffect(() => {
    if (!ready || !hydrationSafeToPersist || !storageKey) return;
    AsyncStorage.setItem(storageKey, JSON.stringify(state)).catch((error: unknown) => {
      reportStorageFailure("premium-context.setItem", storageKey, error);
    });
  }, [hydrationSafeToPersist, ready, storageKey, state]);

  // The intent must be recorded BEFORE the state flip so the transition hook
  // observing isPremium sees it on the very render the flip commits.
  const lastPremiumIntentRef = useRef<PremiumIntentSource>("server_sync");

  const activatePremium = useCallback((source: PremiumIntentSource = "unknown") => {
    lastPremiumIntentRef.current = source;
    setState((prev) => activatePremiumState(prev));
  }, []);

  const cancelPremium = useCallback(() => {
    setState((prev) => cancelPremiumState(prev));
  }, []);

  const consumeLastPremiumIntent = useCallback(() => {
    const source = lastPremiumIntentRef.current;
    lastPremiumIntentRef.current = "server_sync";
    return source;
  }, []);

  const value = useMemo<PremiumContextValue>(
    () => ({
      ready,
      isPremium: isPremiumActive(state),
      activatedAt: state.activatedAt,
      premiumActivatedAt: state.premiumActivatedAt,
      expiresAt: premiumExpiresAt(state),
      activatePremium,
      cancelPremium,
      consumeLastPremiumIntent,
    }),
    [ready, state, activatePremium, cancelPremium, consumeLastPremiumIntent],
  );

  return <PremiumContext.Provider value={value}>{children}</PremiumContext.Provider>;
}

export function usePremium() {
  const ctx = useContext(PremiumContext);
  if (!ctx) throw new Error("usePremium must be used inside PremiumProvider");
  return ctx;
}
